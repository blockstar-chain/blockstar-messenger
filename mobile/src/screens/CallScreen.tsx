// mobile/src/screens/CallScreen.tsx
// BlockStar Cypher - Call Screen (Dark Midnight Theme)

import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, SHADOWS } from '../constants/theme';

export function CallScreen({ route, navigation }: any) {
  const { type } = route.params;
  const [duration, setDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [callStatus, setCallStatus] = useState<'connecting' | 'ringing' | 'active'>('connecting');

  useEffect(() => {
    // Simulate call connection
    const connectionTimer = setTimeout(() => {
      setCallStatus('ringing');
    }, 1000);

    const activeTimer = setTimeout(() => {
      setCallStatus('active');
    }, 3000);

    return () => {
      clearTimeout(connectionTimer);
      clearTimeout(activeTimer);
    };
  }, []);

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (callStatus === 'active') {
      interval = setInterval(() => {
        setDuration(prev => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [callStatus]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const handleEndCall = () => {
    navigation.goBack();
  };

  return (
    <View style={styles.container}>
      {/* Background gradient */}
      <LinearGradient
        colors={[COLORS.bgSecondary, COLORS.bgPrimary]}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Avatar */}
      <View style={styles.avatarContainer}>
        <LinearGradient
          colors={[COLORS.primary, COLORS.cyan]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.avatar}
        >
          <Text style={styles.avatarText}>U</Text>
        </LinearGradient>
        
        {/* Animated ring when ringing */}
        {callStatus === 'ringing' && (
          <View style={styles.pulseRing} />
        )}
      </View>

      {/* Call info */}
      <Text style={styles.callerName}>Unknown User</Text>
      <Text style={styles.status}>
        {callStatus === 'connecting' && 'Connecting...'}
        {callStatus === 'ringing' && 'Ringing...'}
        {callStatus === 'active' && formatDuration(duration)}
      </Text>

      <View style={styles.callTypeContainer}>
        <Icon 
          name={type === 'video' ? 'videocam' : 'call'} 
          size={16} 
          color={COLORS.textSecondary} 
        />
        <Text style={styles.callType}>
          {type === 'video' ? 'Video Call' : 'Voice Call'}
        </Text>
      </View>

      {/* Encryption indicator */}
      <View style={styles.encryptionBadge}>
        <Icon name="lock-closed" size={12} color={COLORS.success} />
        <Text style={styles.encryptionText}>End-to-end encrypted</Text>
      </View>

      {/* Controls */}
      <View style={styles.controlsContainer}>
        <View style={styles.controls}>
          {/* Mute button */}
          <TouchableOpacity 
            style={[styles.controlButton, isMuted && styles.controlButtonActive]}
            onPress={() => setIsMuted(!isMuted)}
          >
            <Icon 
              name={isMuted ? "mic-off" : "mic"} 
              size={28} 
              color={COLORS.textPrimary} 
            />
          </TouchableOpacity>

          {/* End call button */}
          <TouchableOpacity 
            style={styles.endCallButton} 
            onPress={handleEndCall}
            activeOpacity={0.8}
          >
            <Icon name="call" size={32} color={COLORS.textPrimary} style={{ transform: [{ rotate: '135deg' }] }} />
          </TouchableOpacity>

          {/* Video toggle (only for video calls) */}
          {type === 'video' && (
            <TouchableOpacity 
              style={[styles.controlButton, isVideoOff && styles.controlButtonActive]}
              onPress={() => setIsVideoOff(!isVideoOff)}
            >
              <Icon 
                name={isVideoOff ? "videocam-off" : "videocam"} 
                size={28} 
                color={COLORS.textPrimary} 
              />
            </TouchableOpacity>
          )}

          {/* Speaker button (for voice calls) */}
          {type === 'audio' && (
            <TouchableOpacity style={styles.controlButton}>
              <Icon name="volume-high" size={28} color={COLORS.textPrimary} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: COLORS.bgPrimary, 
    justifyContent: 'center', 
    alignItems: 'center',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: SPACING.lg,
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.glow,
  },
  avatarText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  pulseRing: {
    position: 'absolute',
    top: -10,
    left: -10,
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 3,
    borderColor: COLORS.primary,
    opacity: 0.3,
  },
  callerName: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  status: { 
    fontSize: FONT_SIZES.lg, 
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  callTypeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.xl,
  },
  callType: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
  },
  encryptionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: `${COLORS.success}15`,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: `${COLORS.success}30`,
    marginBottom: SPACING.xxl,
  },
  encryptionText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success,
  },
  controlsContainer: {
    position: 'absolute',
    bottom: SPACING.xxl + SPACING.xl,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  controls: { 
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${COLORS.bgCard}cc`,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.xl,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  controlButton: { 
    width: 56, 
    height: 56, 
    borderRadius: 28, 
    backgroundColor: COLORS.bgCardHover, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginHorizontal: SPACING.sm,
  },
  controlButtonActive: {
    backgroundColor: COLORS.danger,
  },
  endCallButton: { 
    width: 64, 
    height: 64, 
    borderRadius: 32, 
    backgroundColor: COLORS.danger, 
    justifyContent: 'center', 
    alignItems: 'center',
    marginHorizontal: SPACING.md,
    ...SHADOWS.glow,
  },
});
