package com.blockstar.cypher;

import android.content.Intent;
import android.util.Log;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

public class CallFirebaseMessagingService extends FirebaseMessagingService {

    @Override
    public void onMessageReceived(RemoteMessage message) {
        String type = message.getData().get("type");

        Log.d("FCM", "Received: " + message.getData());

        if ("incoming_call".equals(type)) {
            Intent serviceIntent = new Intent(this, IncomingCallService.class);
            serviceIntent.putExtra("caller", message.getData().get("caller"));
            serviceIntent.putExtra("callId", message.getData().get("callId"));

            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        }
    }
}
