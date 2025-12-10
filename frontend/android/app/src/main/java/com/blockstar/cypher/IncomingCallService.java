package world.blockstar.cypher;

import android.app.Notification;
import android.app.NotificationChannel;
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
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

public class IncomingCallService extends Service {
    private static final String TAG = "IncomingCallService";
    private static final String CHANNEL_ID = "calls";
    private static final String CHANNEL_NAME = "Incoming Calls";
    private static final int NOTIFICATION_ID = 101;

    private Ringtone ringtone;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;

    // Store call data for actions
    private String currentCallId;
    private String currentCallerId;
    private String currentCallerName;
    private String currentCallType;

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "📞 IncomingCallService CREATED");
        Log.d(TAG, "═══════════════════════════════════════");
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            Log.w(TAG, "Null intent received");
            stopSelf();
            return START_NOT_STICKY;
        }

        String action = intent.getAction();
        Log.d(TAG, "📞 onStartCommand - Action: " + action);

        // Handle Answer action
        if ("ANSWER_CALL".equals(action)) {
            Log.d(TAG, "✅ ANSWER action received");
            handleAnswerCall();
            return START_NOT_STICKY;
        }

        // Handle Decline action
        if ("DECLINE_CALL".equals(action)) {
            Log.d(TAG, "❌ DECLINE action received");
            handleDeclineCall();
            return START_NOT_STICKY;
        }

        // Handle Stop service
        if ("STOP_SERVICE".equals(action)) {
            Log.d(TAG, "🛑 STOP_SERVICE action received");
            stopRingtoneAndVibration();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        // Handle incoming call - show notification
        if ("SHOW_INCOMING_CALL".equals(action) || action == null) {
            currentCallId = intent.getStringExtra("callId");
            currentCallerId = intent.getStringExtra("callerId");
            currentCallerName = intent.getStringExtra("caller");
            currentCallType = intent.getStringExtra("callType");

            if (currentCallerName == null || currentCallerName.isEmpty()) {
                currentCallerName = "Unknown Caller";
            }
            if (currentCallType == null) {
                currentCallType = "audio";
            }

            Log.d(TAG, "═══════════════════════════════════════");
            Log.d(TAG, "📞 SHOWING INCOMING CALL NOTIFICATION");
            Log.d(TAG, "  Call ID: " + currentCallId);
            Log.d(TAG, "  Caller ID: " + currentCallerId);
            Log.d(TAG, "  Caller Name: " + currentCallerName);
            Log.d(TAG, "  Call Type: " + currentCallType);
            Log.d(TAG, "═══════════════════════════════════════");

            // Acquire wake lock to turn on screen
            acquireWakeLock();

            // Build and show notification
            Notification notification = buildCallNotification();
            startForeground(NOTIFICATION_ID, notification);

            // Start ringtone and vibration
            playRingtone();
            startVibration();

            Log.d(TAG, "✅ Notification shown, ringtone playing");
        }

        return START_STICKY;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            
            // Delete existing channel to update settings
            manager.deleteNotificationChannel(CHANNEL_ID);

            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );

            channel.setDescription("Incoming call notifications");
            channel.enableLights(true);
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 1000, 500, 1000});
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setBypassDnd(true);
            
            // Set sound to none - we handle it ourselves
            channel.setSound(null, null);

            manager.createNotificationChannel(channel);
            Log.d(TAG, "✅ Notification channel created: " + CHANNEL_ID);
        }
    }

    private Notification buildCallNotification() {
        // Intent to open app when notification is tapped
        Intent fullScreenIntent = new Intent(this, MainActivity.class);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        fullScreenIntent.putExtra("callId", currentCallId);
        fullScreenIntent.putExtra("callerId", currentCallerId);
        fullScreenIntent.putExtra("caller", currentCallerName);
        fullScreenIntent.putExtra("callType", currentCallType);
        fullScreenIntent.putExtra("fromNotification", true);
        fullScreenIntent.setAction("INCOMING_CALL");

        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            0,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Answer action intent
        Intent answerIntent = new Intent(this, IncomingCallService.class);
        answerIntent.setAction("ANSWER_CALL");
        answerIntent.putExtra("callId", currentCallId);
        answerIntent.putExtra("callerId", currentCallerId);
        answerIntent.putExtra("caller", currentCallerName);
        answerIntent.putExtra("callType", currentCallType);

        PendingIntent answerPendingIntent = PendingIntent.getService(
            this,
            1,
            answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Decline action intent
        Intent declineIntent = new Intent(this, IncomingCallService.class);
        declineIntent.setAction("DECLINE_CALL");
        declineIntent.putExtra("callId", currentCallId);
        declineIntent.putExtra("callerId", currentCallerId);

        PendingIntent declinePendingIntent = PendingIntent.getService(
            this,
            2,
            declineIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Build the notification
        String callTypeEmoji = "video".equals(currentCallType) ? "📹" : "📞";
        String title = callTypeEmoji + " Incoming " + currentCallType + " call";
        String text = currentCallerName + " is calling...";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setContentIntent(fullScreenPendingIntent)
            // Answer button (green)
            .addAction(
                android.R.drawable.ic_menu_call,
                "✓ Answer",
                answerPendingIntent
            )
            // Decline button (red)
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "✗ Decline",
                declinePendingIntent
            );

        // Use call style for Android 12+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }

        return builder.build();
    }

    private void handleAnswerCall() {
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "✅ ANSWERING CALL: " + currentCallId);
        Log.d(TAG, "═══════════════════════════════════════");

        // Stop ringtone and vibration
        stopRingtoneAndVibration();

        // Open app with answer action
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        intent.putExtra("callId", currentCallId);
        intent.putExtra("callerId", currentCallerId);
        intent.putExtra("caller", currentCallerName);
        intent.putExtra("callType", currentCallType);
        intent.putExtra("action", "answer");
        intent.setAction("ANSWER_CALL");
        startActivity(intent);

        // Stop the service
        stopForeground(true);
        stopSelf();
    }

    private void handleDeclineCall() {
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "❌ DECLINING CALL: " + currentCallId);
        Log.d(TAG, "═══════════════════════════════════════");

        // Stop ringtone and vibration
        stopRingtoneAndVibration();

        // Send decline to app
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.putExtra("callId", currentCallId);
        intent.putExtra("callerId", currentCallerId);
        intent.putExtra("action", "decline");
        intent.setAction("DECLINE_CALL");
        startActivity(intent);

        // Stop the service
        stopForeground(true);
        stopSelf();
    }

    private void acquireWakeLock() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager != null) {
                // Release any existing wake lock
                if (wakeLock != null && wakeLock.isHeld()) {
                    wakeLock.release();
                }

                wakeLock = powerManager.newWakeLock(
                    PowerManager.FULL_WAKE_LOCK |
                    PowerManager.ACQUIRE_CAUSES_WAKEUP |
                    PowerManager.ON_AFTER_RELEASE,
                    "BlockStarCypher:IncomingCallWakeLock"
                );
                wakeLock.acquire(60000); // 60 seconds max
                Log.d(TAG, "✅ Wake lock acquired - screen should turn on");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to acquire wake lock: " + e.getMessage());
        }
    }

    private void playRingtone() {
        try {
            // Check if phone is not in silent mode
            AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            int ringerMode = audioManager.getRingerMode();
            int volume = audioManager.getStreamVolume(AudioManager.STREAM_RING);

            Log.d(TAG, "📢 Ringer mode: " + ringerMode + ", Volume: " + volume);

            if (ringerMode == AudioManager.RINGER_MODE_SILENT) {
                Log.w(TAG, "⚠️ Phone is in silent mode - no ringtone will play");
                return;
            }

            Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (ringtoneUri == null) {
                ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            }

            ringtone = RingtoneManager.getRingtone(this, ringtoneUri);
            if (ringtone != null) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    ringtone.setLooping(true);
                }
                
                AudioAttributes audioAttributes = new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build();
                ringtone.setAudioAttributes(audioAttributes);
                
                ringtone.play();
                Log.d(TAG, "🔔 Ringtone playing");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error playing ringtone: " + e.getMessage());
        }
    }

    private void startVibration() {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                VibratorManager vibratorManager = (VibratorManager) getSystemService(Context.VIBRATOR_MANAGER_SERVICE);
                vibrator = vibratorManager.getDefaultVibrator();
            } else {
                vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            }

            if (vibrator != null && vibrator.hasVibrator()) {
                // Vibration pattern: wait 0ms, vibrate 1000ms, wait 500ms, vibrate 1000ms, etc.
                long[] pattern = {0, 1000, 500, 1000, 500, 1000, 500};
                
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0)); // 0 = repeat from index 0
                } else {
                    vibrator.vibrate(pattern, 0);
                }
                Log.d(TAG, "📳 Vibration started");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error starting vibration: " + e.getMessage());
        }
    }

    private void stopRingtoneAndVibration() {
        Log.d(TAG, "🔇 Stopping ringtone and vibration");
        
        try {
            if (ringtone != null) {
                ringtone.stop();
                ringtone = null;
                Log.d(TAG, "  ✓ Ringtone stopped");
            }
        } catch (Exception e) {
            Log.e(TAG, "  ✗ Error stopping ringtone: " + e.getMessage());
        }

        try {
            if (vibrator != null) {
                vibrator.cancel();
                vibrator = null;
                Log.d(TAG, "  ✓ Vibration stopped");
            }
        } catch (Exception e) {
            Log.e(TAG, "  ✗ Error stopping vibration: " + e.getMessage());
        }

        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                wakeLock = null;
                Log.d(TAG, "  ✓ Wake lock released");
            }
        } catch (Exception e) {
            Log.e(TAG, "  ✗ Error releasing wake lock: " + e.getMessage());
        }
    }

    @Override
    public void onDestroy() {
        Log.d(TAG, "📞 IncomingCallService DESTROYED");
        stopRingtoneAndVibration();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
