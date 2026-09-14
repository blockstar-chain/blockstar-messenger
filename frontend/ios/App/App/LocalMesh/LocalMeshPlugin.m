// ios/App/App/LocalMesh/LocalMeshPlugin.m
// Registers the Swift LocalMeshPlugin with Capacitor's runtime. Required — iOS
// Capacitor plugins are exposed to JS via this CAP_PLUGIN macro.

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(LocalMeshPlugin, "LocalMesh",
    CAP_PLUGIN_METHOD(register, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(discover, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stopDiscovery, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(connect, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(send, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(broadcast, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(disconnect, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
)
