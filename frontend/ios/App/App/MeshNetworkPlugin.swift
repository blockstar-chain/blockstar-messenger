import Foundation
import Capacitor
import CoreBluetooth
import MultipeerConnectivity

@objc(MeshNetworkPlugin)
public class MeshNetworkPlugin: CAPPlugin {
    
    // BLE
    private var centralManager: CBCentralManager?
    private var peripheralManager: CBPeripheralManager?
    private var discoveredPeripherals: [CBPeripheral] = []
    private var connectedPeripheral: CBPeripheral?
    private var meshCharacteristic: CBCharacteristic?
    
    // MultipeerConnectivity (for longer range mesh)
    private var peerID: MCPeerID?
    private var mcSession: MCSession?
    private var mcAdvertiser: MCNearbyServiceAdvertiser?
    private var mcBrowser: MCNearbyServiceBrowser?
    
    // Service identifiers
    private let bleServiceUUID = CBUUID(string: "B5F90001-AA8D-11E4-B084-0002A5D5C51B")
    private let bleCharacteristicUUID = CBUUID(string: "B5F90002-AA8D-11E4-B084-0002A5D5C51B")
    private let mcServiceType = "blockstar-mesh"
    
    // State
    private var isScanning = false
    private var isAdvertising = false
    private var myWalletAddress: String = ""
    private var myDisplayName: String = ""
    
    // Discovered peers
    private var discoveredPeers: [[String: Any]] = []
    
    public override func load() {
        print("📡 MeshNetworkPlugin loaded")
    }
    
    // MARK: - Initialize
    
    @objc func initialize(_ call: CAPPluginCall) {
        myWalletAddress = call.getString("walletAddress") ?? ""
        myDisplayName = call.getString("displayName") ?? "Unknown"
        
        print("═══════════════════════════════════════")
        print("📡 MESH: Initializing")
        print("  Wallet: \(myWalletAddress)")
        print("  Name: \(myDisplayName)")
        print("═══════════════════════════════════════")
        
        // Initialize BLE
        centralManager = CBCentralManager(delegate: self, queue: nil)
        peripheralManager = CBPeripheralManager(delegate: self, queue: nil)
        
        // Initialize MultipeerConnectivity
        peerID = MCPeerID(displayName: myDisplayName)
        mcSession = MCSession(peer: peerID!, securityIdentity: nil, encryptionPreference: .required)
        mcSession?.delegate = self
        
        call.resolve(["success": true])
    }
    
    // MARK: - Start Discovery
    
    @objc func startDiscovery(_ call: CAPPluginCall) {
        print("📡 MESH: Starting discovery")
        
        guard let centralManager = centralManager, centralManager.state == .poweredOn else {
            call.reject("Bluetooth not ready")
            return
        }
        
        // Start BLE scanning
        centralManager.scanForPeripherals(withServices: [bleServiceUUID], options: [
            CBCentralManagerScanOptionAllowDuplicatesKey: false
        ])
        
        // Start MultipeerConnectivity browsing
        mcBrowser = MCNearbyServiceBrowser(peer: peerID!, serviceType: mcServiceType)
        mcBrowser?.delegate = self
        mcBrowser?.startBrowsingForPeers()
        
        isScanning = true
        call.resolve(["success": true])
    }
    
    // MARK: - Stop Discovery
    
    @objc func stopDiscovery(_ call: CAPPluginCall) {
        print("📡 MESH: Stopping discovery")
        
        centralManager?.stopScan()
        mcBrowser?.stopBrowsingForPeers()
        
        isScanning = false
        call.resolve(["success": true])
    }
    
    // MARK: - Start Advertising
    
    @objc func startAdvertising(_ call: CAPPluginCall) {
        print("📡 MESH: Starting advertising")
        
        // Start MultipeerConnectivity advertising
        mcAdvertiser = MCNearbyServiceAdvertiser(
            peer: peerID!,
            discoveryInfo: [
                "wallet": myWalletAddress,
                "name": myDisplayName
            ],
            serviceType: mcServiceType
        )
        mcAdvertiser?.delegate = self
        mcAdvertiser?.startAdvertisingPeer()
        
        // BLE advertising is handled when peripheralManager is ready
        isAdvertising = true
        call.resolve(["success": true])
    }
    
    // MARK: - Stop Advertising
    
    @objc func stopAdvertising(_ call: CAPPluginCall) {
        print("📡 MESH: Stopping advertising")
        
        peripheralManager?.stopAdvertising()
        mcAdvertiser?.stopAdvertisingPeer()
        
        isAdvertising = false
        call.resolve(["success": true])
    }
    
    // MARK: - Get Discovered Peers
    
    @objc func getDiscoveredPeers(_ call: CAPPluginCall) {
        call.resolve(["peers": discoveredPeers])
    }
    
    // MARK: - Connect to Peer
    
    @objc func connectToPeer(_ call: CAPPluginCall) {
        guard let peerId = call.getString("peerId") else {
            call.reject("Missing peerId")
            return
        }
        
        print("📡 MESH: Connecting to peer: \(peerId)")
        
        // Try to find the peer in discovered peripherals
        if let peripheral = discoveredPeripherals.first(where: { $0.identifier.uuidString == peerId }) {
            centralManager?.connect(peripheral, options: nil)
            call.resolve(["success": true])
        } else {
            // Try MultipeerConnectivity
            // MC connections are initiated by the browser when browsing
            call.resolve(["success": true, "note": "MC connection will be established automatically"])
        }
    }
    
    // MARK: - Send Message
    
    @objc func sendMessage(_ call: CAPPluginCall) {
        guard let message = call.getString("message"),
              let recipientId = call.getString("recipientId") else {
            call.reject("Missing message or recipientId")
            return
        }
        
        print("📡 MESH: Sending message to: \(recipientId)")
        
        // Prepare message data
        let messageData: [String: Any] = [
            "type": "mesh_message",
            "from": myWalletAddress,
            "fromName": myDisplayName,
            "to": recipientId,
            "content": message,
            "timestamp": Date().timeIntervalSince1970
        ]
        
        guard let jsonData = try? JSONSerialization.data(withJSONObject: messageData) else {
            call.reject("Failed to serialize message")
            return
        }
        
        // Try BLE first
        if let characteristic = meshCharacteristic, let peripheral = connectedPeripheral {
            peripheral.writeValue(jsonData, for: characteristic, type: .withResponse)
            call.resolve(["success": true, "method": "ble"])
            return
        }
        
        // Try MultipeerConnectivity
        if let session = mcSession, !session.connectedPeers.isEmpty {
            do {
                try session.send(jsonData, toPeers: session.connectedPeers, with: .reliable)
                call.resolve(["success": true, "method": "multipeer"])
            } catch {
                call.reject("Failed to send via MultipeerConnectivity: \(error)")
            }
            return
        }
        
        call.reject("No connected peers")
    }
    
    // MARK: - Broadcast Message (to all peers)
    
    @objc func broadcastMessage(_ call: CAPPluginCall) {
        guard let message = call.getString("message") else {
            call.reject("Missing message")
            return
        }
        
        print("📡 MESH: Broadcasting message")
        
        let messageData: [String: Any] = [
            "type": "mesh_broadcast",
            "from": myWalletAddress,
            "fromName": myDisplayName,
            "content": message,
            "timestamp": Date().timeIntervalSince1970
        ]
        
        guard let jsonData = try? JSONSerialization.data(withJSONObject: messageData) else {
            call.reject("Failed to serialize message")
            return
        }
        
        var sentCount = 0
        
        // Send via MultipeerConnectivity
        if let session = mcSession, !session.connectedPeers.isEmpty {
            do {
                try session.send(jsonData, toPeers: session.connectedPeers, with: .reliable)
                sentCount += session.connectedPeers.count
            } catch {
                print("❌ MC broadcast failed: \(error)")
            }
        }
        
        call.resolve(["success": true, "sentTo": sentCount])
    }
    
    // MARK: - Get Status
    
    @objc func getStatus(_ call: CAPPluginCall) {
        let bleState: String
        switch centralManager?.state {
        case .poweredOn:
            bleState = "enabled"
        case .poweredOff:
            bleState = "disabled"
        case .unauthorized:
            bleState = "unauthorized"
        default:
            bleState = "unknown"
        }
        
        call.resolve([
            "bleState": bleState,
            "isScanning": isScanning,
            "isAdvertising": isAdvertising,
            "discoveredPeers": discoveredPeers.count,
            "connectedPeers": mcSession?.connectedPeers.count ?? 0
        ])
    }
    
    // MARK: - Cleanup
    
    @objc func cleanup(_ call: CAPPluginCall) {
        centralManager?.stopScan()
        peripheralManager?.stopAdvertising()
        mcBrowser?.stopBrowsingForPeers()
        mcAdvertiser?.stopAdvertisingPeer()
        mcSession?.disconnect()
        
        discoveredPeers.removeAll()
        discoveredPeripherals.removeAll()
        
        isScanning = false
        isAdvertising = false
        
        call.resolve(["success": true])
    }
    
    // MARK: - Notify JavaScript
    
    private func notifyPeerDiscovered(_ peer: [String: Any]) {
        notifyListeners("peerDiscovered", data: peer)
    }
    
    private func notifyPeerConnected(_ peer: [String: Any]) {
        notifyListeners("peerConnected", data: peer)
    }
    
    private func notifyPeerDisconnected(_ peer: [String: Any]) {
        notifyListeners("peerDisconnected", data: peer)
    }
    
    private func notifyMessageReceived(_ message: [String: Any]) {
        notifyListeners("messageReceived", data: message)
    }
}

// MARK: - CBCentralManagerDelegate (BLE Scanner)

extension MeshNetworkPlugin: CBCentralManagerDelegate {
    
    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        print("📡 BLE Central state: \(central.state.rawValue)")
        
        switch central.state {
        case .poweredOn:
            print("✅ BLE is powered on")
            notifyListeners("bleStateChanged", data: ["state": "enabled"])
        case .poweredOff:
            print("❌ BLE is powered off")
            notifyListeners("bleStateChanged", data: ["state": "disabled"])
        case .unauthorized:
            print("❌ BLE unauthorized")
            notifyListeners("bleStateChanged", data: ["state": "unauthorized"])
        default:
            break
        }
    }
    
    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String : Any], rssi RSSI: NSNumber) {
        print("📡 BLE: Discovered peripheral: \(peripheral.name ?? "Unknown")")
        
        if !discoveredPeripherals.contains(where: { $0.identifier == peripheral.identifier }) {
            discoveredPeripherals.append(peripheral)
            
            let peerData: [String: Any] = [
                "id": peripheral.identifier.uuidString,
                "name": peripheral.name ?? "Unknown Device",
                "rssi": RSSI.intValue,
                "type": "ble"
            ]
            
            discoveredPeers.append(peerData)
            notifyPeerDiscovered(peerData)
        }
    }
    
    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        print("📡 BLE: Connected to \(peripheral.name ?? "Unknown")")
        
        connectedPeripheral = peripheral
        peripheral.delegate = self
        peripheral.discoverServices([bleServiceUUID])
        
        notifyPeerConnected([
            "id": peripheral.identifier.uuidString,
            "name": peripheral.name ?? "Unknown",
            "type": "ble"
        ])
    }
    
    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        print("📡 BLE: Disconnected from \(peripheral.name ?? "Unknown")")
        
        if connectedPeripheral?.identifier == peripheral.identifier {
            connectedPeripheral = nil
            meshCharacteristic = nil
        }
        
        notifyPeerDisconnected([
            "id": peripheral.identifier.uuidString,
            "name": peripheral.name ?? "Unknown"
        ])
    }
}

// MARK: - CBPeripheralDelegate

extension MeshNetworkPlugin: CBPeripheralDelegate {
    
    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let services = peripheral.services else { return }
        
        for service in services {
            if service.uuid == bleServiceUUID {
                peripheral.discoverCharacteristics([bleCharacteristicUUID], for: service)
            }
        }
    }
    
    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let characteristics = service.characteristics else { return }
        
        for characteristic in characteristics {
            if characteristic.uuid == bleCharacteristicUUID {
                meshCharacteristic = characteristic
                peripheral.setNotifyValue(true, for: characteristic)
                print("✅ Found mesh characteristic")
            }
        }
    }
    
    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let data = characteristic.value,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return
        }
        
        print("📡 BLE: Received message")
        notifyMessageReceived(json)
    }
}

// MARK: - CBPeripheralManagerDelegate (BLE Advertiser)

extension MeshNetworkPlugin: CBPeripheralManagerDelegate {
    
    public func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        print("📡 BLE Peripheral state: \(peripheral.state.rawValue)")
        
        if peripheral.state == .poweredOn && isAdvertising {
            // Create and add service
            let service = CBMutableService(type: bleServiceUUID, primary: true)
            let characteristic = CBMutableCharacteristic(
                type: bleCharacteristicUUID,
                properties: [.read, .write, .notify],
                value: nil,
                permissions: [.readable, .writeable]
            )
            service.characteristics = [characteristic]
            peripheral.add(service)
        }
    }
    
    public func peripheralManager(_ peripheral: CBPeripheralManager, didAdd service: CBService, error: Error?) {
        if error == nil {
            peripheral.startAdvertising([
                CBAdvertisementDataServiceUUIDsKey: [bleServiceUUID],
                CBAdvertisementDataLocalNameKey: myDisplayName
            ])
            print("✅ BLE advertising started")
        }
    }
    
    public func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for request in requests {
            if let data = request.value,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                print("📡 BLE: Received write request")
                notifyMessageReceived(json)
            }
            peripheral.respond(to: request, withResult: .success)
        }
    }
}

// MARK: - MCSessionDelegate (MultipeerConnectivity)

extension MeshNetworkPlugin: MCSessionDelegate {
    
    public func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        DispatchQueue.main.async {
            switch state {
            case .connected:
                print("📡 MC: Connected to \(peerID.displayName)")
                self.notifyPeerConnected([
                    "id": peerID.displayName,
                    "name": peerID.displayName,
                    "type": "multipeer"
                ])
            case .notConnected:
                print("📡 MC: Disconnected from \(peerID.displayName)")
                self.notifyPeerDisconnected([
                    "id": peerID.displayName,
                    "name": peerID.displayName
                ])
            case .connecting:
                print("📡 MC: Connecting to \(peerID.displayName)")
            @unknown default:
                break
            }
        }
    }
    
    public func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        if let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            print("📡 MC: Received message from \(peerID.displayName)")
            DispatchQueue.main.async {
                self.notifyMessageReceived(json)
            }
        }
    }
    
    public func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}
    
    public func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}
    
    public func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}

// MARK: - MCNearbyServiceBrowserDelegate

extension MeshNetworkPlugin: MCNearbyServiceBrowserDelegate {
    
    public func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String : String]?) {
        print("📡 MC: Found peer: \(peerID.displayName)")
        
        let peerData: [String: Any] = [
            "id": peerID.displayName,
            "name": info?["name"] ?? peerID.displayName,
            "wallet": info?["wallet"] ?? "",
            "type": "multipeer"
        ]
        
        // Add to discovered peers if not already there
        if !discoveredPeers.contains(where: { ($0["id"] as? String) == peerID.displayName }) {
            discoveredPeers.append(peerData)
            notifyPeerDiscovered(peerData)
        }
        
        // Auto-invite to session
        browser.invitePeer(peerID, to: mcSession!, withContext: nil, timeout: 30)
    }
    
    public func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {
        print("📡 MC: Lost peer: \(peerID.displayName)")
        
        discoveredPeers.removeAll { ($0["id"] as? String) == peerID.displayName }
        
        notifyPeerDisconnected([
            "id": peerID.displayName,
            "name": peerID.displayName
        ])
    }
}

// MARK: - MCNearbyServiceAdvertiserDelegate

extension MeshNetworkPlugin: MCNearbyServiceAdvertiserDelegate {
    
    public func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        print("📡 MC: Received invitation from \(peerID.displayName)")
        
        // Auto-accept invitations
        invitationHandler(true, mcSession)
    }
}
