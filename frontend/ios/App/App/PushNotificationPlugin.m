#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(PushNotificationPlugin, "PushNotificationPlugin",
    CAP_PLUGIN_METHOD(requestPermission, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(checkPermission, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getPendingNotificationData, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(clearPendingData, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setBadge, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(clearBadge, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(showLocalNotification, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(cancelNotification, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(cancelAllNotifications, CAPPluginReturnPromise);
)
