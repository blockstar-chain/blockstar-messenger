package com.blockstar.cypher;

import android.os.Build;
import android.os.Bundle;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        createNotificationChannels();
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            
            // High priority channel for incoming calls
            NotificationChannel callChannel = new NotificationChannel(
                "incoming_calls",
                "Incoming Calls",
                NotificationManager.IMPORTANCE_HIGH
            );
            callChannel.setDescription("Notifications for incoming voice and video calls");
            callChannel.enableVibration(true);
            callChannel.setVibrationPattern(new long[]{0, 500, 200, 500});
            manager.createNotificationChannel(callChannel);
            
            // Default channel for messages
            NotificationChannel messageChannel = new NotificationChannel(
                "messages",
                "Messages",
                NotificationManager.IMPORTANCE_DEFAULT
            );
            messageChannel.setDescription("Notifications for new messages");
            manager.createNotificationChannel(messageChannel);
        }
    }
}