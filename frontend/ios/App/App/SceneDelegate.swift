// ios/App/App/SceneDelegate.swift
// Adopts the UIScene lifecycle, required by iOS 26/27. Without this the app is
// terminated at launch with UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption.
//
// It loads Capacitor's Main.storyboard (whose initial VC is CAPBridgeViewController)
// into a scene-owned window, and forwards deep-link / universal-link callbacks to
// Capacitor's ApplicationDelegateProxy — CRITICAL, because with scenes the old
// AppDelegate.application(_:open:) is no longer called, and the WalletConnect return
// deep link (and any Universal Links) would otherwise stop working.

import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene,
               willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = (scene as? UIWindowScene) else { return }

        let window = UIWindow(windowScene: windowScene)
        let storyboard = UIStoryboard(name: "Main", bundle: nil)
        window.rootViewController = storyboard.instantiateInitialViewController()
        self.window = window
        window.makeKeyAndVisible()

        // App launched via a deep link / universal link
        if let urlContext = connectionOptions.urlContexts.first {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared, open: urlContext.url, options: [:])
        }
        if let userActivity = connectionOptions.userActivities.first {
            _ = ApplicationDelegateProxy.shared.application(
                UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
        }
    }

    // Deep link / custom scheme while the app is already running (e.g. wallet return)
    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        guard let url = URLContexts.first?.url else { return }
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared, open: url, options: [:])
    }

    // Universal Links while running
    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(
            UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}
