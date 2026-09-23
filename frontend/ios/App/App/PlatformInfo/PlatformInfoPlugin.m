// ios/App/App/PlatformInfo/PlatformInfoPlugin.m
// Registers PlatformInfoPlugin with Capacitor (JS name: "PlatformInfo").

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(PlatformInfoPlugin, "PlatformInfo",
    CAP_PLUGIN_METHOD(getInfo, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(openExternal, CAPPluginReturnPromise);
)
