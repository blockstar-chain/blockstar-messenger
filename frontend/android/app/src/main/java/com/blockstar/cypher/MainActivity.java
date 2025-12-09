package com.blockstar.cypher;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;

import org.json.JSONException;
import org.json.JSONObject;

public class MainActivity extends BridgeActivity {
    private static final String TAG = "MainActivity";
    
    // Store pending call data to pass to JavaScript after bridge is ready
    private static JSONObject pendingCallData = null;
    private static JSONObject pendingMessageData = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "📱 MainActivity onCreate");
        Log.d(TAG, "═══════════════════════════════════════");

        // Handle the intent that started the activity
        handleIntent(getIntent());
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

        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "📞 CALL INTENT RECEIVED");
        Log.d(TAG, "  Call ID: " + callId);
        Log.d(TAG, "  Caller: " + callerName);
        Log.d(TAG, "  Type: " + callType);
        Log.d(TAG, "  Action: " + callAction);
        Log.d(TAG, "═══════════════════════════════════════");

        try {
            JSONObject callData = new JSONObject();
            callData.put("type", "incoming_call");
            callData.put("callId", callId);
            callData.put("callerId", callerId);
            callData.put("callerName", callerName != null ? callerName : "Unknown");
            callData.put("callType", callType != null ? callType : "audio");
            callData.put("action", callAction); // null, "answer", or "decline"
            callData.put("fromNotification", true);

            // Store for when JavaScript is ready
            pendingCallData = callData;

            // Try to send to JavaScript immediately if bridge is ready
            sendToJavaScript("incomingCallFromNotification", callData);

        } catch (JSONException e) {
            Log.e(TAG, "Error creating call data JSON", e);
        }
    }

    private void handleMessageIntent(Intent intent) {
        String conversationId = intent.getStringExtra("conversationId");

        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "💬 MESSAGE INTENT RECEIVED");
        Log.d(TAG, "  Conversation: " + conversationId);
        Log.d(TAG, "═══════════════════════════════════════");

        try {
            JSONObject messageData = new JSONObject();
            messageData.put("type", "open_conversation");
            messageData.put("conversationId", conversationId);
            messageData.put("fromNotification", true);

            // Store for when JavaScript is ready
            pendingMessageData = messageData;

            // Try to send to JavaScript immediately if bridge is ready
            sendToJavaScript("openConversationFromNotification", messageData);

        } catch (JSONException e) {
            Log.e(TAG, "Error creating message data JSON", e);
        }
    }

    private void sendToJavaScript(String eventName, JSONObject data) {
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
     * Called from JavaScript to check for pending notification data
     * This should be called when the app starts up
     */
    public static JSONObject getPendingCallData() {
        JSONObject data = pendingCallData;
        pendingCallData = null; // Clear after reading
        return data;
    }

    public static JSONObject getPendingMessageData() {
        JSONObject data = pendingMessageData;
        pendingMessageData = null; // Clear after reading
        return data;
    }

    @Override
    protected void onResume() {
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
