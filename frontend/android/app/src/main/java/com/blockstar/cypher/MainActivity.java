package world.blockstar.cypher;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.ContextCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.JSObject;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";
    
    // Store pending call data to pass to JavaScript after bridge is ready
    private static JSObject pendingCallData = null;
    private static JSObject pendingMessageData = null;

    // Permission request launcher for Android 13+
    private ActivityResultLauncher<String> notificationPermissionLauncher;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "📱 MainActivity onCreate");
        Log.d(TAG, "   Android Version: " + Build.VERSION.SDK_INT);
        Log.d(TAG, "═══════════════════════════════════════");

        // ═══════════════════════════════════════════════════════════════
        // Initialize debug logger for remote debugging
        // Set your backend URL here (or it will be set by JavaScript later)
        // ═══════════════════════════════════════════════════════════════
        DebugLogger.init(this);
        // TODO: Set your actual backend URL here:
        // DebugLogger.setApiUrl("https://your-backend.com");
        // Or call DebugLogger.setApiUrl() from JavaScript via a Capacitor plugin
        
        DebugLogger.log("📱 MainActivity onCreate - Android " + Build.VERSION.SDK_INT);

        // Set up notification permission launcher
        notificationPermissionLauncher = registerForActivityResult(
            new ActivityResultContracts.RequestPermission(),
            isGranted -> {
                if (isGranted) {
                    Log.d(TAG, "✅ POST_NOTIFICATIONS permission GRANTED");
                    DebugLogger.log("✅ POST_NOTIFICATIONS permission GRANTED");
                } else {
                    Log.e(TAG, "❌ POST_NOTIFICATIONS permission DENIED");
                    Log.e(TAG, "   User will not receive call notifications!");
                    DebugLogger.log("❌ POST_NOTIFICATIONS permission DENIED - User will not receive notifications!");
                }
            }
        );

        // ═══════════════════════════════════════════════════════════════
        // CRITICAL: Create notification channels IMMEDIATELY on app start
        // This ensures channels exist BEFORE any FCM notification arrives
        // ═══════════════════════════════════════════════════════════════
        CallFirebaseMessagingService.createNotificationChannels(this);
        Log.d(TAG, "✅ Notification channels created on app start");

        // ═══════════════════════════════════════════════════════════════
        // CRITICAL: Request notification permission on Android 13+
        // Without this, NO notifications will appear!
        // ═══════════════════════════════════════════════════════════════
        requestNotificationPermission();

        // Handle the intent that started the activity
        handleIntent(getIntent());
    }

    /**
     * Request POST_NOTIFICATIONS permission on Android 13+ (API 33+)
     * This is REQUIRED for any notifications to appear!
     */
    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ requires explicit notification permission
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) 
                    == PackageManager.PERMISSION_GRANTED) {
                Log.d(TAG, "✅ POST_NOTIFICATIONS permission already granted");
            } else {
                Log.d(TAG, "📢 Requesting POST_NOTIFICATIONS permission...");
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS);
            }
        } else {
            Log.d(TAG, "✅ Android < 13, no notification permission needed");
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Log.d(TAG, "📱 MainActivity onNewIntent");
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null) {
            Log.d(TAG, "No intent to handle");
            return;
        }

        String action = intent.getAction();
        Log.d(TAG, "Handling intent with action: " + action);

        // Handle incoming call notification tap
        if ("INCOMING_CALL".equals(action) || "ANSWER_CALL".equals(action) || "DECLINE_CALL".equals(action)) {
            handleCallIntent(intent);
        }
        // Handle message notification tap
        else if ("OPEN_CONVERSATION".equals(action)) {
            handleMessageIntent(intent);
        }
        // Handle callback from missed call
        else if ("CALLBACK".equals(action)) {
            handleCallbackIntent(intent);
        }
        // Check for call extras even without specific action
        else if (intent.hasExtra("callId") && intent.hasExtra("fromNotification")) {
            handleCallIntent(intent);
        }
        // Check for conversation extras
        else if (intent.hasExtra("conversationId") && intent.hasExtra("fromNotification")) {
            handleMessageIntent(intent);
        }
    }

    private void handleCallIntent(Intent intent) {
        String callId = intent.getStringExtra("callId");
        String callerId = intent.getStringExtra("callerId");
        String callerName = intent.getStringExtra("caller");
        String callType = intent.getStringExtra("callType");
        String callAction = intent.getStringExtra("action"); // "answer" or "decline"
        String offer = intent.getStringExtra("offer");

        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "📞 CALL INTENT RECEIVED");
        Log.d(TAG, "  Call ID: " + callId);
        Log.d(TAG, "  Caller: " + callerName);
        Log.d(TAG, "  Type: " + callType);
        Log.d(TAG, "  Action: " + callAction);
        Log.d(TAG, "═══════════════════════════════════════");

        JSObject callData = new JSObject();
        callData.put("type", "incoming_call");
        callData.put("callId", callId != null ? callId : "");
        callData.put("callerId", callerId != null ? callerId : "");
        callData.put("callerName", callerName != null ? callerName : "Unknown");
        callData.put("callType", callType != null ? callType : "audio");
        callData.put("action", callAction); // null, "answer", or "decline"
        callData.put("fromNotification", true);
        if (offer != null) {
            callData.put("offer", offer);
        }

        // Store for when JavaScript is ready
        pendingCallData = callData;

        // Try to send to JavaScript immediately if bridge is ready
        sendToJavaScript("incomingCallFromNotification", callData);
    }

    private void handleMessageIntent(Intent intent) {
        String conversationId = intent.getStringExtra("conversationId");

        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "💬 MESSAGE INTENT RECEIVED");
        Log.d(TAG, "  Conversation: " + conversationId);
        Log.d(TAG, "═══════════════════════════════════════");

        JSObject messageData = new JSObject();
        messageData.put("type", "open_conversation");
        messageData.put("conversationId", conversationId != null ? conversationId : "");
        messageData.put("fromNotification", true);

        // Store for when JavaScript is ready
        pendingMessageData = messageData;

        // Try to send to JavaScript immediately if bridge is ready
        sendToJavaScript("openConversationFromNotification", messageData);
    }

    private void handleCallbackIntent(Intent intent) {
        String callerId = intent.getStringExtra("callerId");
        String callType = intent.getStringExtra("callType");

        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "📞 CALLBACK INTENT RECEIVED");
        Log.d(TAG, "  Caller ID: " + callerId);
        Log.d(TAG, "  Call Type: " + callType);
        Log.d(TAG, "═══════════════════════════════════════");

        JSObject callbackData = new JSObject();
        callbackData.put("type", "callback");
        callbackData.put("callerId", callerId != null ? callerId : "");
        callbackData.put("callType", callType != null ? callType : "audio");
        callbackData.put("fromNotification", true);

        sendToJavaScript("callbackFromNotification", callbackData);
    }

    private void sendToJavaScript(String eventName, JSObject data) {
        try {
            if (bridge != null && bridge.getWebView() != null) {
                String js = String.format(
                    "window.dispatchEvent(new CustomEvent('%s', { detail: %s }));",
                    eventName,
                    data.toString()
                );
                
                runOnUiThread(() -> {
                    bridge.getWebView().evaluateJavascript(js, null);
                    Log.d(TAG, "✅ Sent event to JavaScript: " + eventName);
                });
            } else {
                Log.d(TAG, "⏳ Bridge not ready, data stored for later");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error sending to JavaScript", e);
        }
    }

    /**
     * Check if there is pending call data from a notification
     * Used by IncomingCallPlugin
     */
    public static boolean hasPendingCall() {
        return pendingCallData != null;
    }

    /**
     * Get pending call data - returns JSObject for Capacitor plugin compatibility
     * Used by IncomingCallPlugin
     */
    public static JSObject getPendingCallData() {
        return pendingCallData;
    }

    /**
     * Clear pending call data after it has been processed
     * Used by IncomingCallPlugin
     */
    public static void clearPendingCall() {
        pendingCallData = null;
        Log.d(TAG, "✅ Cleared pending call data");
    }

    /**
     * Get pending message data
     */
    public static JSObject getPendingMessageData() {
        return pendingMessageData;
    }

    /**
     * Clear pending message data
     */
    public static void clearPendingMessage() {
        pendingMessageData = null;
    }

    @Override
    public void onResume() {
        super.onResume();
        Log.d(TAG, "📱 MainActivity onResume");

        // Re-send pending data when app comes to foreground
        if (pendingCallData != null) {
            sendToJavaScript("incomingCallFromNotification", pendingCallData);
        }
        if (pendingMessageData != null) {
            sendToJavaScript("openConversationFromNotification", pendingMessageData);
        }
    }
}
