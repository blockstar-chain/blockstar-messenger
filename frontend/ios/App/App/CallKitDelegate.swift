import Foundation
import CallKit
import AVFoundation

class CallKitDelegate: NSObject, CXProviderDelegate {
    
    static let shared = CallKitDelegate()
    
    // Map call IDs to UUIDs
    var callUUIDs: [String: UUID] = [:]
    var callData: [UUID: [String: Any]] = [:]
    
    // Current active call UUID
    var activeCallUUID: UUID?
    
    private override init() {
        super.init()
    }
    
    // MARK: - CXProviderDelegate
    
    func providerDidReset(_ provider: CXProvider) {
        print("📞 CallKit provider reset")
        // Clean up any ongoing calls
        callUUIDs.removeAll()
        callData.removeAll()
        activeCallUUID = nil
    }
    
    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        print("═══════════════════════════════════════")
        print("✅ CALL ANSWERED via CallKit")
        print("  UUID: \(action.callUUID)")
        print("═══════════════════════════════════════")
        
        // Configure audio session for call
        configureAudioSession()
        
        activeCallUUID = action.callUUID
        
        // Get call data
        if let data = callData[action.callUUID] {
            // Update with answer action
            var updatedData = data
            updatedData["action"] = "answer"
            AppDelegate.pendingCallData = updatedData
            
            // Notify JavaScript that call was answered
            DispatchQueue.main.async {
                NotificationCenter.default.post(
                    name: NSNotification.Name("CallAnsweredFromCallKit"),
                    object: nil,
                    userInfo: updatedData
                )
            }
        }
        
        action.fulfill()
    }
    
    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        print("═══════════════════════════════════════")
        print("❌ CALL ENDED via CallKit")
        print("  UUID: \(action.callUUID)")
        print("═══════════════════════════════════════")
        
        // Check if this was a decline (call never answered) or hangup
        let wasActive = activeCallUUID == action.callUUID
        
        if let data = callData[action.callUUID] {
            var updatedData = data
            updatedData["action"] = wasActive ? "hangup" : "decline"
            
            // Notify JavaScript
            DispatchQueue.main.async {
                NotificationCenter.default.post(
                    name: NSNotification.Name("CallEndedFromCallKit"),
                    object: nil,
                    userInfo: updatedData
                )
            }
        }
        
        // Clean up
        if let callId = callUUIDs.first(where: { $0.value == action.callUUID })?.key {
            callUUIDs.removeValue(forKey: callId)
        }
        callData.removeValue(forKey: action.callUUID)
        
        if activeCallUUID == action.callUUID {
            activeCallUUID = nil
        }
        
        action.fulfill()
    }
    
    func provider(_ provider: CXProvider, perform action: CXSetMutedCallAction) {
        print("📞 Mute toggled: \(action.isMuted)")
        
        // Notify JavaScript
        NotificationCenter.default.post(
            name: NSNotification.Name("CallMuteToggled"),
            object: nil,
            userInfo: ["muted": action.isMuted]
        )
        
        action.fulfill()
    }
    
    func provider(_ provider: CXProvider, perform action: CXSetHeldCallAction) {
        print("📞 Hold toggled: \(action.isOnHold)")
        action.fulfill()
    }
    
    func provider(_ provider: CXProvider, timedOutPerforming action: CXAction) {
        print("⚠️ CallKit action timed out: \(action)")
        action.fulfill()
    }
    
    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        print("🔊 Audio session activated")
        
        // Notify JavaScript that audio is ready
        NotificationCenter.default.post(
            name: NSNotification.Name("AudioSessionActivated"),
            object: nil
        )
    }
    
    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        print("🔇 Audio session deactivated")
    }
    
    // MARK: - Audio Session Configuration
    
    private func configureAudioSession() {
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
            try audioSession.setActive(true)
            print("✅ Audio session configured for call")
        } catch {
            print("❌ Error configuring audio session: \(error)")
        }
    }
    
    // MARK: - Public Methods
    
    /// Report an outgoing call to CallKit
    func reportOutgoingCall(callId: String, handle: String, hasVideo: Bool) {
        let uuid = UUID()
        callUUIDs[callId] = uuid
        
        let handle = CXHandle(type: .generic, value: handle)
        let startCallAction = CXStartCallAction(call: uuid, handle: handle)
        startCallAction.isVideo = hasVideo
        
        let transaction = CXTransaction(action: startCallAction)
        
        AppDelegate.callKitController?.request(transaction) { error in
            if let error = error {
                print("❌ Error starting call: \(error)")
            } else {
                print("✅ Outgoing call reported to CallKit")
                
                // Update call as connecting
                AppDelegate.callKitProvider?.reportOutgoingCall(with: uuid, startedConnectingAt: Date())
            }
        }
    }
    
    /// Report that outgoing call connected
    func reportOutgoingCallConnected(callId: String) {
        guard let uuid = callUUIDs[callId] else { return }
        AppDelegate.callKitProvider?.reportOutgoingCall(with: uuid, connectedAt: Date())
        activeCallUUID = uuid
        print("✅ Outgoing call connected")
    }
    
    /// End a call
    func endCall(callId: String) {
        guard let uuid = callUUIDs[callId] else {
            print("⚠️ No UUID found for call: \(callId)")
            return
        }
        
        let endCallAction = CXEndCallAction(call: uuid)
        let transaction = CXTransaction(action: endCallAction)
        
        AppDelegate.callKitController?.request(transaction) { error in
            if let error = error {
                print("❌ Error ending call: \(error)")
            } else {
                print("✅ Call ended via CallKit")
            }
        }
    }
    
    /// End call when caller cancels
    func reportCallEnded(callId: String, reason: CXCallEndedReason) {
        guard let uuid = callUUIDs[callId] else { return }
        
        AppDelegate.callKitProvider?.reportCall(with: uuid, endedAt: Date(), reason: reason)
        
        // Clean up
        callUUIDs.removeValue(forKey: callId)
        callData.removeValue(forKey: uuid)
        
        if activeCallUUID == uuid {
            activeCallUUID = nil
        }
        
        print("✅ Call ended with reason: \(reason.rawValue)")
    }
    
    /// Toggle mute
    func setMuted(callId: String, muted: Bool) {
        guard let uuid = callUUIDs[callId] else { return }
        
        let muteAction = CXSetMutedCallAction(call: uuid, muted: muted)
        let transaction = CXTransaction(action: muteAction)
        
        AppDelegate.callKitController?.request(transaction) { error in
            if let error = error {
                print("❌ Error setting mute: \(error)")
            }
        }
    }
}
