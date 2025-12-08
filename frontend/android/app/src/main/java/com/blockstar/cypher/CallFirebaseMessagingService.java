// android/app/src/main/java/com/blockstar/cypher/CallFirebaseMessagingService.java
package com.blockstar.cypher;

import android.content.Intent;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

import java.util.Map;

/**
 * Firebase Cloud Messaging Service for BlockStar Cypher
 * 
 * Handles incoming push notifications for:
 * - Incoming calls (starts foreground service with full-screen intent)
 * - Messages (handled by Capacitor push plugin)
 * - Call cancellations
 */
public class CallFirebaseMessagingService extends FirebaseMessagingService {

    private static final String TAG = "BlockStarFCM";

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        super.onMessageReceived(message);

        Map<String, String> data = message.getData();
        String type = data.get("type");

        Log.d(TAG, "════════════════════════════════════════════════════════════");
        Log.d(TAG, "📱 FCM MESSAGE RECEIVED");
        Log.d(TAG, "   Type: " + type);
        Log.d(TAG, "   Data: " + data.toString());
        Log.d(TAG, "════════════════════════════════════════════════════════════");

        if (type == null) {
            Log.w(TAG, "⚠️ No type in FCM data, ignoring");
            return;
        }

        switch (type) {
            case "incoming_call":
                handleIncomingCall(data);
                break;

            case "call_cancelled":
                handleCallCancelled(data);
                break;

            case "message":
                // Messages are handled by Capacitor Push Notifications plugin
                Log.d(TAG, "📬 Message notification - handled by Capacitor");
                break;

            default:
                Log.d(TAG, "📱 Unknown notification type: " + type);
                break;
        }
    }

    /**
     * Handle incoming call - start foreground service with full-screen intent
     */
    private void handleIncomingCall(Map<String, String> data) {
        Log.d(TAG, "📞 ════════════════════════════════════════════════════════════");
        Log.d(TAG, "📞 INCOMING CALL DETECTED");
        Log.d(TAG, "📞 ════════════════════════════════════════════════════════════");

        // Extract call data - support both field names for compatibility
        String callId = data.get("callId");
        String callerId = data.get("callerId");
        String callerName = data.get("callerName");
        String caller = data.get("caller"); // Backward compatibility
        String callType = data.get("callType");

        // Use callerName if available, otherwise fall back to caller
        String displayName = callerName != null && !callerName.isEmpty() ? callerName : caller;
        if (displayName == null || displayName.isEmpty()) {
            displayName = callerId != null ? callerId.substring(0, Math.min(10, callerId.length())) + "..." : "Unknown";
        }

        Log.d(TAG, "📞 Call ID: " + callId);
        Log.d(TAG, "📞 Caller ID: " + callerId);
        Log.d(TAG, "📞 Caller Name: " + displayName);
        Log.d(TAG, "📞 Call Type: " + callType);

        // Start the IncomingCallService
        Intent serviceIntent = new Intent(this, IncomingCallService.class);
        serviceIntent.putExtra("callId", callId);
        serviceIntent.putExtra("callerId", callerId);
        serviceIntent.putExtra("caller", displayName);
        serviceIntent.putExtra("callerName", displayName);
        serviceIntent.putExtra("callType", callType != null ? callType : "audio");
        serviceIntent.setAction("INCOMING_CALL");

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                Log.d(TAG, "📞 Starting foreground service (Android O+)");
                startForegroundService(serviceIntent);
            } else {
                Log.d(TAG, "📞 Starting service (pre-Android O)");
                startService(serviceIntent);
            }
            Log.d(TAG, "📞 ✅ IncomingCallService started successfully");
        } catch (Exception e) {
            Log.e(TAG, "📞 ❌ Failed to start IncomingCallService: " + e.getMessage());
            e.printStackTrace();
        }
    }

    /**
     * Handle call cancelled - stop the ringing
     */
    private void handleCallCancelled(Map<String, String> data) {
        String callId = data.get("callId");
        Log.d(TAG, "📵 Call cancelled: " + callId);

        // Stop the IncomingCallService
        Intent serviceIntent = new Intent(this, IncomingCallService.class);
        serviceIntent.setAction("CALL_CANCELLED");
        serviceIntent.putExtra("callId", callId);
        
        try {
            stopService(serviceIntent);
            Log.d(TAG, "📵 ✅ IncomingCallService stopped");
        } catch (Exception e) {
            Log.e(TAG, "📵 ❌ Failed to stop IncomingCallService: " + e.getMessage());
        }
    }

    /**
     * Called when a new FCM token is generated
     */
    @Override
    public void onNewToken(@NonNull String token) {
        super.onNewToken(token);
        Log.d(TAG, "🔑 New FCM token generated: " + token.substring(0, 40) + "...");
        // Token will be sent to server by Capacitor Push Notifications plugin
    }
}
