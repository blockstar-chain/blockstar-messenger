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
}
