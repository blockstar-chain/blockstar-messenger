package com.blockstar.cypher;

import android.app.*;
import android.content.*;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;

public class IncomingCallService extends Service {

    private static final String TAG = "IncomingCallService";
    private static final int NOTIFICATION_ID = 101;
    
    private Ringtone ringtone;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "Service created");
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "📞 INCOMING CALL SERVICE STARTED");
        
        if (intent == null) {
            Log.e(TAG, "Intent is null, stopping service");
            stopSelf();
            return START_NOT_STICKY;
        }

        // Handle decline action
        if ("DECLINE_CALL".equals(intent.getAction())) {
            Log.d(TAG, "📞 Call declined via notification");
            stopRingtoneAndVibration();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        // Handle stop action (called when call is answered or ended)
        if ("STOP_SERVICE".equals(intent.getAction())) {
            Log.d(TAG, "📞 Stopping service");
            stopRingtoneAndVibration();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        String caller = intent.getStringExtra("caller");
        String callId = intent.getStringExtra("callId");
        String callerId = intent.getStringExtra("callerId");
        String callType = intent.getStringExtra("callType");
        
        Log.d(TAG, "Caller: " + caller);
        Log.d(TAG, "Call ID: " + callId);
        Log.d(TAG, "Caller ID: " + callerId);
        Log.d(TAG, "Call Type: " + callType);

        // Acquire wake lock to wake up the device
        acquireWakeLock();

        // Create the full screen intent
        Intent fullScreenIntent = new Intent(this, MainActivity.class);
        fullScreenIntent.putExtra("callId", callId);
        fullScreenIntent.putExtra("caller", caller);
        fullScreenIntent.putExtra("callerId", callerId);
        fullScreenIntent.putExtra("callType", callType != null ? callType : "audio");
        fullScreenIntent.putExtra("incomingCall", true);
        fullScreenIntent.setAction("INCOMING_CALL");
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | 
                                  Intent.FLAG_ACTIVITY_CLEAR_TOP |
                                  Intent.FLAG_ACTIVITY_SINGLE_TOP);

        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
            this, 
            0, 
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Create answer action
        Intent answerIntent = new Intent(this, MainActivity.class);
        answerIntent.setAction("ANSWER_CALL");
        answerIntent.putExtra("callId", callId);
        answerIntent.putExtra("callerId", callerId);
        answerIntent.putExtra("caller", caller);
        answerIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        
        PendingIntent answerPendingIntent = PendingIntent.getActivity(
            this, 1, answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Create decline action
        Intent declineIntent = new Intent(this, IncomingCallService.class);
        declineIntent.setAction("DECLINE_CALL");
        declineIntent.putExtra("callId", callId);
        
        PendingIntent declinePendingIntent = PendingIntent.getService(
            this, 2, declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Build notification with actions
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, "calls")
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle("Incoming Call")
            .setContentText((caller != null ? caller : "Unknown") + " is calling...")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setContentIntent(fullScreenPendingIntent)
            .setOngoing(true)
            .setAutoCancel(false)
            .addAction(android.R.drawable.sym_call_incoming, "Answer", answerPendingIntent)
            .addAction(android.R.drawable.sym_call_missed, "Decline", declinePendingIntent);

        // Set vibration pattern
        builder.setVibrate(new long[]{0, 1000, 500, 1000, 500, 1000});

        Notification notification = builder.build();
        notification.flags |= Notification.FLAG_INSISTENT; // Keep ringing

        // Start as foreground service
        startForeground(NOTIFICATION_ID, notification);
        Log.d(TAG, "✅ Foreground notification shown");

        // Start ringtone
        playRingtone();
        
        // Start vibration
        startVibration();

        Log.d(TAG, "═══════════════════════════════════════");

        return START_NOT_STICKY;
    }

    private void acquireWakeLock() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager != null) {
                wakeLock = powerManager.newWakeLock(
                    PowerManager.FULL_WAKE_LOCK |
                    PowerManager.ACQUIRE_CAUSES_WAKEUP |
                    PowerManager.ON_AFTER_RELEASE,
                    "BlockStarCypher:IncomingCallWakeLock"
                );
                wakeLock.acquire(60000); // 60 seconds max
                Log.d(TAG, "✅ Wake lock acquired");
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to acquire wake lock: " + e.getMessage());
        }
    }

    private void playRingtone() {
        try {
            Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (ringtoneUri == null) {
                ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }
            
            ringtone = RingtoneManager.getRingtone(this, ringtoneUri);
            
            if (ringtone != null) {
                // Set audio attributes for ringtone
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    ringtone.setLooping(true);
                }
                
                AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                if (audioManager != null) {
                    // Ensure volume is up
                    int currentVolume = audioManager.getStreamVolume(AudioManager.STREAM_RING);
                    int maxVolume = audioManager.getStreamMaxVolume(AudioManager.STREAM_RING);
                    Log.d(TAG, "Ring volume: " + currentVolume + "/" + maxVolume);
                    
                    if (currentVolume == 0) {
                        Log.w(TAG, "⚠️ Ring volume is 0!");
                    }
                }
                
                ringtone.play();
                Log.d(TAG, "🔔 Ringtone started");
            } else {
                Log.e(TAG, "Failed to get ringtone");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error playing ringtone: " + e.getMessage());
        }
    }

    private void startVibration() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vibratorManager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                if (vibratorManager != null) {
                    vibrator = vibratorManager.getDefaultVibrator();
                }
            } else {
                vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }

            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = {0, 1000, 500, 1000, 500, 1000};
                
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0)); // 0 = repeat from start
                } else {
                    vibrator.vibrate(pattern, 0);
                }
                Log.d(TAG, "📳 Vibration started");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error starting vibration: " + e.getMessage());
        }
    }

    private void stopRingtoneAndVibration() {
        Log.d(TAG, "Stopping ringtone and vibration");
        
        if (ringtone != null) {
            try {
                ringtone.stop();
                Log.d(TAG, "🔇 Ringtone stopped");
            } catch (Exception e) {
                Log.e(TAG, "Error stopping ringtone: " + e.getMessage());
            }
            ringtone = null;
        }

        if (vibrator != null) {
            try {
                vibrator.cancel();
                Log.d(TAG, "📴 Vibration stopped");
            } catch (Exception e) {
                Log.e(TAG, "Error stopping vibration: " + e.getMessage());
            }
            vibrator = null;
        }

        if (wakeLock != null && wakeLock.isHeld()) {
            try {
                wakeLock.release();
                Log.d(TAG, "🔓 Wake lock released");
            } catch (Exception e) {
                Log.e(TAG, "Error releasing wake lock: " + e.getMessage());
            }
            wakeLock = null;
        }
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "Service destroyed");
        stopRingtoneAndVibration();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { 
        return null; 
    }
}
