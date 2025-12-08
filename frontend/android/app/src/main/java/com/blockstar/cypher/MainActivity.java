// android/app/src/main/java/com/blockstar/cypher/MainActivity.java
package com.blockstar.cypher;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Notification;
import android.content.Context;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    private static final String TAG = "BlockStarCypher";

    // Channel IDs (must match backend FCM channelId values)
    public static final String CHANNEL_CALLS = "calls";
    public static final String CHANNEL_INCOMING_CALLS = "incoming_calls"; // For foreground service
    public static final String CHANNEL_MESSAGES = "messages";
    public static final String CHANNEL_GENERAL = "general";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Log.d(TAG, "════════════════════════════════════════════════════════════");
        Log.d(TAG, "🚀 BlockStar Cypher MainActivity onCreate");
        Log.d(TAG, "════════════════════════════════════════════════════════════");

        // Create notification channels FIRST before anything else
        createNotificationChannels();
        
        // Register custom plugins
        registerPlugin(AudioRoutingPlugin.class);
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
