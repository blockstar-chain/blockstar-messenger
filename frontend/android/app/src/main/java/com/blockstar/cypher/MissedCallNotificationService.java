package com.blockstar.cypher;

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

public class MissedCallNotificationService extends Service {
    private static final String TAG = "MissedCallNotifService";
    private static final String CHANNEL_ID = "missed_calls";
    private static final String CHANNEL_NAME = "Missed Calls";
    private static final int NOTIFICATION_ID_BASE = 300;

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

        String callerName = intent.getStringExtra("callerName");
        String callerId = intent.getStringExtra("callerId");
        String callType = intent.getStringExtra("callType");

        if (callerName == null) callerName = "Unknown";
        if (callType == null) callType = "audio";

        Log.d(TAG, "═══════════════════════════════════════");
        Log.d(TAG, "📵 SHOWING MISSED CALL NOTIFICATION");
        Log.d(TAG, "  From: " + callerName);
        Log.d(TAG, "  Type: " + callType);
        Log.d(TAG, "═══════════════════════════════════════");

        // Create notification
        Notification notification = buildMissedCallNotification(callerName, callerId, callType);
        
        // Use unique notification ID
        int notificationId = NOTIFICATION_ID_BASE + (callerId != null ? callerId.hashCode() % 1000 : 0);
        
        // Show notification
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(notificationId, notification);
        }

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

            channel.setDescription("Missed call notifications");
            channel.enableLights(true);
            channel.enableVibration(true);
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);

            manager.createNotificationChannel(channel);
            Log.d(TAG, "✅ Missed call notification channel created");
        }
    }

    private Notification buildMissedCallNotification(String callerName, String callerId, String callType) {
        // Intent to open app
        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openIntent.putExtra("fromNotification", true);
        openIntent.putExtra("missedCall", true);
        openIntent.putExtra("callerId", callerId);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            callerId != null ? callerId.hashCode() : 0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        // Call back action
        Intent callBackIntent = new Intent(this, MainActivity.class);
        callBackIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        callBackIntent.putExtra("action", "callback");
        callBackIntent.putExtra("callerId", callerId);
        callBackIntent.putExtra("callType", callType);
        callBackIntent.setAction("CALLBACK");

        PendingIntent callBackPendingIntent = PendingIntent.getActivity(
            this,
            callerId != null ? callerId.hashCode() + 1000 : 1000,
            callBackIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        String callTypeEmoji = "video".equals(callType) ? "📹" : "📞";
        String title = callTypeEmoji + " Missed " + callType + " call";

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_menu_call)
            .setContentTitle(title)
            .setContentText("From " + callerName)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MISSED_CALL)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .addAction(
                android.R.drawable.ic_menu_call,
                "Call Back",
                callBackPendingIntent
            )
            .build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
