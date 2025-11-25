import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';

const { width, height } = Dimensions.get('window');

export default function CallScreen() {
  const navigation = useNavigation();
  const route = useRoute<any>();
  const { type, name } = route.params || { type: 'audio', name: '@user' };

  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeaker, setIsSpeaker] = useState(false);
  const [isVideoOn, setIsVideoOn] = useState(type === 'video');
  const [callStatus, setCallStatus] = useState<'connecting' | 'ringing' | 'active'>('connecting');

  useEffect(() => {
    // Simulate connection
    const connectTimeout = setTimeout(() => setCallStatus('ringing'), 1000);
    const ringTimeout = setTimeout(() => setCallStatus('active'), 3000);

    return () => {
      clearTimeout(connectTimeout);
      clearTimeout(ringTimeout);
    };
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (callStatus === 'active') {
      interval = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [callStatus]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const endCall = () => {
    navigation.goBack();
  };

  const CallButton = ({ icon, label, onPress, danger }: any) => (
    <TouchableOpacity style={styles.callButton} onPress={onPress}>
      <View style={[styles.callButtonIcon, danger && styles.callButtonDanger]}>
        <Icon name={icon} size={28} color="#fff" />
      </View>
      <Text style={styles.callButtonLabel}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      {type === 'video' && isVideoOn ? (
        <View style={styles.videoContainer}>
          <View style={styles.remoteVideo}>
            <Text style={styles.videoPlaceholder}>Remote Video</Text>
          </View>
          <View style={styles.localVideo}>
            <Text style={styles.localVideoText}>You</Text>
          </View>
        </View>
      ) : (
        <View style={styles.audioContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{name.slice(1, 3).toUpperCase()}</Text>
          </View>
          <Text style={styles.callerName}>{name}</Text>
          <Text style={styles.callStatus}>
            {callStatus === 'connecting' && 'Connecting...'}
            {callStatus === 'ringing' && 'Ringing...'}
            {callStatus === 'active' && formatDuration(callDuration)}
          </Text>
        </View>
      )}

      <View style={styles.controls}>
        <CallButton
          icon={isMuted ? 'mic-off' : 'mic'}
          label={isMuted ? 'Unmute' : 'Mute'}
          onPress={() => setIsMuted(!isMuted)}
        />
        {type === 'video' && (
          <CallButton
            icon={isVideoOn ? 'videocam' : 'videocam-off'}
            label={isVideoOn ? 'Video Off' : 'Video On'}
            onPress={() => setIsVideoOn(!isVideoOn)}
          />
        )}
        <CallButton
          icon={isSpeaker ? 'volume-high' : 'volume-medium'}
          label={isSpeaker ? 'Speaker' : 'Phone'}
          onPress={() => setIsSpeaker(!isSpeaker)}
        />
        <CallButton
          icon="call"
          label="End"
          onPress={endCall}
          danger
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1f2937',
  },
  videoContainer: {
    flex: 1,
  },
  remoteVideo: {
    flex: 1,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
  },
  videoPlaceholder: {
    color: '#9ca3af',
    fontSize: 18,
  },
  localVideo: {
    position: 'absolute',
    top: 60,
    right: 20,
    width: 120,
    height: 160,
    backgroundColor: '#4b5563',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  localVideoText: {
    color: '#d1d5db',
  },
  audioContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#0ea5e9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  avatarText: {
    color: '#fff',
    fontSize: 40,
    fontWeight: '600',
  },
  callerName: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '600',
    marginBottom: 8,
  },
  callStatus: {
    color: '#9ca3af',
    fontSize: 16,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingVertical: 40,
    paddingBottom: 60,
    backgroundColor: '#111827',
  },
  callButton: {
    alignItems: 'center',
  },
  callButtonIcon: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#374151',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  callButtonDanger: {
    backgroundColor: '#ef4444',
  },
  callButtonLabel: {
    color: '#d1d5db',
    fontSize: 12,
  },
});
