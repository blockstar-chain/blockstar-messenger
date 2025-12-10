package world.blockstar.cypher;

import android.content.Intent;
import android.content.SharedPreferences;
import android.util.Log;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

public class CallFirebaseMessagingService extends FirebaseMessagingService {
    private static final String TAG = "FCMService";
    private static final String PREFS_NAME = "BlockStarPrefs";
    private static final String KEY_FCM_TOKEN = "fcm_token";

    @Override
    public void onNewToken(String token) {
        super.onNewToken(token);
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "🔑 New FCM token received");
        Log.d(TAG, "═══════════════════════════════════════");
        
        // Save token locally
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        prefs.edit().putString(KEY_FCM_TOKEN, token).apply();
        
        // Token will be sent to server when user logs in via JavaScript
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        super.onMessageReceived(message);
        
        Map<String, String> data = message.getData();
        String type = data.get("type");
        
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "📬 FCM MESSAGE RECEIVED");
        Log.d(TAG, "Type: " + type);
        Log.d(TAG, "Data: " + data.toString());
        Log.d(TAG, "═══════════════════════════════════════");

        if (type == null) {
            Log.w(TAG, "No type in FCM message");
            return;
        }

        switch (type) {
            case "incoming_call":
                handleIncomingCall(data);
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
        }
    }

    private void handleIncomingCall(Map<String, String> data) {
        String callId = data.get("callId");
        String callerId = data.get("callerId");
        String callerName = data.get("callerName");
        String callType = data.get("callType");

        Log.d(TAG, "📞 INCOMING CALL");
        Log.d(TAG, "  Call ID: " + callId);
        Log.d(TAG, "  Caller: " + callerName + " (" + callerId + ")");
        Log.d(TAG, "  Type: " + callType);

        // Start the IncomingCallService to show full-screen notification
        Intent serviceIntent = new Intent(this, IncomingCallService.class);
        serviceIntent.setAction("SHOW_INCOMING_CALL");
        serviceIntent.putExtra("callId", callId);
        serviceIntent.putExtra("callerId", callerId);
        serviceIntent.putExtra("caller", callerName != null ? callerName : "Unknown");
        serviceIntent.putExtra("callType", callType != null ? callType : "audio");

        // Start as foreground service
        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
        
        Log.d(TAG, "✅ IncomingCallService started");
    }

    private void handleNewMessage(Map<String, String> data) {
        String senderName = data.get("senderName");
        String messagePreview = data.get("messagePreview");
        String conversationId = data.get("conversationId");
        String messageId = data.get("messageId");

        Log.d(TAG, "💬 NEW MESSAGE");
        Log.d(TAG, "  From: " + senderName);
        Log.d(TAG, "  Preview: " + messagePreview);
        Log.d(TAG, "  Conversation: " + conversationId);

        // Start MessageNotificationService to show notification
        Intent serviceIntent = new Intent(this, MessageNotificationService.class);
        serviceIntent.putExtra("senderName", senderName);
        serviceIntent.putExtra("messagePreview", messagePreview);
        serviceIntent.putExtra("conversationId", conversationId);
        serviceIntent.putExtra("messageId", messageId);

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
            startForegroundService(serviceIntent);
        } else {
            startService(serviceIntent);
        }
    }

    private void handleMissedCall(Map<String, String> data) {
        String callerName = data.get("callerName");
        String callType = data.get("callType");

        Log.d(TAG, "📵 MISSED CALL from " + callerName);

        // Show missed call notification
        Intent serviceIntent = new Intent(this, MissedCallNotificationService.class);
        serviceIntent.putExtra("callerName", callerName);
        serviceIntent.putExtra("callType", callType);

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
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

        // Update app badge using ShortcutBadger or similar
        // This is handled by the Capacitor badge plugin on the frontend
    }

    private void handleCallCancelled(Map<String, String> data) {
        String callId = data.get("callId");
        
        Log.d(TAG, "📴 Call cancelled: " + callId);

        // Stop the IncomingCallService
        Intent serviceIntent = new Intent(this, IncomingCallService.class);
        serviceIntent.setAction("STOP_SERVICE");
        startService(serviceIntent);
    }
}
