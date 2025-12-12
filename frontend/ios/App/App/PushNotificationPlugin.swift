import Foundation
import Capacitor
import UserNotifications
import AVFoundation

@objc(PushNotificationPlugin)
public class PushNotificationPlugin: CAPPlugin {
    
    private var tokenObservers: [NSObjectProtocol] = []
    
    public override func load() {
        print("📬 PushNotificationPlugin loaded")
        setupObservers()
    }
    
    private func setupObservers() {
        // VoIP token received
        let voipObserver = NotificationCenter.default.addObserver(
            forName: NSNotification.Name("VoIPTokenReceived"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            if let token = notification.userInfo?["token"] as? String {
                self?.notifyListeners("voipTokenReceived", data: ["token": token])
            }
        }
        tokenObservers.append(voipObserver)
        
        // APNs token received
        let apnsObserver = NotificationCenter.default.addObserver(
            forName: NSNotification.Name("APNsTokenReceived"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            if let token = notification.userInfo?["token"] as? String {
                self?.notifyListeners("apnsTokenReceived", data: ["token": token])
            }
        }
        tokenObservers.append(apnsObserver)
        
        // Message notification opened
        let messageObserver = NotificationCenter.default.addObserver(
            forName: NSNotification.Name("OpenConversationFromNotification"),
            object: nil,
            queue: .main
        ) { [weak self] notification in
            if let data = notification.userInfo as? [String: Any] {
                self?.notifyListeners("notificationOpened", data: data)
            }
        }
        tokenObservers.append(messageObserver)
    }
    
    deinit {
        tokenObservers.forEach { NotificationCenter.default.removeObserver($0) }
    }
    
    // MARK: - Silent Mode Detection
    
    /// Check if the device is in silent mode by checking output volume
    private func isSilentModeEnabled() -> Bool {
        let audioSession = AVAudioSession.sharedInstance()
        let outputVolume = audioSession.outputVolume
        return outputVolume < 0.01
    }
    
    // MARK: - Request Permission
    
    @objc func requestPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            DispatchQueue.main.async {
                if granted {
                    UIApplication.shared.registerForRemoteNotifications()
                    call.resolve(["granted": true])
                } else {
                    call.resolve(["granted": false, "error": error?.localizedDescription ?? "Permission denied"])
                }
            }
        }
    }
    
    // MARK: - Check Permission
    
    @objc func checkPermission(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let status: String
            switch settings.authorizationStatus {
            case .authorized:
                status = "granted"
            case .denied:
                status = "denied"
            case .notDetermined:
                status = "prompt"
            case .provisional:
                status = "provisional"
            case .ephemeral:
                status = "ephemeral"
            @unknown default:
                status = "unknown"
            }
            call.resolve(["status": status])
        }
    }
    
    // MARK: - Get Pending Notifications
    
    @objc func getPendingNotificationData(_ call: CAPPluginCall) {
        if let messageData = AppDelegate.getPendingMessageData() {
            call.resolve(["hasData": true, "data": messageData])
        } else {
            call.resolve(["hasData": false])
        }
    }
    
    // MARK: - Clear Pending Data
    
    @objc func clearPendingData(_ call: CAPPluginCall) {
        AppDelegate.clearPendingMessage()
        call.resolve()
    }
    
    // MARK: - Update Badge
    
    @objc func setBadge(_ call: CAPPluginCall) {
        let count = call.getInt("count") ?? 0
        AppDelegate.updateBadge(count: count)
        call.resolve()
    }
    
    // MARK: - Clear Badge
    
    @objc func clearBadge(_ call: CAPPluginCall) {
        AppDelegate.updateBadge(count: 0)
        call.resolve()
    }
    
    // MARK: - Show Local Notification
    
    @objc func showLocalNotification(_ call: CAPPluginCall) {
        guard let title = call.getString("title"),
              let body = call.getString("body") else {
            call.reject("Missing title or body")
            return
        }
        
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        
        // Only add sound if not in silent mode - respect user's audio settings
        if !isSilentModeEnabled() {
            content.sound = .default
        }
        
        if let data = call.getObject("data") {
            content.userInfo = data
        }
        
        let identifier = call.getString("id") ?? UUID().uuidString
        let request = UNNotificationRequest(identifier: identifier, content: content, trigger: nil)
        
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                call.reject("Failed to show notification: \(error)")
            } else {
                call.resolve(["id": identifier])
            }
        }
    }
    
    // MARK: - Cancel Notification
    
    @objc func cancelNotification(_ call: CAPPluginCall) {
        guard let id = call.getString("id") else {
            call.reject("Missing notification id")
            return
        }
        
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [id])
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
        call.resolve()
    }
    
    // MARK: - Cancel All Notifications
    
    @objc func cancelAllNotifications(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
        call.resolve()
    }
}
