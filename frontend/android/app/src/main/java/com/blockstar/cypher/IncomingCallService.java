package world.blockstar.cypher;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.graphics.Color;
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
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.Person;

public class IncomingCallService extends Service {
    private static final String TAG = "IncomingCallService";
    private static final String CHANNEL_ID = "calls";
    private static final String CHANNEL_NAME = "Incoming Calls";
    private static final int NOTIFICATION_ID = 101;
    private static final String PREFS_NAME = "BlockStarPrefs";

    private Ringtone ringtone;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private PowerManager.WakeLock screenWakeLock;

    // Store call data for actions
    private String currentCallId;
    private String currentCallerId;
    private String currentCallerName;
    private String currentCallType;
    private String currentAuthToken;  // Auth token for deep link
    private String currentCallUrl;    // Deep link URL

    @Override
    public void onCreate() {
        super.onCreate();
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "📞 IncomingCallService CREATED");
        Log.d(TAG, "═══════════════════════════════════════");
        
        DebugLogger.log("📞 IncomingCallService CREATED");
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

        if ("ANSWER_CALL".equals(action)) {
            Log.d(TAG, "✅ ANSWER action received");
            handleAnswerCall();
            return START_NOT_STICKY;
        }

        if ("DECLINE_CALL".equals(action)) {
            Log.d(TAG, "❌ DECLINE action received");
            handleDeclineCall();
            return START_NOT_STICKY;
        }

        if ("STOP_SERVICE".equals(action)) {
            Log.d(TAG, "🛑 STOP_SERVICE action received");
            stopRingtoneAndVibration();
            stopForeground(true);
            
            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.cancel(NOTIFICATION_ID);
            }
            
            stopSelf();
            return START_NOT_STICKY;
        }

        if ("SHOW_INCOMING_CALL".equals(action) || action == null) {
            currentCallId = intent.getStringExtra("callId");
            currentCallerId = intent.getStringExtra("callerId");
            currentCallerName = intent.getStringExtra("caller");
            currentCallType = intent.getStringExtra("callType");
            // ════════════════════════════════════════════════════════════════
            // NEW: Get auth token and URL from intent
            // ════════════════════════════════════════════════════════════════
            currentAuthToken = intent.getStringExtra("authToken");
            currentCallUrl = intent.getStringExtra("callUrl");

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
            Log.d(TAG, "  Has Auth Token: " + (currentAuthToken != null));
            Log.d(TAG, "  Has Call URL: " + (currentCallUrl != null));
            Log.d(TAG, "  Android Version: " + Build.VERSION.SDK_INT);
            Log.d(TAG, "═══════════════════════════════════════");

            DebugLogger.logCall("SHOWING INCOMING CALL NOTIFICATION", 
                currentCallId, currentCallerId, currentCallerName, currentCallType);

            // Acquire wake locks to turn on screen
            acquireWakeLocks();

            // Build and show notification
            Notification notification = buildCallNotification();
            
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
                    Log.d(TAG, "✅ Started foreground service (Android 10+)");
                    DebugLogger.log("✅ Started foreground service (Android 10+)");
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                    Log.d(TAG, "✅ Started foreground service (legacy)");
                    DebugLogger.log("✅ Started foreground service (legacy)");
                }
            } catch (Exception e) {
                Log.e(TAG, "❌ Failed to start foreground: " + e.getMessage());
                DebugLogger.error("Failed to start foreground service", e);
                
                try {
                    NotificationManager manager = getSystemService(NotificationManager.class);
                    if (manager != null) {
                        manager.notify(NOTIFICATION_ID, notification);
                        Log.d(TAG, "✅ Fallback: Posted notification directly");
                    }
                } catch (Exception e2) {
                    DebugLogger.error("Fallback notification also failed", e2);
                }
            }

            // Start ringtone and vibration
            playRingtone();
            startVibration();

            Log.d(TAG, "✅ Notification should be shown, ringtone playing");
        }

        return START_STICKY;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) {
                Log.e(TAG, "❌ NotificationManager is null!");
                return;
            }
            
            manager.deleteNotificationChannel(CHANNEL_ID);

            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );

            channel.setDescription("Incoming call notifications");
            channel.enableLights(true);
            channel.setLightColor(Color.BLUE);
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 1000, 500, 1000});
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setBypassDnd(true);
            channel.setSound(null, null);

            manager.createNotificationChannel(channel);
            
            NotificationChannel created = manager.getNotificationChannel(CHANNEL_ID);
            if (created != null) {
                Log.d(TAG, "✅ Notification channel created successfully");
            } else {
                Log.e(TAG, "❌ Failed to create notification channel!");
            }
        }
    }

    private Notification buildCallNotification() {
        Log.d(TAG, "📞 Building call notification...");
        
        // ════════════════════════════════════════════════════════════════
        // Intent when notification is tapped - opens /call URL in app
        // ════════════════════════════════════════════════════════════════
        Intent fullScreenIntent;
        
        if (currentCallUrl != null && !currentCallUrl.isEmpty()) {
            // Open the /call deep link URL
            fullScreenIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(currentCallUrl));
            fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            Log.d(TAG, "📞 Full screen intent will open URL: " + currentCallUrl);
        } else {
            // Fallback: Open MainActivity with call params
            fullScreenIntent = new Intent(this, MainActivity.class);
            fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | 
                                      Intent.FLAG_ACTIVITY_CLEAR_TOP | 
                                      Intent.FLAG_ACTIVITY_SINGLE_TOP);
            fullScreenIntent.putExtra("callId", currentCallId);
            fullScreenIntent.putExtra("callerId", currentCallerId);
            fullScreenIntent.putExtra("caller", currentCallerName);
            fullScreenIntent.putExtra("callType", currentCallType);
            fullScreenIntent.putExtra("fromNotification", true);
            fullScreenIntent.setAction("INCOMING_CALL");
        }

        PendingIntent fullScreenPendingIntent = PendingIntent.getActivity(
            this,
            0,
            fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // ════════════════════════════════════════════════════════════════
        // Answer action - opens /call URL directly
        // ════════════════════════════════════════════════════════════════
        Intent answerIntent = new Intent(this, IncomingCallService.class);
        answerIntent.setAction("ANSWER_CALL");
        answerIntent.putExtra("callId", currentCallId);
        answerIntent.putExtra("callerId", currentCallerId);
        answerIntent.putExtra("caller", currentCallerName);
        answerIntent.putExtra("callType", currentCallType);
        answerIntent.putExtra("authToken", currentAuthToken);
        answerIntent.putExtra("callUrl", currentCallUrl);

        PendingIntent answerPendingIntent = PendingIntent.getService(
            this,
            1,
            answerIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Decline action
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
            .setTicker(text)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setContentIntent(fullScreenPendingIntent)
            .setColor(0xFF3B82F6)
            .addAction(
                android.R.drawable.ic_menu_call,
                "✓ Answer",
                answerPendingIntent
            )
            .addAction(
                android.R.drawable.ic_menu_close_clear_cancel,
                "✗ Decline",
                declinePendingIntent
            );

        // Android 12+ specific settings
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
            
            Person caller = new Person.Builder()
                .setName(currentCallerName)
                .setImportant(true)
                .build();
            
            builder.setStyle(
                NotificationCompat.CallStyle.forIncomingCall(
                    caller,
                    declinePendingIntent,
                    answerPendingIntent
                )
            );
            
            Log.d(TAG, "✅ Using CallStyle for Android 12+");
        }

        Notification notification = builder.build();
        notification.flags |= Notification.FLAG_INSISTENT;
        notification.flags |= Notification.FLAG_NO_CLEAR;
        
        Log.d(TAG, "✅ Notification built successfully");
        return notification;
    }

    private void handleAnswerCall() {
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "✅ ANSWERING CALL: " + currentCallId);
        Log.d(TAG, "═══════════════════════════════════════");

        // Stop ringtone and vibration
        stopRingtoneAndVibration();

        // ════════════════════════════════════════════════════════════════
        // Open the /call URL directly if available
        // ════════════════════════════════════════════════════════════════
        Intent intent;
        
        if (currentCallUrl != null && !currentCallUrl.isEmpty()) {
            // Open /call URL in browser/webview
            Log.d(TAG, "📞 Opening call URL: " + currentCallUrl);
            DebugLogger.log("📞 Opening call URL for answer: " + currentCallUrl);
            
            intent = new Intent(Intent.ACTION_VIEW, Uri.parse(currentCallUrl));
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        } else {
            // Fallback: Open MainActivity with answer action
            Log.d(TAG, "📞 No call URL, using legacy answer flow");
            DebugLogger.log("📞 No call URL, using legacy answer flow");
            
            intent = new Intent(this, MainActivity.class);
            intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | 
                            Intent.FLAG_ACTIVITY_CLEAR_TOP |
                            Intent.FLAG_ACTIVITY_SINGLE_TOP);
            intent.putExtra("callId", currentCallId);
            intent.putExtra("callerId", currentCallerId);
            intent.putExtra("caller", currentCallerName);
            intent.putExtra("callType", currentCallType);
            intent.putExtra("action", "answer");
            intent.putExtra("fromNotification", true);
            intent.setAction("ANSWER_CALL");
        }
        
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

        // Clear pending call from SharedPreferences
        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        prefs.edit()
            .remove("pending_call_id")
            .remove("pending_caller_id")
            .remove("pending_caller_name")
            .remove("pending_call_type")
            .remove("pending_call_timestamp")
            .remove("pending_call_auth_token")
            .remove("pending_call_url")
            .apply();

        // Send decline to app (it will notify the server)
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        intent.putExtra("callId", currentCallId);
        intent.putExtra("callerId", currentCallerId);
        intent.putExtra("caller", currentCallerName);
        intent.putExtra("callType", currentCallType);
        intent.putExtra("action", "decline");
        intent.putExtra("fromNotification", true);
        intent.setAction("DECLINE_CALL");
        startActivity(intent);

        // Stop the service
        stopForeground(true);
        stopSelf();
    }

    private void acquireWakeLocks() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager == null) {
                Log.e(TAG, "❌ PowerManager is null!");
                return;
            }

            releaseWakeLocks();

            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "BlockStarCypher:IncomingCallWakeLock"
            );
            wakeLock.acquire(60000);
            Log.d(TAG, "✅ Partial wake lock acquired");

            @SuppressWarnings("deprecation")
            PowerManager.WakeLock screenLock = powerManager.newWakeLock(
                PowerManager.FULL_WAKE_LOCK |
                PowerManager.ACQUIRE_CAUSES_WAKEUP |
                PowerManager.ON_AFTER_RELEASE,
                "BlockStarCypher:ScreenWakeLock"
            );
            screenWakeLock = screenLock;
            screenWakeLock.acquire(60000);
            Log.d(TAG, "✅ Screen wake lock acquired");

        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to acquire wake locks: " + e.getMessage());
        }
    }

    private void releaseWakeLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                wakeLock = null;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error releasing partial wake lock: " + e.getMessage());
        }

        try {
            if (screenWakeLock != null && screenWakeLock.isHeld()) {
                screenWakeLock.release();
                screenWakeLock = null;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error releasing screen wake lock: " + e.getMessage());
        }
    }

    private void playRingtone() {
        try {
            AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                int ringerMode = audioManager.getRingerMode();
                if (ringerMode == AudioManager.RINGER_MODE_SILENT) {
                    Log.w(TAG, "⚠️ Phone is in silent mode");
                    return;
                }
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
                long[] pattern = {0, 1000, 500, 1000, 500, 1000, 500};
                
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
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
            }
        } catch (Exception e) {
            Log.e(TAG, "Error stopping ringtone: " + e.getMessage());
        }

        try {
            if (vibrator != null) {
                vibrator.cancel();
                vibrator = null;
            }
        } catch (Exception e) {
            Log.e(TAG, "Error stopping vibration: " + e.getMessage());
        }

        releaseWakeLocks();
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
