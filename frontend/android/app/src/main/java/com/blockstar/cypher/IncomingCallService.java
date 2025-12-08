// android/app/src/main/java/com/blockstar/cypher/IncomingCallService.java
package com.blockstar.cypher;

import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

/**
 * Foreground service for incoming calls
 * 
 * Shows a full-screen notification that wakes the device,
 * plays the ringtone, and vibrates.
 */
public class IncomingCallService extends Service {

    private static final String TAG = "IncomingCallService";
    private static final int NOTIFICATION_ID = 101;
    
    // IMPORTANT: This must match the channel created in MainActivity
    private static final String CHANNEL_ID = "incoming_calls";

    private Ringtone ringtone;
    private Vibrator vibrator;
    private String currentCallId;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "📞 IncomingCallService created");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "📞 ════════════════════════════════════════════════════════════");
        Log.d(TAG, "📞 IncomingCallService onStartCommand");
        Log.d(TAG, "📞 ════════════════════════════════════════════════════════════");

        if (intent == null) {
            Log.w(TAG, "📞 Intent is null, stopping service");
            stopSelf();
            return START_NOT_STICKY;
        }

        String action = intent.getAction();
        Log.d(TAG, "📞 Action: " + action);

        if ("CALL_CANCELLED".equals(action) || "CALL_ANSWERED".equals(action) || "CALL_DECLINED".equals(action)) {
            Log.d(TAG, "📞 Stopping service due to: " + action);
            stopRinging();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        // Extract call data
        String callId = intent.getStringExtra("callId");
        String callerId = intent.getStringExtra("callerId");
        String caller = intent.getStringExtra("caller");
        String callerName = intent.getStringExtra("callerName");
        String callType = intent.getStringExtra("callType");

        // Use callerName if available
        String displayName = callerName != null && !callerName.isEmpty() ? callerName : caller;
        if (displayName == null || displayName.isEmpty()) {
            displayName = "Unknown Caller";
        }

        currentCallId = callId;

        Log.d(TAG, "📞 Call ID: " + callId);
        Log.d(TAG, "📞 Caller: " + displayName);
        Log.d(TAG, "📞 Type: " + callType);

        // Create and show notification
        Notification notification = createCallNotification(callId, displayName, callType);
        
        try {
            startForeground(NOTIFICATION_ID, notification);
            Log.d(TAG, "📞 ✅ Foreground notification started");
        } catch (Exception e) {
            Log.e(TAG, "📞 ❌ Failed to start foreground: " + e.getMessage());
            e.printStackTrace();
        }

        // Start ringing and vibrating
        startRinging();
        startVibrating();

        return START_NOT_STICKY;
    }

    /**
     * Create the incoming call notification with full-screen intent
     */
    private Notification createCallNotification(String callId, String callerName, String callType) {
        // Intent to open the app when notification is tapped
        Intent fullScreenIntent = new Intent(this, MainActivity.class);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra("callId", callId);
        fullScreenIntent.putExtra("caller", callerName);
        fullScreenIntent.putExtra("callType", callType);
        fullScreenIntent.putExtra("fromNotification", true);

        int pendingIntentFlags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            pendingIntentFlags |= PendingIntent.FLAG_IMMUTABLE;
        }

        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
                this,
                0,
                fullScreenIntent,
                pendingIntentFlags
        );

        // Build the notification
        String callTypeDisplay = "video".equals(callType) ? "video" : "voice";
        
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.sym_call_incoming)
                .setContentTitle("Incoming " + callTypeDisplay + " call")
                .setContentText(callerName + " is calling...")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setFullScreenIntent(fullScreenPendingIntent, true) // This wakes the device!
                .setContentIntent(fullScreenPendingIntent);

        // Add action buttons
        // Answer button
        Intent answerIntent = new Intent(this, IncomingCallService.class);
        answerIntent.setAction("CALL_ANSWERED");
        answerIntent.putExtra("callId", callId);
        PendingIntent answerPendingIntent = PendingIntent.getService(
                this, 1, answerIntent, pendingIntentFlags
        );
        builder.addAction(android.R.drawable.sym_call_incoming, "Answer", answerPendingIntent);

        // Decline button
        Intent declineIntent = new Intent(this, IncomingCallService.class);
        declineIntent.setAction("CALL_DECLINED");
        declineIntent.putExtra("callId", callId);
        PendingIntent declinePendingIntent = PendingIntent.getService(
                this, 2, declineIntent, pendingIntentFlags
        );
        builder.addAction(android.R.drawable.sym_call_missed, "Decline", declinePendingIntent);

        return builder.build();
    }

    /**
     * Start playing the ringtone
     */
    private void startRinging() {
        try {
            // Set audio mode to ringtone
            AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                audioManager.setMode(AudioManager.MODE_RINGTONE);
            }

            // Get and play ringtone
            Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            ringtone = RingtoneManager.getRingtone(this, ringtoneUri);
            
            if (ringtone != null) {
                // Set audio attributes for ringtone
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    ringtone.setAudioAttributes(
                            new AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                    .build()
                    );
                    ringtone.setLooping(true);
                }
                
                ringtone.play();
                Log.d(TAG, "🔔 Ringtone started");
            } else {
                Log.w(TAG, "⚠️ Ringtone is null");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error starting ringtone: " + e.getMessage());
            e.printStackTrace();
        }
    }

    /**
     * Start vibrating
     */
    private void startVibrating() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vibratorManager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = vibratorManager.getDefaultVibrator();
            } else {
                vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }

            if (vibrator != null && vibrator.hasVibrator()) {
                // Pattern: wait 0ms, vibrate 500ms, wait 200ms, vibrate 500ms, repeat
                long[] pattern = {0, 500, 200, 500, 200, 500, 200, 500};
                
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0)); // 0 = repeat from start
                } else {
                    vibrator.vibrate(pattern, 0);
                }
                Log.d(TAG, "📳 Vibration started");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error starting vibration: " + e.getMessage());
        }
    }

    /**
     * Stop ringing and vibrating
     */
    private void stopRinging() {
        Log.d(TAG, "🔕 Stopping ringtone and vibration");
        
        try {
            if (ringtone != null && ringtone.isPlaying()) {
                ringtone.stop();
                Log.d(TAG, "🔔 Ringtone stopped");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error stopping ringtone: " + e.getMessage());
        }

        try {
            if (vibrator != null) {
                vibrator.cancel();
                Log.d(TAG, "📳 Vibration stopped");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error stopping vibration: " + e.getMessage());
        }

        // Reset audio mode
        try {
            AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                audioManager.setMode(AudioManager.MODE_NORMAL);
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error resetting audio mode: " + e.getMessage());
        }

        // Cancel the notification
        NotificationManager notificationManager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (notificationManager != null) {
            notificationManager.cancel(NOTIFICATION_ID);
        }
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "📞 IncomingCallService destroyed");
        stopRinging();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
