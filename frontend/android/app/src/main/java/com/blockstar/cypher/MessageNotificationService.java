package world.blockstar.cypher;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.util.Log;

import androidx.core.app.NotificationCompat;

public class MessageNotificationService extends Service {
    private static final String TAG = "MessageNotifService";
    private static final String CHANNEL_ID = "messages";
    private static final String CHANNEL_NAME = "Messages";
    private static final int NOTIFICATION_ID_BASE = 200;
    
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        String senderName = intent.getStringExtra("senderName");
        String messagePreview = intent.getStringExtra("messagePreview");
        String conversationId = intent.getStringExtra("conversationId");
        String messageId = intent.getStringExtra("messageId");

        if (senderName == null) senderName = "New Message";
        if (messagePreview == null) messagePreview = "You have a new message";

        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "💬 SHOWING MESSAGE NOTIFICATION");
        Log.d(TAG, "  From: " + senderName);
        Log.d(TAG, "  Preview: " + messagePreview);
        Log.d(TAG, "  Conversation: " + conversationId);
        Log.d(TAG, "═══════════════════════════════════════");

        // Wake up the screen briefly
        wakeScreen();

        // Create notification
        Notification notification = buildMessageNotification(senderName, messagePreview, conversationId);
        
        // Use unique notification ID based on conversation
        int notificationId = NOTIFICATION_ID_BASE + (conversationId != null ? Math.abs(conversationId.hashCode() % 1000) : 0);
        
        // Start as foreground briefly, then show notification and stop
        try {
            startForeground(notificationId, notification);
            Log.d(TAG, "✅ Started foreground with notification ID: " + notificationId);
        } catch (Exception e) {
            Log.e(TAG, "❌ Failed to start foreground: " + e.getMessage());
        }
        
        // Stop the foreground service but keep the notification
        stopForeground(false);
        
        // Release wake lock
        releaseWakeLock();
        
        stopSelf();

        return START_NOT_STICKY;
    }

    private void wakeScreen() {
        try {
            PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
            if (powerManager != null) {
                wakeLock = powerManager.newWakeLock(
                    PowerManager.FULL_WAKE_LOCK |
                    PowerManager.ACQUIRE_CAUSES_WAKEUP |
                    PowerManager.ON_AFTER_RELEASE,
                    "BlockStarCypher:MessageWakeLock"
                );
                wakeLock.acquire(3000); // 3 seconds to see notification
                Log.d(TAG, "✅ Screen wake lock acquired");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error acquiring wake lock: " + e.getMessage());
        }
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
                wakeLock = null;
                Log.d(TAG, "✅ Screen wake lock released");
            }
        } catch (Exception e) {
            Log.e(TAG, "Error releasing wake lock: " + e.getMessage());
        }
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager == null) return;
            
            // Check if channel exists
            NotificationChannel existing = manager.getNotificationChannel(CHANNEL_ID);
            if (existing != null) {
                Log.d(TAG, "📢 Message notification channel already exists");
                return;
            }

            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );

            channel.setDescription("New message notifications");
            channel.enableLights(true);
            channel.setLightColor(Color.GREEN);
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 250, 250, 250});
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);
            
            // Set notification sound
            Uri notificationUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
            AudioAttributes audioAttributes = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
            channel.setSound(notificationUri, audioAttributes);

            manager.createNotificationChannel(channel);
            Log.d(TAG, "✅ Message notification channel created");
        }
    }

    private Notification buildMessageNotification(String senderName, String messagePreview, String conversationId) {
        // Intent to open app and navigate to conversation
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | 
                           Intent.FLAG_ACTIVITY_CLEAR_TOP |
                           Intent.FLAG_ACTIVITY_SINGLE_TOP);
        openIntent.putExtra("conversationId", conversationId);
        openIntent.putExtra("fromNotification", true);
        openIntent.setAction("OPEN_CONVERSATION");

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            conversationId != null ? Math.abs(conversationId.hashCode()) : 0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Mark as read action
        Intent markReadIntent = new Intent(this, NotificationActionReceiver.class);
        markReadIntent.setAction("MARK_READ");
        markReadIntent.putExtra("conversationId", conversationId);

        PendingIntent markReadPendingIntent = PendingIntent.getBroadcast(
            this,
            conversationId != null ? Math.abs(conversationId.hashCode()) + 1000 : 1000,
            markReadIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(senderName)
            .setContentText(messagePreview)
            .setTicker(senderName + ": " + messagePreview) // For accessibility
            .setStyle(new NotificationCompat.BigTextStyle().bigText(messagePreview))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setShowWhen(true)
            .setContentIntent(pendingIntent)
            // Vibration
            .setVibrate(new long[]{0, 250, 250, 250})
            // Lights
            .setLights(Color.GREEN, 500, 500)
            // Color
            .setColor(0xFF10B981)
            // Mark as read action
            .addAction(
                android.R.drawable.ic_menu_view,
                "Mark as Read",
                markReadPendingIntent
            );

        // Android 12+ specific settings
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }

        return builder.build();
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
