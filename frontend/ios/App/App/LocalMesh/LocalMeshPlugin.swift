// ios/App/App/LocalMesh/LocalMeshPlugin.swift
// iOS counterpart of LocalMeshPlugin.java. Same Capacitor plugin name ("LocalMesh")
// and same JS events/methods, so LocalMeshService.ts works unchanged on iOS.
//
// Uses Network.framework:
//   - NWListener advertises a Bonjour service AND listens for TCP connections.
//   - NWBrowser discovers peers.
//   - NWConnection connects.
//   - includePeerToPeer = true enables Apple peer-to-peer Wi-Fi (AWDL), so two
//     iPhones can link with NO router and NO internet.
//
// Framing: newline-delimited UTF-8 (matches the Android plugin), so iOS <-> Android
// interop works over a shared Wi-Fi / hotspot.
//
// STATUS: working scaffold — compiles against public APIs, TEST ON DEVICES.
//
// Required Info.plist keys (see README):
//   NSLocalNetworkUsageDescription
//   NSBonjourServices = ["_bscypher._tcp"]
//   NSMicrophoneUsageDescription (for the walkie-talkie)

import Foundation
import Network
import Capacitor

@objc(LocalMeshPlugin)
public class LocalMeshPlugin: CAPPlugin {

    private let serviceType = "_bscypher._tcp"
    private let namePrefix = "bscypher-"
    private let queue = DispatchQueue(label: "site.blockstar.cypher.localmesh")

    private var listener: NWListener?
    private var browser: NWBrowser?
    private var myAddress = ""

    private var connections = [String: NWConnection]()
    private var readBuffers = [String: Data]()
    private var endpointsByName = [String: NWEndpoint]()
    private var counter = 0

    private func nextId() -> String {
        counter += 1
        return "c\(counter)"
    }

    // MARK: - Register (advertise + listen)

    @objc func register(_ call: CAPPluginCall) {
        myAddress = call.getString("address") ?? ""
        let name = namePrefix + myAddress

        do {
            let params = NWParameters.tcp
            params.includePeerToPeer = true
            let l = try NWListener(using: params)
            l.service = NWListener.Service(name: name, type: serviceType)
            l.newConnectionHandler = { [weak self] conn in
                self?.acceptConnection(conn)
            }
            l.stateUpdateHandler = { state in
                if case let .failed(err) = state {
                    CAPLog.print("[LocalMesh] listener failed: \(err)")
                }
            }
            l.start(queue: queue)
            self.listener = l

            var res = JSObject()
            res["port"] = 0 // Network.framework abstracts the port; not needed by JS on iOS
            call.resolve(res)
        } catch {
            call.reject("Failed to start listener: \(error.localizedDescription)")
        }
    }

    // MARK: - Discover

    @objc func discover(_ call: CAPPluginCall) {
        let params = NWParameters()
        params.includePeerToPeer = true
        let b = NWBrowser(for: .bonjour(type: serviceType, domain: nil), using: params)
        b.browseResultsChangedHandler = { [weak self] results, _ in
            guard let self = self else { return }
            for result in results {
                if case let .service(name, _, _, _) = result.endpoint {
                    if name == self.namePrefix + self.myAddress { continue } // self
                    self.endpointsByName[name] = result.endpoint

                    var addr = ""
                    if name.hasPrefix(self.namePrefix) {
                        addr = String(name.dropFirst(self.namePrefix.count))
                    }
                    var data = JSObject()
                    data["name"] = name
                    data["address"] = addr
                    data["host"] = name // iOS connects by name (see connect)
                    data["port"] = 0
                    self.notifyListeners("peerFound", data: data)
                }
            }
        }
        b.stateUpdateHandler = { state in
            if case let .failed(err) = state {
                CAPLog.print("[LocalMesh] browser failed: \(err)")
            }
        }
        b.start(queue: queue)
        self.browser = b
        call.resolve()
    }

    @objc func stopDiscovery(_ call: CAPPluginCall) {
        browser?.cancel()
        browser = nil
        call.resolve()
    }

    // MARK: - Connect / Send

    @objc func connect(_ call: CAPPluginCall) {
        // iOS connects by Bonjour endpoint (looked up by service name).
        let name = call.getString("name") ?? call.getString("host") ?? ""
        guard let endpoint = endpointsByName[name] else {
            call.reject("Unknown peer: \(name)")
            return
        }
        let params = NWParameters.tcp
        params.includePeerToPeer = true
        let conn = NWConnection(to: endpoint, using: params)
        let cid = nextId()
        setupConnection(conn, connectionId: cid, host: name)
        conn.start(queue: queue)

        var res = JSObject()
        res["connectionId"] = cid
        call.resolve(res)
    }

    @objc func send(_ call: CAPPluginCall) {
        guard let cid = call.getString("connectionId"),
              let message = call.getString("message"),
              let conn = connections[cid] else {
            call.reject("connectionId/message required or unknown connection")
            return
        }
        writeLine(conn, cid: cid, message: message)
        call.resolve()
    }

    @objc func broadcast(_ call: CAPPluginCall) {
        guard let message = call.getString("message") else {
            call.reject("message required")
            return
        }
        for (cid, conn) in connections {
            writeLine(conn, cid: cid, message: message)
        }
        call.resolve()
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        if let cid = call.getString("connectionId") {
            closeConnection(cid)
        }
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        stopAll()
        call.resolve()
    }

    // MARK: - Internals

    private func acceptConnection(_ conn: NWConnection) {
        let cid = nextId()
        setupConnection(conn, connectionId: cid, host: "peer")
        conn.start(queue: queue)
    }

    private func setupConnection(_ conn: NWConnection, connectionId cid: String, host: String) {
        connections[cid] = conn
        readBuffers[cid] = Data()

        conn.stateUpdateHandler = { [weak self] state in
            guard let self = self else { return }
            switch state {
            case .ready:
                var data = JSObject()
                data["connectionId"] = cid
                data["host"] = host
                self.notifyListeners("connected", data: data)
                self.receiveLoop(conn, cid: cid)
            case .failed, .cancelled:
                self.closeConnection(cid)
            default:
                break
            }
        }
    }

    private func receiveLoop(_ conn: NWConnection, cid: String) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else { return }
            if let data = data, !data.isEmpty {
                var buf = self.readBuffers[cid] ?? Data()
                buf.append(data)
                // split on newline (0x0A)
                while let idx = buf.firstIndex(of: 0x0A) {
                    let lineData = buf.subdata(in: buf.startIndex..<idx)
                    buf.removeSubrange(buf.startIndex...idx)
                    if let line = String(data: lineData, encoding: .utf8), !line.isEmpty {
                        var payload = JSObject()
                        payload["connectionId"] = cid
                        payload["message"] = line
                        self.notifyListeners("messageReceived", data: payload)
                    }
                }
                self.readBuffers[cid] = buf
            }
            if isComplete || error != nil {
                self.closeConnection(cid)
            } else {
                self.receiveLoop(conn, cid: cid)
            }
        }
    }

    private func writeLine(_ conn: NWConnection, cid: String, message: String) {
        let data = (message + "\n").data(using: .utf8) ?? Data()
        conn.send(content: data, completion: .contentProcessed { [weak self] error in
            if let error = error {
                CAPLog.print("[LocalMesh] send failed: \(error)")
                self?.closeConnection(cid)
            }
        })
    }

    private func closeConnection(_ cid: String) {
        if let conn = connections[cid] {
            conn.cancel()
            connections[cid] = nil
            readBuffers[cid] = nil
            var data = JSObject()
            data["connectionId"] = cid
            notifyListeners("disconnected", data: data)
        }
    }

    private func stopAll() {
        browser?.cancel(); browser = nil
        listener?.cancel(); listener = nil
        for (cid, _) in connections { closeConnection(cid) }
        endpointsByName.removeAll()
    }

    override public func handleOnDestroy() {
        stopAll()
    }
}
