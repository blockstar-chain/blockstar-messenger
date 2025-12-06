// iOS Objective-C bridge for AudioRoutingPlugin
// Save this as: ios/App/App/AudioRoutingPlugin.m

#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(AudioRoutingPlugin, "AudioRouting",
    CAP_PLUGIN_METHOD(setVoiceCallMode, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setDefaultMode, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setSpeakerOn, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setSpeakerOff, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(isSpeakerOn, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getCurrentRoute, CAPPluginReturnPromise);
)
