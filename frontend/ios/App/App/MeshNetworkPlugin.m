#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(MeshNetworkPlugin, "MeshNetworkPlugin",
    CAP_PLUGIN_METHOD(initialize, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(startDiscovery, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stopDiscovery, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(startAdvertising, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stopAdvertising, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getDiscoveredPeers, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(connectToPeer, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(sendMessage, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(broadcastMessage, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getStatus, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(cleanup, CAPPluginReturnPromise);
)
