package com.blockstar.cypher;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        
        // Register the audio routing plugin
        registerPlugin(AudioRoutingPlugin.class);
    }
}