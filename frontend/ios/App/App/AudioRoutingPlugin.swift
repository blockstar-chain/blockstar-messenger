// iOS native plugin for audio routing
// Save this as: ios/App/App/AudioRoutingPlugin.swift

import Foundation
import Capacitor
import AVFoundation

@objc(AudioRoutingPlugin)
public class AudioRoutingPlugin: CAPPlugin {
    
    private let audioSession = AVAudioSession.sharedInstance()
    
    @objc func setVoiceCallMode(_ call: CAPPluginCall) {
        do {
            // Configure audio session for voice chat
            try audioSession.setCategory(
                .playAndRecord,
                mode: .voiceChat,
                options: [.allowBluetooth, .allowBluetoothA2DP]
            )
            try audioSession.setActive(true)
            
            // Default to earpiece (receiver)
            try audioSession.overrideOutputAudioPort(.none)
            
            print("AudioRouting: Voice call mode set - using earpiece")
            call.resolve()
        } catch {
            print("AudioRouting: Error setting voice call mode - \(error)")
            call.reject("Failed to set voice call mode: \(error.localizedDescription)")
        }
    }
    
    @objc func setDefaultMode(_ call: CAPPluginCall) {
        do {
            // Reset to default audio session
            try audioSession.setCategory(.playback, mode: .default)
            try audioSession.setActive(false, options: .notifyOthersOnDeactivation)
            
            print("AudioRouting: Default mode restored")
            call.resolve()
        } catch {
            print("AudioRouting: Error setting default mode - \(error)")
            call.reject("Failed to set default mode: \(error.localizedDescription)")
        }
    }
    
    @objc func setSpeakerOn(_ call: CAPPluginCall) {
        do {
            try audioSession.overrideOutputAudioPort(.speaker)
            print("AudioRouting: Speaker ON")
            call.resolve()
        } catch {
            print("AudioRouting: Error enabling speaker - \(error)")
            call.reject("Failed to enable speaker: \(error.localizedDescription)")
        }
    }
    
    @objc func setSpeakerOff(_ call: CAPPluginCall) {
        do {
            try audioSession.overrideOutputAudioPort(.none)
            print("AudioRouting: Speaker OFF - using earpiece")
            call.resolve()
        } catch {
            print("AudioRouting: Error disabling speaker - \(error)")
            call.reject("Failed to disable speaker: \(error.localizedDescription)")
        }
    }
    
    @objc func isSpeakerOn(_ call: CAPPluginCall) {
        let currentRoute = audioSession.currentRoute
        var isSpeaker = false
        
        for output in currentRoute.outputs {
            if output.portType == .builtInSpeaker {
                isSpeaker = true
                break
            }
        }
        
        call.resolve(["enabled": isSpeaker])
    }
    
    @objc func getCurrentRoute(_ call: CAPPluginCall) {
        let currentRoute = audioSession.currentRoute
        var route = "earpiece"
        
        for output in currentRoute.outputs {
            switch output.portType {
            case .builtInSpeaker:
                route = "speaker"
            case .bluetoothA2DP, .bluetoothLE, .bluetoothHFP:
                route = "bluetooth"
            case .headphones, .headsetMic:
                route = "headset"
            case .builtInReceiver:
                route = "earpiece"
            default:
                route = "earpiece"
            }
        }
        
        call.resolve(["route": route])
    }
}
