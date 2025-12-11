package world.blockstar.cypher;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
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

    private Ringtone ringtone;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private PowerManager.WakeLock screenWakeLock;

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
        
        // Send to backend for remote debugging
        DebugLogger.log("📞 IncomingCallService CREATED");
        
        // Create notification channel immediately
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
            
            // Also cancel any notification
            NotificationManager notificationManager = getSystemService(NotificationManager.class);
            if (notificationManager != null) {
                notificationManager.cancel(NOTIFICATION_ID);
            }
            
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
            Log.d(TAG, "  Android Version: " + Build.VERSION.SDK_INT);
            Log.d(TAG, "═══════════════════════════════════════");

            // Send to backend for remote debugging
            DebugLogger.logCall("SHOWING INCOMING CALL NOTIFICATION", 
                currentCallId, currentCallerId, currentCallerName, currentCallType);
            DebugLogger.log("Android Version: " + Build.VERSION.SDK_INT);

            // CRITICAL: Acquire wake locks FIRST to turn on screen
            acquireWakeLocks();

            // Build and show notification
            Notification notification = buildCallNotification();
            
            // Start foreground IMMEDIATELY with correct service type for Android 12+
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    // Android 10+ requires specifying foreground service type
                    startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL);
                    Log.d(TAG, "✅ Started foreground service (Android 10+) with PHONE_CALL type");
                    DebugLogger.log("✅ Started foreground service (Android 10+) with PHONE_CALL type");
                } else {
                    startForeground(NOTIFICATION_ID, notification);
                    Log.d(TAG, "✅ Started foreground service (legacy)");
                    DebugLogger.log("✅ Started foreground service (legacy)");
                }
            } catch (Exception e) {
                Log.e(TAG, "❌ Failed to start foreground: " + e.getMessage());
                e.printStackTrace();
                DebugLogger.error("Failed to start foreground service", e);
                
                // Fallback: Try to show notification directly
                try {
                    NotificationManager manager = getSystemService(NotificationManager.class);
                    if (manager != null) {
                        manager.notify(NOTIFICATION_ID, notification);
                        Log.d(TAG, "✅ Fallback: Posted notification directly");
                        DebugLogger.log("✅ Fallback: Posted notification directly");
                    }
                } catch (Exception e2) {
                    Log.e(TAG, "❌ Fallback also failed: " + e2.getMessage());
                    DebugLogger.error("Fallback notification also failed", e2);
                }
            }

            // ALSO post notification explicitly to ensure it shows
            try {
                NotificationManagerCompat notificationManager = NotificationManagerCompat.from(this);
                
                // Check if notifications are enabled
                if (!notificationManager.areNotificationsEnabled()) {
                    Log.e(TAG, "═══════════════════════════════════════");
                    Log.e(TAG, "❌ NOTIFICATIONS ARE DISABLED!");
                    Log.e(TAG, "   User must enable notifications in Settings > Apps > BlockStar > Notifications");
                    Log.e(TAG, "═══════════════════════════════════════");
                    DebugLogger.logNotification("NOTIFICATIONS DISABLED GLOBALLY", false, 
                        "User must enable in Settings > Apps > BlockStar > Notifications");
                } else {
                    Log.d(TAG, "✅ Notifications are enabled globally");
                    DebugLogger.logNotification("Notifications enabled globally", true, null);
                }
                
                // Check if the specific channel is enabled (Android 8+)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    NotificationManager manager = getSystemService(NotificationManager.class);
                    if (manager != null) {
                        NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
                        if (channel == null) {
                            Log.e(TAG, "❌ Notification channel 'calls' does not exist!");
                            DebugLogger.logNotification("Channel 'calls' DOES NOT EXIST", false, 
                                "Channel was not created properly");
                        } else if (channel.getImportance() == NotificationManager.IMPORTANCE_NONE) {
                            Log.e(TAG, "❌ Notification channel 'calls' is DISABLED by user!");
                            Log.e(TAG, "   User must enable in Settings > Apps > BlockStar > Notifications > Incoming Calls");
                            DebugLogger.logNotification("Channel 'calls' DISABLED BY USER", false, 
                                "User must enable in Settings > Apps > BlockStar > Notifications > Incoming Calls");
                        } else {
                            Log.d(TAG, "✅ Notification channel 'calls' is enabled");
                            Log.d(TAG, "   Importance: " + channel.getImportance());
                            Log.d(TAG, "   Can show badge: " + channel.canShowBadge());
                            Log.d(TAG, "   Bypass DND: " + channel.canBypassDnd());
                            DebugLogger.logNotification("Channel 'calls' is ENABLED", true, 
                                "Importance: " + channel.getImportance() + 
                                ", BypassDND: " + channel.canBypassDnd() +
                                ", LockscreenVisibility: " + channel.getLockscreenVisibility());
                        }
                    }
                }
            } catch (Exception e) {
                Log.e(TAG, "Error checking notification status: " + e.getMessage());
                DebugLogger.error("Error checking notification status", e);
            }

            // Start ringtone and vibration AFTER notification is shown
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
            
            // Delete and recreate channel to ensure settings are correct
            manager.deleteNotificationChannel(CHANNEL_ID);

            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH // HIGH is required for heads-up
            );

            channel.setDescription("Incoming call notifications");
            channel.enableLights(true);
            channel.setLightColor(Color.BLUE);
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 1000, 500, 1000});
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.setBypassDnd(true);
            
            // IMPORTANT: Don't set sound on channel - we handle ringtone separately
            // Setting sound here can interfere with our custom ringtone
            channel.setSound(null, null);

            manager.createNotificationChannel(channel);
            
            // Verify channel was created
            NotificationChannel created = manager.getNotificationChannel(CHANNEL_ID);
            if (created != null) {
                Log.d(TAG, "✅ Notification channel created successfully");
                Log.d(TAG, "   Importance: " + created.getImportance());
                Log.d(TAG, "   Lock screen: " + created.getLockscreenVisibility());
                Log.d(TAG, "   Bypass DND: " + created.canBypassDnd());
            } else {
                Log.e(TAG, "❌ Failed to create notification channel!");
            }
        }
    }

    private Notification buildCallNotification() {
        Log.d(TAG, "📞 Building call notification...");
        
        // Intent to open app when notification is tapped
        Intent fullScreenIntent = new Intent(this, MainActivity.class);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | 
                                  Intent.FLAG_ACTIVITY_CLEAR_TOP | 
                                  Intent.FLAG_ACTIVITY_SINGLE_TOP);
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

        // Answer action intent - goes to SERVICE first to stop ringtone
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
            .setTicker(text)
            .setPriority(NotificationCompat.PRIORITY_MAX) // MAX for heads-up
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setAutoCancel(false)
            .setShowWhen(true)
            .setUsesChronometer(true)
            // Full screen intent - CRITICAL for lock screen
            .setFullScreenIntent(fullScreenPendingIntent, true)
            .setContentIntent(fullScreenPendingIntent)
            // Color
            .setColor(0xFF3B82F6)
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

        // Android 12+ specific settings
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
            
            // Use call style for Android 12+
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
        
        // Set flags for lock screen visibility
        notification.flags |= Notification.FLAG_INSISTENT; // Repeat sound
        notification.flags |= Notification.FLAG_NO_CLEAR;  // Can't be swiped away
        
        Log.d(TAG, "✅ Notification built successfully");
        return notification;
    }

    private void handleAnswerCall() {
        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "✅ ANSWERING CALL: " + currentCallId);
        Log.d(TAG, "═══════════════════════════════════════");

        // Stop ringtone and vibration
        stopRingtoneAndVibration();

        // Open app with answer action
        Intent intent = new Intent(this, MainActivity.class);
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

    /**
     * Acquire wake locks to turn on screen and keep device awake
     */
    private void acquireWakeLocks() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (powerManager == null) {
                Log.e(TAG, "❌ PowerManager is null!");
                return;
            }

            // Release any existing wake locks
            releaseWakeLocks();

            // Wake lock to keep CPU running
            wakeLock = powerManager.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "BlockStarCypher:IncomingCallWakeLock"
            );
            wakeLock.acquire(60000); // 60 seconds max
            Log.d(TAG, "✅ Partial wake lock acquired");

            // Screen wake lock - CRITICAL for turning on screen
            @SuppressWarnings("deprecation")
            PowerManager.WakeLock screenLock = powerManager.newWakeLock(
                PowerManager.FULL_WAKE_LOCK |
                PowerManager.ACQUIRE_CAUSES_WAKEUP |
                PowerManager.ON_AFTER_RELEASE,
                "BlockStarCypher:ScreenWakeLock"
            );
            screenWakeLock = screenLock;
            screenWakeLock.acquire(60000); // 60 seconds max
            Log.d(TAG, "✅ Screen wake lock acquired - screen should turn on");

        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to acquire wake locks: " + e.getMessage());
            e.printStackTrace();
        }
    }

    /**
     * Release all wake locks
     */
    private void releaseWakeLocks() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                wakeLock = null;
                Log.d(TAG, "  ✓ Partial wake lock released");
            }
        } catch (Exception e) {
            Log.e(TAG, "  ✗ Error releasing partial wake lock: " + e.getMessage());
        }

        try {
            if (screenWakeLock != null && screenWakeLock.isHeld()) {
                screenWakeLock.release();
                screenWakeLock = null;
                Log.d(TAG, "  ✓ Screen wake lock released");
            }
        } catch (Exception e) {
            Log.e(TAG, "  ✗ Error releasing screen wake lock: " + e.getMessage());
        }
    }

    private void playRingtone() {
        try {
            // Check if phone is not in silent mode
            AudioManager audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (audioManager != null) {
                int ringerMode = audioManager.getRingerMode();
                int volume = audioManager.getStreamVolume(AudioManager.STREAM_RING);

                Log.d(TAG, "📢 Ringer mode: " + ringerMode + ", Volume: " + volume);

                if (ringerMode == AudioManager.RINGER_MODE_SILENT) {
                    Log.w(TAG, "⚠️ Phone is in silent mode - no ringtone will play");
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
            } else {
                Log.e(TAG, "❌ Ringtone is null!");
            }
        } catch (Exception e) {
            Log.e(TAG, "❌ Error playing ringtone: " + e.getMessage());
            e.printStackTrace();
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
            } else {
                Log.w(TAG, "⚠️ No vibrator available");
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

        // Release wake locks
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
