package world.blockstar.cypher;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class CallFirebaseMessagingService extends FirebaseMessagingService {
    private static final String TAG = "FCMService";
    private static final String PREFS_NAME = "BlockStarPrefs";
    private static final String KEY_FCM_TOKEN = "fcm_token";
    
    // Notification channel IDs - MUST MATCH what backend sends
    public static final String CHANNEL_CALLS = "calls";
    public static final String CHANNEL_MESSAGES = "messages";
    public static final String CHANNEL_MISSED_CALLS = "missed_calls";

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "📬 FCM SERVICE CREATED");
        Log.d(TAG, "═══════════════════════════════════════");
        
        // CRITICAL: Create notification channels IMMEDIATELY on service creation
        // This ensures channels exist BEFORE any FCM notification arrives
        createAllNotificationChannels();
    }

    /**
     * Create ALL notification channels on service start
     * This ensures channels exist BEFORE FCM tries to use them
     */
    private void createAllNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) return;

        Log.d(TAG, "📢 Creating notification channels...");

        // ═══════════════════════════════════════════════════════════════
        // CALLS CHANNEL - MAXIMUM PRIORITY for incoming calls
        // ═══════════════════════════════════════════════════════════════
        NotificationChannel callsChannel = new NotificationChannel(
            CHANNEL_CALLS,
            "Incoming Calls",
            NotificationManager.IMPORTANCE_HIGH
        );
        callsChannel.setDescription("Notifications for incoming voice and video calls");
        callsChannel.enableLights(true);
        callsChannel.setLightColor(0xFF3B82F6); // Blue
        callsChannel.enableVibration(true);
        callsChannel.setVibrationPattern(new long[]{0, 1000, 500, 1000, 500, 1000});
        callsChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        callsChannel.setBypassDnd(true); // Can bypass Do Not Disturb
        
        // Set ringtone sound
        Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        callsChannel.setSound(ringtoneUri, audioAttributes);
        
        manager.createNotificationChannel(callsChannel);
        Log.d(TAG, "  ✅ Created 'calls' channel (IMPORTANCE_HIGH)");

        // ═══════════════════════════════════════════════════════════════
        // MESSAGES CHANNEL - HIGH PRIORITY for new messages
        // ═══════════════════════════════════════════════════════════════
        NotificationChannel messagesChannel = new NotificationChannel(
            CHANNEL_MESSAGES,
            "Messages",
            NotificationManager.IMPORTANCE_HIGH
        );
        messagesChannel.setDescription("Notifications for new messages");
        messagesChannel.enableLights(true);
        messagesChannel.setLightColor(0xFF10B981); // Green
        messagesChannel.enableVibration(true);
        messagesChannel.setVibrationPattern(new long[]{0, 250, 250, 250});
        messagesChannel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        
        // Set notification sound
        Uri notificationUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        AudioAttributes msgAudioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        messagesChannel.setSound(notificationUri, msgAudioAttributes);
        
        manager.createNotificationChannel(messagesChannel);
        Log.d(TAG, "  ✅ Created 'messages' channel (IMPORTANCE_HIGH)");

        // ═══════════════════════════════════════════════════════════════
        // MISSED CALLS CHANNEL
        // ═══════════════════════════════════════════════════════════════
        NotificationChannel missedChannel = new NotificationChannel(
            CHANNEL_MISSED_CALLS,
            "Missed Calls",
            NotificationManager.IMPORTANCE_HIGH
        );
        missedChannel.setDescription("Notifications for missed calls");
        missedChannel.enableLights(true);
        missedChannel.setLightColor(0xFFEF4444); // Red
        missedChannel.enableVibration(true);
        missedChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        
        manager.createNotificationChannel(missedChannel);
        Log.d(TAG, "  ✅ Created 'missed_calls' channel (IMPORTANCE_HIGH)");

        Log.d(TAG, "📢 All notification channels created!");
    }

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "🔑 NEW FCM TOKEN RECEIVED");
        Log.d(TAG, "   Token: " + token.substring(0, Math.min(20, token.length())) + "...");
        Log.d(TAG, "═══════════════════════════════════════");
        
        // Save token locally
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        prefs.edit().putString(KEY_FCM_TOKEN, token).apply();
        
        // Token will be sent to server when user logs in via JavaScript
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        
        // Ensure channels exist (in case service was restarted)
        createAllNotificationChannels();
        
        Map<String, String> data = message.getData();
        String type = data.get("type");
        
        // Also check notification payload
        RemoteMessage.Notification notification = message.getNotification();
        
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "📬 FCM MESSAGE RECEIVED");
        Log.d(TAG, "Type: " + type);
        Log.d(TAG, "Data: " + data.toString());
        if (notification != null) {
            Log.d(TAG, "Notification Title: " + notification.getTitle());
            Log.d(TAG, "Notification Body: " + notification.getBody());
            Log.d(TAG, "Notification Tag: " + notification.getTag());
        }
        Log.d(TAG, "═══════════════════════════════════════");

        // Send to backend for remote debugging
        DebugLogger.log("📬 FCM MESSAGE RECEIVED - Type: " + type, data.toString());

        if (type == null) {
            // If no type in data, check if this is a notification-only message
            if (notification != null) {
                Log.d(TAG, "📬 Notification-only message, Android system will display it");
                DebugLogger.log("📬 Notification-only message (no type in data)");
            } else {
                Log.w(TAG, "No type in FCM message and no notification payload");
                DebugLogger.log("⚠️ No type in FCM message and no notification payload");
            }
            return;
        }

        switch (type) {
            case "incoming_call":
                DebugLogger.log("📞 Processing incoming_call message...");
                handleIncomingCall(data, notification);
                break;
            case "message":
                handleNewMessage(data);
                break;
            case "missed_call":
                handleMissedCall(data);
                break;
            case "badge_update":
                handleBadgeUpdate(data);
                break;
            case "call_cancelled":
                handleCallCancelled(data);
                break;
            default:
                Log.w(TAG, "Unknown FCM message type: " + type);
                DebugLogger.log("⚠️ Unknown FCM message type: " + type);
        }
    }

    private void handleIncomingCall(Map<String, String> data, RemoteMessage.Notification fcmNotification) {
        String callId = data.get("callId");
        String callerId = data.get("callerId");
        String callerName = data.get("callerName");
        if (callerName == null || callerName.isEmpty()) {
            callerName = data.get("caller"); // Fallback
        }
        String callType = data.get("callType");

        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "📞 INCOMING CALL");
        Log.d(TAG, "  Call ID: " + callId);
        Log.d(TAG, "  Caller: " + callerName + " (" + callerId + ")");
        Log.d(TAG, "  Type: " + callType);
        Log.d(TAG, "═══════════════════════════════════════");

        // Send to backend for remote debugging
        DebugLogger.logCall("INCOMING CALL (FCM)", callId, callerId, callerName, callType);

        // ═══════════════════════════════════════════════════════════════
        // CRITICAL: Cancel the FCM system notification IMMEDIATELY
        // 
        // The backend sends a notification payload to wake the device,
        // but we want our IncomingCallService to show the notification
        // with Answer/Decline buttons and proper ringtone control.
        //
        // The notification tag is: "incoming-call-{callId}"
        // ═══════════════════════════════════════════════════════════════
        cancelFcmNotification(callId);
        DebugLogger.log("Cancelled FCM notification with tag: incoming-call-" + callId);

        // Store call data in SharedPreferences for the app to read
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        prefs.edit()
            .putString("pending_call_id", callId)
            .putString("pending_caller_id", callerId)
            .putString("pending_caller_name", callerName != null ? callerName : "Unknown")
            .putString("pending_call_type", callType != null ? callType : "audio")
            .putLong("pending_call_timestamp", System.currentTimeMillis())
            .apply();
        
        DebugLogger.log("Saved call data to SharedPreferences");

        // Start the IncomingCallService to show full-screen notification
        Intent serviceIntent = new Intent(this, IncomingCallService.class);
        serviceIntent.setAction("SHOW_INCOMING_CALL");
        serviceIntent.putExtra("callId", callId);
        serviceIntent.putExtra("callerId", callerId);
        serviceIntent.putExtra("caller", callerName != null ? callerName : "Unknown");
        serviceIntent.putExtra("callType", callType != null ? callType : "audio");

        // Start as foreground service
        DebugLogger.log("Starting IncomingCallService...");
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
                DebugLogger.log("✅ startForegroundService() called successfully");
            } else {
                startService(serviceIntent);
                DebugLogger.log("✅ startService() called successfully (legacy)");
            }
        } catch (Exception e) {
            DebugLogger.error("Failed to start IncomingCallService", e);
        }
        
        Log.d(TAG, "✅ IncomingCallService started");
    }

    /**
     * Cancel the FCM system notification by tag
     * This prevents duplicate notifications (FCM's + app's)
     */
    private void cancelFcmNotification(String callId) {
        try {
            NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null && callId != null) {
                // The tag we set in the backend notification payload
                String tag = "incoming-call-" + callId;
                
                // Cancel by tag (notification ID 0 is used for tagged notifications)
                manager.cancel(tag, 0);
                
                Log.d(TAG, "✅ Cancelled FCM notification with tag: " + tag);
            }
        } catch (Exception e) {
            Log.e(TAG, "Error cancelling FCM notification: " + e.getMessage());
        }
    }

    private void handleNewMessage(Map<String, String> data) {
        String senderName = data.get("senderName");
        String messagePreview = data.get("messagePreview");
        String conversationId = data.get("conversationId");
        String messageId = data.get("messageId");

        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "💬 NEW MESSAGE");
        Log.d(TAG, "  From: " + senderName);
        Log.d(TAG, "  Preview: " + messagePreview);
        Log.d(TAG, "  Conversation: " + conversationId);
        Log.d(TAG, "═══════════════════════════════════════");

        // Start MessageNotificationService to show notification
        Intent serviceIntent = new Intent(this, MessageNotificationService.class);
        serviceIntent.putExtra("senderName", senderName);
        serviceIntent.putExtra("messagePreview", messagePreview);
        serviceIntent.putExtra("conversationId", conversationId);
        serviceIntent.putExtra("messageId", messageId);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    private void handleMissedCall(Map<String, String> data) {
        String callerName = data.get("callerName");
        String callerId = data.get("callerId");
        String callType = data.get("callType");

        Log.d(TAG, "📵 MISSED CALL from " + callerName);

        // Show missed call notification
        Intent serviceIntent = new Intent(this, MissedCallNotificationService.class);
        serviceIntent.putExtra("callerName", callerName);
        serviceIntent.putExtra("callerId", callerId);
        serviceIntent.putExtra("callType", callType);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    private void handleBadgeUpdate(Map<String, String> data) {
        String countStr = data.get("count");
        int count = 0;
        try {
            count = Integer.parseInt(countStr);
        } catch (NumberFormatException e) {
            Log.e(TAG, "Invalid badge count: " + countStr);
        }

        Log.d(TAG, "🔢 Badge update: " + count);
        // Badge is handled by Capacitor plugin on frontend
    }

    private void handleCallCancelled(Map<String, String> data) {
        String callId = data.get("callId");
        
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "📴 CALL CANCELLED: " + callId);
        Log.d(TAG, "═══════════════════════════════════════");

        // Cancel any FCM notification for this call
        cancelFcmNotification(callId);

        // Clear pending call from SharedPreferences
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        prefs.edit()
            .remove("pending_call_id")
            .remove("pending_caller_id")
            .remove("pending_caller_name")
            .remove("pending_call_type")
            .remove("pending_call_timestamp")
            .apply();

        // Stop the IncomingCallService
        Intent serviceIntent = new Intent(this, IncomingCallService.class);
        serviceIntent.setAction("STOP_SERVICE");
        startService(serviceIntent);
    }
    
    /**
     * Static method to create notification channels
     * Can be called from MainActivity on app startup
     */
    public static void createNotificationChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }

        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;

        Log.d(TAG, "📢 Creating notification channels from static method...");

        // CALLS CHANNEL
        NotificationChannel callsChannel = new NotificationChannel(
            CHANNEL_CALLS,
            "Incoming Calls",
            NotificationManager.IMPORTANCE_HIGH
        );
        callsChannel.setDescription("Notifications for incoming voice and video calls");
        callsChannel.enableLights(true);
        callsChannel.enableVibration(true);
        callsChannel.setVibrationPattern(new long[]{0, 1000, 500, 1000, 500, 1000});
        callsChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        callsChannel.setBypassDnd(true);
        
        Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        AudioAttributes audioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        callsChannel.setSound(ringtoneUri, audioAttributes);
        
        manager.createNotificationChannel(callsChannel);

        // MESSAGES CHANNEL
        NotificationChannel messagesChannel = new NotificationChannel(
            CHANNEL_MESSAGES,
            "Messages",
            NotificationManager.IMPORTANCE_HIGH
        );
        messagesChannel.setDescription("Notifications for new messages");
        messagesChannel.enableLights(true);
        messagesChannel.enableVibration(true);
        messagesChannel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
        
        Uri notificationUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
        AudioAttributes msgAudioAttributes = new AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_NOTIFICATION)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build();
        messagesChannel.setSound(notificationUri, msgAudioAttributes);
        
        manager.createNotificationChannel(messagesChannel);

        // MISSED CALLS CHANNEL
        NotificationChannel missedChannel = new NotificationChannel(
            CHANNEL_MISSED_CALLS,
            "Missed Calls",
            NotificationManager.IMPORTANCE_HIGH
        );
        missedChannel.setDescription("Notifications for missed calls");
        missedChannel.enableLights(true);
        missedChannel.enableVibration(true);
        missedChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        
        manager.createNotificationChannel(missedChannel);

        Log.d(TAG, "📢 All notification channels created from static method!");
    }
}
