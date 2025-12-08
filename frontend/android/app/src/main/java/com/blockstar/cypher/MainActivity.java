// android/app/src/main/java/com/blockstar/cypher/MainActivity.java
package com.blockstar.cypher;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Notification;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;
import com.blockstar.cypher.CallFirebaseMessagingService;
import com.blockstar.cypher.wifidirect.WifiDirectPlugin;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "BlockStarCypher";

    // Channel IDs (must match backend FCM channelId values)
    public static final String CHANNEL_CALLS = "calls";
    public static final String CHANNEL_INCOMING_CALLS = "incoming_calls"; // For foreground service
    public static final String CHANNEL_MESSAGES = "messages";
    public static final String CHANNEL_GENERAL = "general";

    // Store pending call data to be retrieved by JS
    private static JSObject pendingCallData = null;
    private static boolean hasPendingCall = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WifiDirectPlugin.class);  // Add this line
        super.onCreate(savedInstanceState);

        Log.d(TAG, "════════════════════════════════════════════════════════════");
        Log.d(TAG, "🚀 BlockStar Cypher MainActivity onCreate");
        Log.d(TAG, "════════════════════════════════════════════════════════════");

        // Create notification channels FIRST before anything else
        createNotificationChannels();
        
        // Register custom plugins
        registerPlugin(AudioRoutingPlugin.class);
        registerPlugin(IncomingCallPlugin.class);
        
        // Check if opened from incoming call notification
        handleIncomingCallIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Log.d(TAG, "📞 onNewIntent received");
        handleIncomingCallIntent(intent);
    }

    /**
     * Handle intent from incoming call notification
     * Stores the call data so JS can retrieve it
     */
    private void handleIncomingCallIntent(Intent intent) {
        if (intent == null) {
            Log.d(TAG, "📞 No intent to process");
            return;
        }

        boolean fromNotification = intent.getBooleanExtra("fromNotification", false);
        String callId = intent.getStringExtra("callId");

        Log.d(TAG, "📞 Processing intent - fromNotification: " + fromNotification + ", callId: " + callId);

        if (fromNotification && callId != null) {
            String caller = intent.getStringExtra("caller");
            String callerId = intent.getStringExtra("callerId");
            String callType = intent.getStringExtra("callType");

            Log.d(TAG, "════════════════════════════════════════════════════════════");
            Log.d(TAG, "📞 INCOMING CALL FROM NOTIFICATION");
            Log.d(TAG, "📞 Call ID: " + callId);
            Log.d(TAG, "📞 Caller: " + caller);
            Log.d(TAG, "📞 Caller ID: " + callerId);
            Log.d(TAG, "📞 Call Type: " + callType);
            Log.d(TAG, "════════════════════════════════════════════════════════════");

            // Store call data for JS to retrieve
            pendingCallData = new JSObject();
            pendingCallData.put("callId", callId);
            pendingCallData.put("caller", caller != null ? caller : "Unknown");
            pendingCallData.put("callerId", callerId != null ? callerId : "");
            pendingCallData.put("callType", callType != null ? callType : "audio");
            pendingCallData.put("fromNotification", true);
            pendingCallData.put("timestamp", System.currentTimeMillis());
            hasPendingCall = true;

            Log.d(TAG, "📞 ✅ Call data stored, waiting for JS to retrieve");

            // Stop the incoming call service (notification was tapped)
            stopIncomingCallService();

            // Clear the intent extras to prevent re-processing
            intent.removeExtra("fromNotification");
            intent.removeExtra("callId");
        }
    }

    /**
     * Stop the IncomingCallService when call is answered/handled
     */
    private void stopIncomingCallService() {
        try {
            Intent serviceIntent = new Intent(this, IncomingCallService.class);
            serviceIntent.setAction("CALL_ANSWERED");
            stopService(serviceIntent);
            Log.d(TAG, "📞 ✅ IncomingCallService stopped");
        } catch (Exception e) {
            Log.e(TAG, "📞 Error stopping service: " + e.getMessage());
        }
    }

    /**
     * Called by IncomingCallPlugin to get pending call data
     */
    public static JSObject getPendingCallData() {
        if (hasPendingCall && pendingCallData != null) {
            Log.d(TAG, "📞 Returning pending call data to JS");
            JSObject data = pendingCallData;
            // Clear after retrieval
            pendingCallData = null;
            hasPendingCall = false;
            return data;
        }
        return null;
    }

    /**
     * Check if there's a pending call
     */
    public static boolean hasPendingCall() {
        return hasPendingCall;
    }

    /**
     * Clear pending call (called when call is handled)
     */
    public static void clearPendingCall() {
        pendingCallData = null;
        hasPendingCall = false;
        Log.d(TAG, "📞 Pending call cleared");
    }

    /**
     * Create notification channels for Android 8.0+ (Oreo)
     * IMPORTANT: These channels MUST be created before any notifications are sent
     */
    private void createNotificationChannels() {

        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            Log.d(TAG, "Notification channels not needed for API < 26");
            return;
        }

        Log.d(TAG, "Creating notification channels...");

        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (manager == null) {
            Log.e(TAG, "❌ NotificationManager is null!");
            return;
        }

        // ===========================================================
        // CALLS CHANNEL - High priority (FCM push notifications)
        // This channel is used by Firebase Cloud Messaging
        // ===========================================================
        NotificationChannel callChannel = new NotificationChannel(
                CHANNEL_CALLS,
                "Incoming Calls",
                NotificationManager.IMPORTANCE_HIGH  // IMPORTANCE_HIGH = wake device + heads-up
        );

        callChannel.setDescription("Notifications for incoming voice and video calls");
        callChannel.enableVibration(true);
        callChannel.setVibrationPattern(new long[]{0, 500, 200, 500, 200, 500, 200, 500});
        callChannel.enableLights(true);
        callChannel.setLightColor(android.graphics.Color.BLUE);
        callChannel.setBypassDnd(true); // Allow ringing even in Do Not Disturb
        callChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        callChannel.setShowBadge(true);

        // Set ringtone sound for calls
        AudioAttributes callSoundAttrs = new AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .build();

        callChannel.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                callSoundAttrs
        );

        manager.createNotificationChannel(callChannel);
        Log.d(TAG, "✅ Created '" + CHANNEL_CALLS + "' channel (IMPORTANCE_HIGH)");

        // ===========================================================
        // INCOMING CALLS CHANNEL - For Foreground Service
        // Used by IncomingCallService for full-screen intent
        // ===========================================================
        NotificationChannel incomingCallChannel = new NotificationChannel(
                CHANNEL_INCOMING_CALLS,
                "Incoming Call Alerts",
                NotificationManager.IMPORTANCE_HIGH
        );

        incomingCallChannel.setDescription("Full-screen alerts for incoming calls");
        incomingCallChannel.enableVibration(true);
        incomingCallChannel.setVibrationPattern(new long[]{0, 500, 200, 500, 200, 500, 200, 500});
        incomingCallChannel.enableLights(true);
        incomingCallChannel.setLightColor(android.graphics.Color.BLUE);
        incomingCallChannel.setBypassDnd(true);
        incomingCallChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        
        incomingCallChannel.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE),
                callSoundAttrs
        );

        manager.createNotificationChannel(incomingCallChannel);
        Log.d(TAG, "✅ Created '" + CHANNEL_INCOMING_CALLS + "' channel (IMPORTANCE_HIGH)");

        // ===========================================================
        // MESSAGES CHANNEL - High priority for chat messages
        // ===========================================================
        NotificationChannel messagesChannel = new NotificationChannel(
                CHANNEL_MESSAGES,
                "Messages",
                NotificationManager.IMPORTANCE_HIGH
        );

        messagesChannel.setDescription("Notifications for new messages");
        messagesChannel.enableVibration(true);
        messagesChannel.setVibrationPattern(new long[]{0, 250, 100, 250});
        messagesChannel.enableLights(true);
        messagesChannel.setLightColor(android.graphics.Color.GREEN);
        messagesChannel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        messagesChannel.setShowBadge(true);

        messagesChannel.setSound(
                RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION),
                new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .build()
        );

        manager.createNotificationChannel(messagesChannel);
        Log.d(TAG, "✅ Created '" + CHANNEL_MESSAGES + "' channel (IMPORTANCE_HIGH)");

        // ===========================================================
        // GENERAL CHANNEL - Default notifications
        // ===========================================================
        NotificationChannel generalChannel = new NotificationChannel(
                CHANNEL_GENERAL,
                "General",
                NotificationManager.IMPORTANCE_DEFAULT
        );

        generalChannel.setDescription("General notifications");
        generalChannel.enableVibration(true);

        manager.createNotificationChannel(generalChannel);
        Log.d(TAG, "✅ Created '" + CHANNEL_GENERAL + "' channel (IMPORTANCE_DEFAULT)");

        Log.d(TAG, "════════════════════════════════════════════════════════════");
        Log.d(TAG, "✅ All notification channels created successfully!");
        Log.d(TAG, "════════════════════════════════════════════════════════════");
    }
}
