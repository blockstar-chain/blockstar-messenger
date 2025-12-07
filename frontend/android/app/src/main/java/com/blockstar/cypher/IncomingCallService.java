package com.blockstar.cypher;

import android.app.*;
import android.content.*;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

public class IncomingCallService extends Service {

    private Ringtone ringtone;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {

        String caller = intent.getStringExtra("caller");
        String callId = intent.getStringExtra("callId");

        Intent fullScreenIntent = new Intent(this, MainActivity.class);
        fullScreenIntent.putExtra("callId", callId);
        fullScreenIntent.putExtra("caller", caller);
        fullScreenIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        PendingIntent pendingIntent = PendingIntent.getActivity(
            this, 0, fullScreenIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        Notification notification = new NotificationCompat.Builder(this, "incoming_calls")
                .setSmallIcon(R.drawable.ic_call)
                .setContentTitle("Incoming Call")
                .setContentText(caller + " is calling…")
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setFullScreenIntent(pendingIntent, true)
                .setAutoCancel(true)
                .build();

        startForeground(101, notification);

        // Play ringtone
        Uri ringtoneUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
        ringtone = RingtoneManager.getRingtone(this, ringtoneUri);
        ringtone.play();

        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (ringtone != null) ringtone.stop();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }
}
