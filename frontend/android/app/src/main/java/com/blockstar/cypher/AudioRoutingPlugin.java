// Android native plugin for audio routing
// Save this as: android/app/src/main/java/com/blockstar/cypher/AudioRoutingPlugin.java

package com.blockstar.cypher;

import android.content.Context;
import android.media.AudioManager;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AudioRouting")
public class AudioRoutingPlugin extends Plugin {
    private static final String TAG = "AudioRouting";
    private AudioManager audioManager;
    private int originalMode;
    private boolean originalSpeakerState;

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        if (audioManager != null) {
            originalMode = audioManager.getMode();
            originalSpeakerState = audioManager.isSpeakerphoneOn();
        }
        Log.d(TAG, "AudioRoutingPlugin loaded");
    }

    @PluginMethod
    public void setVoiceCallMode(PluginCall call) {
        try {
            if (audioManager != null) {
                // Set audio mode for voice communication
                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                
                // Request audio focus for voice call
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    audioManager.requestAudioFocus(
                        new android.media.AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                            .setAudioAttributes(
                                new android.media.AudioAttributes.Builder()
                                    .setUsage(android.media.AudioAttributes.USAGE_VOICE_COMMUNICATION)
                                    .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                                    .build()
                            )
                            .build()
                    );
                } else {
                    audioManager.requestAudioFocus(null, AudioManager.STREAM_VOICE_CALL, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT);
                }
                
                Log.d(TAG, "Voice call mode set");
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Error setting voice call mode", e);
            call.reject("Failed to set voice call mode: " + e.getMessage());
        }
    }

    @PluginMethod
    public void setDefaultMode(PluginCall call) {
        try {
            if (audioManager != null) {
                // Restore original audio mode
                audioManager.setMode(originalMode);
                audioManager.setSpeakerphoneOn(originalSpeakerState);
                
                // Abandon audio focus
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    audioManager.abandonAudioFocusRequest(
                        new android.media.AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).build()
                    );
                } else {
                    audioManager.abandonAudioFocus(null);
                }
                
                Log.d(TAG, "Default mode restored");
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Error setting default mode", e);
            call.reject("Failed to set default mode: " + e.getMessage());
        }
    }

    @PluginMethod
    public void setSpeakerOn(PluginCall call) {
        try {
            if (audioManager != null) {
                audioManager.setSpeakerphoneOn(true);
                Log.d(TAG, "Speaker ON");
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Error enabling speaker", e);
            call.reject("Failed to enable speaker: " + e.getMessage());
        }
    }

    @PluginMethod
    public void setSpeakerOff(PluginCall call) {
        try {
            if (audioManager != null) {
                audioManager.setSpeakerphoneOn(false);
                Log.d(TAG, "Speaker OFF - using earpiece");
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Error disabling speaker", e);
            call.reject("Failed to disable speaker: " + e.getMessage());
        }
    }

    @PluginMethod
    public void isSpeakerOn(PluginCall call) {
        try {
            boolean enabled = false;
            if (audioManager != null) {
                enabled = audioManager.isSpeakerphoneOn();
            }
            JSObject result = new JSObject();
            result.put("enabled", enabled);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Error checking speaker state", e);
            call.reject("Failed to check speaker state: " + e.getMessage());
        }
    }

    @PluginMethod
    public void getCurrentRoute(PluginCall call) {
        try {
            String route = "earpiece";
            if (audioManager != null) {
                if (audioManager.isSpeakerphoneOn()) {
                    route = "speaker";
                } else if (audioManager.isBluetoothScoOn() || audioManager.isBluetoothA2dpOn()) {
                    route = "bluetooth";
                } else if (audioManager.isWiredHeadsetOn()) {
                    route = "headset";
                } else {
                    route = "earpiece";
                }
            }
            JSObject result = new JSObject();
            result.put("route", route);
            call.resolve(result);
        } catch (Exception e) {
            Log.e(TAG, "Error getting audio route", e);
            call.reject("Failed to get audio route: " + e.getMessage());
        }
    }
}
