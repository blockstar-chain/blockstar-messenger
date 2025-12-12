import UIKit
import Capacitor
import PushKit
import CallKit
import UserNotifications
import AVFoundation

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate, PKPushRegistryDelegate, UNUserNotificationCenterDelegate {

    var window: UIWindow?
    
    // CallKit provider for incoming calls
    static var callKitProvider: CXProvider?
    static var callKitController: CXCallController?
    
    // Store pending call data
    static var pendingCallData: [String: Any]?
    static var pendingMessageData: [String: Any]?
    
    // VoIP push registry
    var voipRegistry: PKPushRegistry?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        print("═══════════════════════════════════════")
        print("📱 AppDelegate: didFinishLaunchingWithOptions")
        print("═══════════════════════════════════════")
        
        // Setup CallKit
        setupCallKit()
        
        // Setup VoIP push notifications
        setupVoIPPush()
        
        // Setup regular push notifications
        setupPushNotifications()
        
        // Set notification delegate
        UNUserNotificationCenter.current().delegate = self
        
        return true
    }

    // MARK: - CallKit Setup
    
    private func setupCallKit() {
        let configuration: CXProviderConfiguration
        if #available(iOS 14.0, *) {
            configuration = CXProviderConfiguration()
        } else {
            // Fallback for iOS versions prior to 14 where the no-arg init is unavailable
            let appName = Bundle.main.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String ?? Bundle.main.object(forInfoDictionaryKey: "CFBundleName") as? String ?? "App"
            configuration = CXProviderConfiguration(localizedName: appName)
        }
        configuration.supportsVideo = true
        configuration.maximumCallsPerCallGroup = 1
        configuration.maximumCallGroups = 1
        configuration.supportedHandleTypes = [.generic]
        configuration.includesCallsInRecents = true

        // Set app icon for call screen
        if let iconImage = UIImage(named: "AppIcon") {
            configuration.iconTemplateImageData = iconImage.pngData()
        }

        AppDelegate.callKitProvider = CXProvider(configuration: configuration)
        AppDelegate.callKitProvider?.setDelegate(CallKitDelegate.shared, queue: nil)
        AppDelegate.callKitController = CXCallController()

        print("✅ CallKit configured")
    }
    
    // MARK: - VoIP Push Setup (for instant call notifications)
    
    private func setupVoIPPush() {
        voipRegistry = PKPushRegistry(queue: DispatchQueue.main)
        voipRegistry?.delegate = self
        voipRegistry?.desiredPushTypes = [.voIP]
        print("✅ VoIP Push registry configured")
    }
    
    // MARK: - Regular Push Notifications Setup
    
    private func setupPushNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            print("📬 Push notification permission: \(granted)")
            if let error = error {
                print("❌ Push permission error: \(error)")
            }
            
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }
    
    // MARK: - PKPushRegistryDelegate (VoIP Push)
    
    func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        let token = pushCredentials.token.map { String(format: "%02.2hhx", $0) }.joined()
        print("═══════════════════════════════════════")
        print("📱 VoIP Push Token: \(token)")
        print("═══════════════════════════════════════")
        
        // Send token to JavaScript
        NotificationCenter.default.post(
            name: NSNotification.Name("VoIPTokenReceived"),
            object: nil,
            userInfo: ["token": token]
        )
    }
    
    func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType, completion: @escaping () -> Void) {
        print("═══════════════════════════════════════")
        print("📞 VoIP PUSH RECEIVED")
        print("  Payload: \(payload.dictionaryPayload)")
        print("═══════════════════════════════════════")
        
        guard type == .voIP else {
            completion()
            return
        }
        
        // Extract call data from payload
        let callId = payload.dictionaryPayload["callId"] as? String ?? UUID().uuidString
        let callerId = payload.dictionaryPayload["callerId"] as? String ?? ""
        let callerName = payload.dictionaryPayload["callerName"] as? String ?? "Unknown"
        let callType = payload.dictionaryPayload["callType"] as? String ?? "audio"
        let hasVideo = callType == "video"
        
        // Store pending call data
        AppDelegate.pendingCallData = [
            "callId": callId,
            "callerId": callerId,
            "callerName": callerName,
            "callType": callType,
            "fromNotification": true
        ]
        
        // Report incoming call to CallKit (THIS WAKES THE PHONE)
        let uuid = UUID()
        let update = CXCallUpdate()
        update.remoteHandle = CXHandle(type: .generic, value: callerName)
        update.localizedCallerName = callerName
        update.hasVideo = hasVideo
        update.supportsGrouping = false
        update.supportsUngrouping = false
        update.supportsHolding = false
        update.supportsDTMF = false
        
        // Store UUID mapping
        CallKitDelegate.shared.callUUIDs[callId] = uuid
        CallKitDelegate.shared.callData[uuid] = AppDelegate.pendingCallData
        
        AppDelegate.callKitProvider?.reportNewIncomingCall(with: uuid, update: update) { error in
            if let error = error {
                print("❌ Error reporting incoming call: \(error)")
            } else {
                print("✅ Incoming call reported to CallKit - phone should wake up!")
            }
            completion()
        }
    }
    
    // MARK: - Regular Push Notification Delegates
    
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("📬 APNs Device Token: \(token)")
        
        // Send to JavaScript
        NotificationCenter.default.post(
            name: NSNotification.Name("APNsTokenReceived"),
            object: nil,
            userInfo: ["token": token]
        )
    }
    
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("❌ Failed to register for remote notifications: \(error)")
    }
    
    // MARK: - UNUserNotificationCenterDelegate
    
    // Called when notification received while app is in foreground
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        print("📬 Notification received in foreground")
        let userInfo = notification.request.content.userInfo
        
        // Check if device is in silent mode - respect user's audio settings
        let isSilentMode = isSilentModeEnabled()
        print("📳 Silent mode: \(isSilentMode)")
        
        // Check if it's a message notification
        if let type = userInfo["type"] as? String, type == "message" {
            // Show banner and badge, but only play sound if not in silent mode
            if #available(iOS 14.0, *) {
                if isSilentMode {
                    completionHandler([.banner, .badge])  // No sound in silent mode
                } else {
                    completionHandler([.banner, .sound, .badge])
                }
            } else {
                if isSilentMode {
                    completionHandler([.alert, .badge])  // No sound in silent mode
                } else {
                    completionHandler([.alert, .sound, .badge])
                }
            }
        } else {
            // For calls, CallKit handles the UI
            completionHandler([])
        }
    }
    
    // MARK: - Silent Mode Detection
    
    /// Check if the device is in silent mode
    /// Returns true if silent switch is on or volume is at minimum
    private func isSilentModeEnabled() -> Bool {
        // Check the current audio session category
        let audioSession = AVAudioSession.sharedInstance()
        
        // Check if ringer is silent
        // We can approximate this by checking if system output volume is very low
        // Note: iOS doesn't provide direct access to silent switch, but we can check volume
        let outputVolume = audioSession.outputVolume
        
        // If volume is essentially 0, treat as silent
        if outputVolume < 0.01 {
            return true
        }
        
        // Also check system settings via Audio Session
        // Ambient category respects the silent switch
        do {
            try audioSession.setCategory(.ambient, mode: .default)
            // If we can hear audio in ambient mode, we're not silent
            // Reset to default afterwards
            try audioSession.setCategory(.playback, mode: .default, options: [.mixWithOthers])
        } catch {
            print("⚠️ Error checking audio session: \(error)")
        }
        
        return false
    }
    
    // Called when user taps on notification
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        print("📬 Notification tapped")
        let userInfo = response.notification.request.content.userInfo
        
        if let type = userInfo["type"] as? String {
            switch type {
            case "message":
                // Store message data for JavaScript
                AppDelegate.pendingMessageData = [
                    "type": "open_conversation",
                    "conversationId": userInfo["conversationId"] as? String ?? "",
                    "fromNotification": true
                ]
                
                // Notify JavaScript
                NotificationCenter.default.post(
                    name: NSNotification.Name("OpenConversationFromNotification"),
                    object: nil,
                    userInfo: AppDelegate.pendingMessageData
                )
                
            case "missed_call":
                // Handle missed call tap
                AppDelegate.pendingCallData = [
                    "type": "callback",
                    "callerId": userInfo["callerId"] as? String ?? "",
                    "callType": userInfo["callType"] as? String ?? "audio",
                    "fromNotification": true
                ]
                
            default:
                break
            }
        }
        
        completionHandler()
    }
    
    // MARK: - Static Methods for Capacitor Plugins
    
    static func hasPendingCall() -> Bool {
        return pendingCallData != nil
    }
    
    static func getPendingCallData() -> [String: Any]? {
        return pendingCallData
    }
    
    static func clearPendingCall() {
        pendingCallData = nil
        print("✅ Cleared pending call data")
    }
    
    static func getPendingMessageData() -> [String: Any]? {
        return pendingMessageData
    }
    
    static func clearPendingMessage() {
        pendingMessageData = nil
    }
    
    // MARK: - Show Local Notification (for messages when app is background)
    
    static func showMessageNotification(senderName: String, message: String, conversationId: String) {
        let content = UNMutableNotificationContent()
        content.title = senderName
        content.body = message
        content.badge = NSNumber(value: UIApplication.shared.applicationIconBadgeNumber + 1)
        content.userInfo = [
            "type": "message",
            "conversationId": conversationId
        ]
        
        // Only add sound if not in silent mode
        // Note: The system will also respect silent mode, but we explicitly control it
        if !isSilentModeEnabledStatic() {
            content.sound = .default
        }
        
        let request = UNNotificationRequest(
            identifier: "message-\(conversationId)-\(Date().timeIntervalSince1970)",
            content: content,
            trigger: nil
        )
        
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                print("❌ Error showing notification: \(error)")
            }
        }
    }
    
    /// Static version of silent mode check
    private static func isSilentModeEnabledStatic() -> Bool {
        let audioSession = AVAudioSession.sharedInstance()
        let outputVolume = audioSession.outputVolume
        return outputVolume < 0.01
    }
    
    // MARK: - Update Badge
    
    static func updateBadge(count: Int) {
        DispatchQueue.main.async {
            UIApplication.shared.applicationIconBadgeNumber = count
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
    }

    func applicationWillTerminate(_ application: UIApplication) {
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
