package world.blockstar.cypher;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Debug logger that sends logs to the backend server.
 * Logs appear in the backend console for easy debugging without ADB.
 */
public class DebugLogger {
    private static final String TAG = "DebugLogger";
    private static final String PREFS_NAME = "BlockStarPrefs";
    private static final String KEY_API_URL = "api_url";
    
    // Default API URL - will be overridden by stored preference
    private static String apiUrl = null;
    private static Context appContext = null;
    
    private static final ExecutorService executor = Executors.newSingleThreadExecutor();
    
    /**
     * Initialize with application context to read stored API URL
     * Call this from MainActivity.onCreate() or Application.onCreate()
     */
    public static void init(Context context) {
        appContext = context.getApplicationContext();
        SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        apiUrl = prefs.getString(KEY_API_URL, null);
        
        // If no URL stored, try to get from BuildConfig or use default
        if (apiUrl == null || apiUrl.isEmpty()) {
            // Try common storage locations
            String storedSocketUrl = prefs.getString("socket_url", null);
            if (storedSocketUrl != null && !storedSocketUrl.isEmpty()) {
                apiUrl = storedSocketUrl;
                Log.d(TAG, "Using socket_url from prefs: " + apiUrl);
            }
        }
        
        Log.d(TAG, "DebugLogger initialized. API URL: " + (apiUrl != null ? apiUrl : "NOT SET - call setApiUrl()"));
    }
    
    /**
     * Set the API URL (call this when you know the backend URL)
     */
    public static void setApiUrl(String url) {
        apiUrl = url;
        if (appContext != null) {
            SharedPreferences prefs = appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit().putString(KEY_API_URL, url).apply();
        }
        Log.d(TAG, "API URL set to: " + url);
    }
    
    /**
     * Send a debug message to the backend
     * @param message The main log message
     */
    public static void log(String message) {
        log(message, null);
    }
    
    /**
     * Send a debug message with extra data to the backend
     * @param message The main log message
     * @param extra Additional data (will be converted to string)
     */
    public static void log(String message, Object extra) {
        // Also log locally for immediate feedback
        Log.d(TAG, message + (extra != null ? " | Extra: " + extra : ""));
        
        // Send to backend asynchronously
        executor.execute(() -> {
            try {
                JSONObject payload = new JSONObject();
                payload.put("message", message);
                payload.put("extra", extra != null ? extra.toString() : null);
                payload.put("timestamp", getISOTimestamp());
                payload.put("platform", "android-native");
                payload.put("source", "DebugLogger");
                
                sendToBackend(payload.toString());
            } catch (Exception e) {
                Log.e(TAG, "Error creating debug payload: " + e.getMessage());
            }
        });
    }
    
    /**
     * Log an error with stack trace
     */
    public static void error(String message, Throwable throwable) {
        String stackTrace = throwable != null ? Log.getStackTraceString(throwable) : null;
        log("❌ ERROR: " + message, stackTrace);
    }
    
    /**
     * Log call-related events with consistent formatting
     */
    public static void logCall(String event, String callId, String callerId, String callerName, String callType) {
        StringBuilder sb = new StringBuilder();
        sb.append("═══════════════════════════════════════\n");
        sb.append("📞 ").append(event).append("\n");
        sb.append("  Call ID: ").append(callId).append("\n");
        sb.append("  Caller ID: ").append(callerId).append("\n");
        sb.append("  Caller Name: ").append(callerName).append("\n");
        sb.append("  Call Type: ").append(callType).append("\n");
        sb.append("═══════════════════════════════════════");
        log(sb.toString());
    }
    
    /**
     * Log notification-related events
     */
    public static void logNotification(String event, boolean success, String details) {
        String icon = success ? "✅" : "❌";
        log(icon + " NOTIFICATION: " + event, details);
    }
    
    private static void sendToBackend(String jsonPayload) {
        if (apiUrl == null || apiUrl.isEmpty()) {
            Log.w(TAG, "API URL not set - debug log not sent to backend");
            return;
        }
        
        HttpURLConnection connection = null;
        try {
            URL url = new URL(apiUrl + "/api/debug-log");
            connection = (HttpURLConnection) url.openConnection();
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/json");
            connection.setDoOutput(true);
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(5000);
            
            try (OutputStream os = connection.getOutputStream()) {
                byte[] input = jsonPayload.getBytes("utf-8");
                os.write(input, 0, input.length);
            }
            
            int responseCode = connection.getResponseCode();
            if (responseCode != 200 && responseCode != 201) {
                Log.w(TAG, "Debug log response code: " + responseCode);
            }
        } catch (Exception e) {
            // Silently fail - don't want debug logging to crash the app
            Log.w(TAG, "Failed to send debug log: " + e.getMessage());
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }
    
    private static String getISOTimestamp() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }
}
