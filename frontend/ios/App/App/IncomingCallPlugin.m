#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(IncomingCallPlugin, "IncomingCallPlugin",
    CAP_PLUGIN_METHOD(checkPendingCall, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(clearPendingCall, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(reportOutgoingCall, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(reportOutgoingCallConnected, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(endCall, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(reportCallEnded, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setMuted, CAPPluginReturnPromise);
)
