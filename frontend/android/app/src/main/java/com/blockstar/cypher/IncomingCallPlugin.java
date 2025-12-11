// android/app/src/main/java/com/blockstar/cypher/IncomingCallPlugin.java
package world.blockstar.cypher;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor plugin to handle incoming call data from notifications
 * 
 * When the app is opened from an incoming call notification,
 * the call data is stored in MainActivity. This plugin allows
 * the JavaScript layer to retrieve that data and show the call UI.
 */
@CapacitorPlugin(name = "IncomingCall")
public class IncomingCallPlugin extends Plugin {

    private static final String TAG = "IncomingCallPlugin";

    /**
     * Check if there's a pending incoming call
     * Call this on app start to check if opened from notification
     */
    @PluginMethod
    public void hasPendingCall(PluginCall call) {
        boolean hasPending = MainActivity.hasPendingCall();
        Log.d(TAG, "📞 hasPendingCall: " + hasPending);
        
        JSObject result = new JSObject();
        result.put("hasPendingCall", hasPending);
        call.resolve(result);
    }

    /**
     * Get the pending call data
     * Returns null if no pending call
     */
    @PluginMethod
    public void getPendingCall(PluginCall call) {
        JSObject callData = MainActivity.getPendingCallData();
        
        if (callData != null) {
            Log.d(TAG, "📞 Returning pending call: " + callData.toString());
            call.resolve(callData);
        } else {
            Log.d(TAG, "📞 No pending call");
            JSObject result = new JSObject();
            result.put("callId", null);
            call.resolve(result);
        }
    }

    /**
     * Clear the pending call (call when handled)
     */
    @PluginMethod
    public void clearPendingCall(PluginCall call) {
        MainActivity.clearPendingCall();
        Log.d(TAG, "📞 Pending call cleared");
        call.resolve();
    }

    /**
     * Notify that the call was answered
     * Stops the ringing service
     */
    @PluginMethod
    public void notifyCallAnswered(PluginCall call) {
        String callId = call.getString("callId");
        Log.d(TAG, "📞 Call answered: " + callId);
        
        // Clear pending call
        MainActivity.clearPendingCall();
        
        // The service should already be stopped by MainActivity,
        // but we can ensure it here too
        call.resolve();
    }

    /**
     * Notify that the call was declined
     * Stops the ringing service
     */
    @PluginMethod
    public void notifyCallDeclined(PluginCall call) {
        String callId = call.getString("callId");
        Log.d(TAG, "📞 Call declined: " + callId);
        
        // Clear pending call
        MainActivity.clearPendingCall();
        
        call.resolve();
    }

    /**
     * Set the API URL for debug logging
     * This allows native Android logs to be sent to the backend
     * 
     * Call this after getting your API_URL, e.g.:
     * IncomingCall.setDebugUrl({ url: 'https://your-backend.com' });
     */
    @PluginMethod
    public void setDebugUrl(PluginCall call) {
        String url = call.getString("url");
        
        if (url != null && !url.isEmpty()) {
            DebugLogger.setApiUrl(url);
            Log.d(TAG, "✅ Debug URL set: " + url);
            DebugLogger.log("✅ Debug logging initialized from JavaScript");
            
            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);
        } else {
            call.reject("URL is required");
        }
    }

    /**
     * Send a debug message to the backend
     * Useful for logging JavaScript events to the same log stream
     */
    @PluginMethod
    public void debugLog(PluginCall call) {
        String message = call.getString("message");
        String extra = call.getString("extra");
        
        if (message != null) {
            DebugLogger.log("[JS] " + message, extra);
        }
        
        call.resolve();
    }
}
