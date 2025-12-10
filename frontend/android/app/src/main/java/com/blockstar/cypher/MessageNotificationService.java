package world.blockstar.cypher;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.util.Log;

import androidx.core.app.NotificationCompat;

public class MessageNotificationService extends Service {
    private static final String TAG = "MessageNotifService";
    private static final String CHANNEL_ID = "messages";
    private static final String CHANNEL_NAME = "Messages";
    private static final int NOTIFICATION_ID_BASE = 200;

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

        // Create notification
        Notification notification = buildMessageNotification(senderName, messagePreview, conversationId);
        
        // Use unique notification ID based on conversation
        int notificationId = NOTIFICATION_ID_BASE + (conversationId != null ? conversationId.hashCode() % 1000 : 0);
        
        // Start as foreground briefly, then show notification and stop
        startForeground(notificationId, notification);
        
        // Stop the foreground service but keep the notification
        stopForeground(false);
        stopSelf();

        return START_NOT_STICKY;
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);

            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            );

            channel.setDescription("New message notifications");
            channel.enableLights(true);
            channel.enableVibration(true);
            channel.setVibrationPattern(new long[]{0, 250, 250, 250});
            channel.setLockscreenVisibility(Notification.VISIBILITY_PRIVATE);

            manager.createNotificationChannel(channel);
            Log.d(TAG, "✅ Message notification channel created");
        }
    }

    private Notification buildMessageNotification(String senderName, String messagePreview, String conversationId) {
        // Intent to open app and navigate to conversation
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openIntent.putExtra("conversationId", conversationId);
        openIntent.putExtra("fromNotification", true);
        openIntent.setAction("OPEN_CONVERSATION");

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            conversationId != null ? conversationId.hashCode() : 0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Mark as read action
        Intent markReadIntent = new Intent(this, NotificationActionReceiver.class);
        markReadIntent.setAction("MARK_READ");
        markReadIntent.putExtra("conversationId", conversationId);

        PendingIntent markReadPendingIntent = PendingIntent.getBroadcast(
            this,
            conversationId != null ? conversationId.hashCode() + 1000 : 1000,
            markReadIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_dialog_email)
            .setContentTitle(senderName)
            .setContentText(messagePreview)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(messagePreview))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .addAction(
                android.R.drawable.ic_menu_view,
                "Mark as Read",
                markReadPendingIntent
            )
            .build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
