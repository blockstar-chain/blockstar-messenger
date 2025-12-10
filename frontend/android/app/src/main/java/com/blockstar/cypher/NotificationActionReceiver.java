package world.blockstar.cypher;

import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class NotificationActionReceiver extends BroadcastReceiver {
    private static final String TAG = "NotifActionReceiver";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        Log.d(TAG, "Received action: " + action);

        if ("MARK_READ".equals(action)) {
            String conversationId = intent.getStringExtra("conversationId");
            Log.d(TAG, "Marking conversation as read: " + conversationId);
            
            // Cancel the notification
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager != null && conversationId != null) {
                int notificationId = 200 + conversationId.hashCode() % 1000;
                manager.cancel(notificationId);
            }
            
            // The actual "mark as read" will be handled when the user opens the app
            // We could also send a broadcast to the app here if it's running
        }
    }
}
