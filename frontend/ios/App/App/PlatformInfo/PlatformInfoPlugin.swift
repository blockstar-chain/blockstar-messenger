// ios/App/App/PlatformInfo/PlatformInfoPlugin.swift
// Tells the web layer whether this iOS build is running on a Mac (Apple Silicon
// "Designed for iPad/iPhone" via TestFlight, or Mac Catalyst), and opens URLs in the
// REAL system browser (UIApplication.open). On a Mac that's the user's default
// browser, which has their wallet extensions; it also launches BlockStar Browser via
// its blockstarbrowser:// scheme.

import Foundation
import UIKit
import Capacitor

@objc(PlatformInfoPlugin)
public class PlatformInfoPlugin: CAPPlugin {

    @objc func getInfo(_ call: CAPPluginCall) {
        let info = ProcessInfo.processInfo
        call.resolve([
            "isiOSAppOnMac": info.isiOSAppOnMac,
            "isMacCatalyst": info.isMacCatalystApp,
        ])
    }

    @objc func openExternal(_ call: CAPPluginCall) {
        guard let raw = call.getString("url"), let url = URL(string: raw) else {
            call.reject("Invalid url")
            return
        }
        // Only web URLs and BlockStar Browser's scheme.
        let allowed = ["https", "http", "blockstarbrowser"]
        guard let scheme = url.scheme?.lowercased(), allowed.contains(scheme) else {
            call.reject("Blocked URL scheme")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                // opened == false when no app handles the URL (e.g. BlockStar Browser not installed)
                call.resolve(["opened": opened])
            }
        }
    }
}
