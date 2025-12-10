import Foundation
import CallKit
import AVFoundation

final class CallKitDelegate: NSObject, CXProviderDelegate {
    static let shared = CallKitDelegate()

    // Map between app-level callId and CallKit UUID
    var callUUIDs: [String: UUID] = [:]

    // Store call-related data keyed by UUID
    var callData: [UUID: [String: Any]?] = [:]

    func providerDidReset(_ provider: CXProvider) {
        print("☎️ providerDidReset")
        callUUIDs.removeAll()
        callData.removeAll()
    }

    func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        print("☎️ Answer action for call: \(action.callUUID)")
        // Configure audio session if needed
        do {
            try AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth, .defaultToSpeaker])
            try AVAudioSession.sharedInstance().setActive(true)
        } catch {
            print("❌ Failed to configure AVAudioSession: \(error)")
        }

        // Notify JS/native layer as needed here (left as integration point)

        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        print("☎️ End action for call: \(action.callUUID)")
        // Cleanup stored data
        callData[action.callUUID] = nil
        // Optionally find and remove mapping from callId -> UUID
        if let pair = callUUIDs.first(where: { $0.value == action.callUUID }) {
            callUUIDs[pair.key] = nil
        }
        action.fulfill()
    }

    func provider(_ provider: CXProvider, perform action: CXStartCallAction) {
        print("☎️ Start call action for: \(action.callUUID)")
        action.fulfill()
    }

    func provider(_ provider: CXProvider, didActivate audioSession: AVAudioSession) {
        print("🔊 CallKit activated audio session")
    }

    func provider(_ provider: CXProvider, didDeactivate audioSession: AVAudioSession) {
        print("🔇 CallKit deactivated audio session")
    }
}
