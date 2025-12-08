// android/app/src/main/java/com/blockstar/cypher/AudioRoutingPlugin.java
package com.blockstar.cypher;

import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Audio Routing Plugin for BlockStar Cypher
 * 
 * Controls audio output routing between earpiece and speaker
 * for voice/video calls. Works with WebRTC by managing
 * AudioManager mode and speaker state together.
 */
@CapacitorPlugin(name = "AudioRouting")
public class AudioRoutingPlugin extends Plugin {

    private static final String TAG = "AudioRoutingPlugin";
    private AudioManager audioManager;
    private boolean isSpeakerOn = false;
    private int originalMode = AudioManager.MODE_NORMAL;
    private boolean originalSpeakerState = false;

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (audioManager != null) {
            originalMode = audioManager.getMode();
            originalSpeakerState = audioManager.isSpeakerphoneOn();
        }
        Log.d(TAG, "AudioRoutingPlugin loaded");
    }

    /**
     * Set audio route to speaker or earpiece
     * @param call - expects { "speaker": boolean }
     */
    @PluginMethod
    public void setAudioRoute(PluginCall call) {
        Boolean speaker = call.getBoolean("speaker", false);
        
        if (audioManager == null) {
            Log.e(TAG, "AudioManager is null");
            call.reject("AudioManager not available");
            return;
        }

        try {
            isSpeakerOn = speaker;
            
            Log.d(TAG, "════════════════════════════════════════════════════════════");
            Log.d(TAG, "🔊 Setting audio route: " + (speaker ? "SPEAKER" : "EARPIECE"));
            Log.d(TAG, "════════════════════════════════════════════════════════════");

            // For WebRTC calls, we need to set the mode AND speaker state
            // The order matters!
            
            if (speaker) {
                // Switch to speaker
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                audioManager.setSpeakerphoneOn(true);
                
                // Double-check it took effect
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    // Android 12+ has stricter audio focus
                    audioManager.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, 
                        AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
                }
                
                Log.d(TAG, "🔊 Speaker ON - Mode: IN_COMMUNICATION");
            } else {
                // Switch to earpiece
                audioManager.setSpeakerphoneOn(false);
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                
                // Force earpiece by also disabling bluetooth if needed
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    // On Android 12+, we might need to explicitly request earpiece
                    try {
                        audioManager.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL,
                            AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
                    } catch (Exception e) {
                        Log.w(TAG, "Could not request audio focus: " + e.getMessage());
                    }
                }
                
                Log.d(TAG, "🔊 Speaker OFF (Earpiece) - Mode: IN_COMMUNICATION");
            }

            // Verify the change
            boolean actualSpeakerState = audioManager.isSpeakerphoneOn();
            int actualMode = audioManager.getMode();
            
            Log.d(TAG, "🔊 Verification - Speaker: " + actualSpeakerState + ", Mode: " + getModeString(actualMode));

            JSObject result = new JSObject();
            result.put("success", true);
            result.put("speaker", actualSpeakerState);
            result.put("mode", getModeString(actualMode));
            call.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "Error setting audio route: " + e.getMessage());
            e.printStackTrace();
            call.reject("Failed to set audio route: " + e.getMessage());
        }
    }

    /**
     * Get current audio route
     */
    @PluginMethod
    public void getAudioRoute(PluginCall call) {
        if (audioManager == null) {
            call.reject("AudioManager not available");
            return;
        }

        try {
            boolean speakerOn = audioManager.isSpeakerphoneOn();
            int mode = audioManager.getMode();
            
            String route = "unknown";
            if (speakerOn) {
                route = "speaker";
            } else if (mode == AudioManager.MODE_IN_COMMUNICATION || mode == AudioManager.MODE_IN_CALL) {
                route = "earpiece";
            } else {
                route = "default";
            }

            // Check for bluetooth
            if (audioManager.isBluetoothScoOn() || audioManager.isBluetoothA2dpOn()) {
                route = "bluetooth";
            }

            Log.d(TAG, "🔊 Current route: " + route + ", Speaker: " + speakerOn + ", Mode: " + getModeString(mode));

            JSObject result = new JSObject();
            result.put("route", route);
            result.put("speaker", speakerOn);
            result.put("mode", getModeString(mode));
            result.put("bluetoothSco", audioManager.isBluetoothScoOn());
            call.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "Error getting audio route: " + e.getMessage());
            call.reject("Failed to get audio route: " + e.getMessage());
        }
    }

    /**
     * Initialize audio for a call
     * Call this when starting a voice/video call
     */
    @PluginMethod
    public void initializeCallAudio(PluginCall call) {
        if (audioManager == null) {
            call.reject("AudioManager not available");
            return;
        }

        try {
            Log.d(TAG, "🔊 Initializing call audio...");
            
            // Save original state
            originalMode = audioManager.getMode();
            originalSpeakerState = audioManager.isSpeakerphoneOn();
            
            // Set to communication mode (required for WebRTC)
            audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
            
            // Start with earpiece by default
            audioManager.setSpeakerphoneOn(false);
            isSpeakerOn = false;
            
            // Request audio focus
            int result = audioManager.requestAudioFocus(
                null,
                AudioManager.STREAM_VOICE_CALL,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
            );
            
            Log.d(TAG, "🔊 Call audio initialized - Focus result: " + result);

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("mode", "communication");
            ret.put("speaker", false);
            call.resolve(ret);

        } catch (Exception e) {
            Log.e(TAG, "Error initializing call audio: " + e.getMessage());
            call.reject("Failed to initialize call audio: " + e.getMessage());
        }
    }

    /**
     * Reset audio after a call ends
     */
    @PluginMethod
    public void resetAudio(PluginCall call) {
        if (audioManager == null) {
            call.reject("AudioManager not available");
            return;
        }

        try {
            Log.d(TAG, "🔊 Resetting audio to normal...");
            
            // Restore original state
            audioManager.setSpeakerphoneOn(originalSpeakerState);
            audioManager.setMode(originalMode);
            
            // Abandon audio focus
            audioManager.abandonAudioFocus(null);
            
            isSpeakerOn = originalSpeakerState;
            
            Log.d(TAG, "🔊 Audio reset complete");

            JSObject result = new JSObject();
            result.put("success", true);
            call.resolve(result);

        } catch (Exception e) {
            Log.e(TAG, "Error resetting audio: " + e.getMessage());
            call.reject("Failed to reset audio: " + e.getMessage());
        }
    }

    /**
     * Toggle between speaker and earpiece
     */
    @PluginMethod
    public void toggleSpeaker(PluginCall call) {
        isSpeakerOn = !isSpeakerOn;
        
        // Reuse setAudioRoute logic
        JSObject params = new JSObject();
        params.put("speaker", isSpeakerOn);
        call.setData(params);
        
        // Create a new call with the speaker parameter
        PluginCall toggleCall = new PluginCall(getBridge().getApp().getMainExecutor(), "", "", call.getCallbackId()) {
            @Override
            public Boolean getBoolean(String name, Boolean defaultValue) {
                if ("speaker".equals(name)) {
                    return isSpeakerOn;
                }
                return defaultValue;
            }
        };
        
        // Just set it directly
        if (audioManager != null) {
            try {
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                audioManager.setSpeakerphoneOn(isSpeakerOn);
                
                Log.d(TAG, "🔊 Toggled speaker: " + isSpeakerOn);
                
                JSObject result = new JSObject();
                result.put("success", true);
                result.put("speaker", isSpeakerOn);
                call.resolve(result);
            } catch (Exception e) {
                call.reject("Failed to toggle speaker: " + e.getMessage());
            }
        } else {
            call.reject("AudioManager not available");
        }
    }

    /**
     * Check if speaker is currently on
     */
    @PluginMethod
    public void isSpeakerOn(PluginCall call) {
        if (audioManager == null) {
            call.reject("AudioManager not available");
            return;
        }

        boolean speakerOn = audioManager.isSpeakerphoneOn();
        
        JSObject result = new JSObject();
        result.put("speaker", speakerOn);
        call.resolve(result);
    }

    /**
     * Get available audio devices
     */
    @PluginMethod
    public void getAvailableDevices(PluginCall call) {
        if (audioManager == null) {
            call.reject("AudioManager not available");
            return;
        }

        try {
            JSObject result = new JSObject();
            result.put("earpiece", true); // Always available
            result.put("speaker", true);  // Always available
            result.put("bluetooth", audioManager.isBluetoothScoAvailableOffCall() || audioManager.isBluetoothA2dpOn());
            result.put("wiredHeadset", audioManager.isWiredHeadsetOn());
            
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Failed to get devices: " + e.getMessage());
        }
    }

    private String getModeString(int mode) {
        switch (mode) {
            case AudioManager.MODE_NORMAL:
                return "NORMAL";
            case AudioManager.MODE_RINGTONE:
                return "RINGTONE";
            case AudioManager.MODE_IN_CALL:
                return "IN_CALL";
            case AudioManager.MODE_IN_COMMUNICATION:
                return "IN_COMMUNICATION";
            default:
                return "UNKNOWN(" + mode + ")";
        }
    }
}
