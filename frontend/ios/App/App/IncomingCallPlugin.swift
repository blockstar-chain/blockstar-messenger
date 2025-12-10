import Foundation
import Capacitor
import CallKit

@objc(IncomingCallPlugin)
public class IncomingCallPlugin: CAPPlugin {
    
    private var callObservers: [NSObjectProtocol] = []
    
    public override func load() {
        print("📞 IncomingCallPlugin loaded")
        
        // Listen for CallKit events
        setupCallKitObservers()
    }
    
    private func setupCallKitObservers() {
        // Call answered from CallKit UI
        let answerObserver = NotificationCenter.default.addObserver(
            forName: NSNotification.Name("CallAnsweredFromCallKit"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            if let data = notification.userInfo as? [String: Any] {
                self?.notifyListeners("callAnswered", data: self?.convertToJSObject(data) ?? [:])
            }
        }
        callObservers.append(answerObserver)
        
        // Call ended from CallKit UI
        let endObserver = NotificationCenter.default.addObserver(
            forName: NSNotification.Name("CallEndedFromCallKit"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            if let data = notification.userInfo as? [String: Any] {
                self?.notifyListeners("callEnded", data: self?.convertToJSObject(data) ?? [:])
            }
        }
        callObservers.append(endObserver)
        
        // Mute toggled
        let muteObserver = NotificationCenter.default.addObserver(
            forName: NSNotification.Name("CallMuteToggled"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            if let data = notification.userInfo as? [String: Any] {
                self?.notifyListeners("muteToggled", data: self?.convertToJSObject(data) ?? [:])
            }
        }
        callObservers.append(muteObserver)
        
        // Audio session activated
        let audioObserver = NotificationCenter.default.addObserver(
            forName: NSNotification.Name("AudioSessionActivated"),
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("audioReady", data: [:])
        }
        callObservers.append(audioObserver)
    }
    
    deinit {
        callObservers.forEach { NotificationCenter.default.removeObserver($0) }
    }
    
    // MARK: - Plugin Methods
    
    @objc func checkPendingCall(_ call: CAPPluginCall) {
        print("📞 Checking for pending call...")
        
        if AppDelegate.hasPendingCall(), let data = AppDelegate.getPendingCallData() {
            print("📞 Found pending call data")
            call.resolve(convertToJSObject(data))
        } else {
            print("📞 No pending call")
            call.resolve(["hasPending": false])
        }
    }
    
    @objc func clearPendingCall(_ call: CAPPluginCall) {
        AppDelegate.clearPendingCall()
        call.resolve()
    }
    
    @objc func reportOutgoingCall(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId"),
              let handle = call.getString("handle") else {
            call.reject("Missing callId or handle")
            return
        }
        
        let hasVideo = call.getBool("hasVideo") ?? false
        
        CallKitDelegate.shared.reportOutgoingCall(callId: callId, handle: handle, hasVideo: hasVideo)
        call.resolve()
    }
    
    @objc func reportOutgoingCallConnected(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId") else {
            call.reject("Missing callId")
            return
        }
        
        CallKitDelegate.shared.reportOutgoingCallConnected(callId: callId)
        call.resolve()
    }
    
    @objc func endCall(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId") else {
            call.reject("Missing callId")
            return
        }
        
        CallKitDelegate.shared.endCall(callId: callId)
        call.resolve()
    }
    
    @objc func reportCallEnded(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId") else {
            call.reject("Missing callId")
            return
        }
        
        let reasonString = call.getString("reason") ?? "remoteEnded"
        let reason: CXCallEndedReason
        
        switch reasonString {
        case "failed":
            reason = .failed
        case "unanswered":
            reason = .unanswered
        case "declinedElsewhere":
            reason = .declinedElsewhere
        case "answeredElsewhere":
            reason = .answeredElsewhere
        default:
            reason = .remoteEnded
        }
        
        CallKitDelegate.shared.reportCallEnded(callId: callId, reason: reason)
        call.resolve()
    }
    
    @objc func setMuted(_ call: CAPPluginCall) {
        guard let callId = call.getString("callId") else {
            call.reject("Missing callId")
            return
        }
        
        let muted = call.getBool("muted") ?? false
        
        CallKitDelegate.shared.setMuted(callId: callId, muted: muted)
        call.resolve()
    }
    
    // MARK: - Helpers
    
    private func convertToJSObject(_ dict: [String: Any]) -> [String: Any] {
        var result: [String: Any] = [:]
        for (key, value) in dict {
            if let stringValue = value as? String {
                result[key] = stringValue
            } else if let boolValue = value as? Bool {
                result[key] = boolValue
            } else if let intValue = value as? Int {
                result[key] = intValue
            } else if let doubleValue = value as? Double {
                result[key] = doubleValue
            } else {
                result[key] = String(describing: value)
            }
        }
        return result
    }
}
