// mobile/src/screens/AuthScreen.tsx
// BlockStar Cypher - Authentication Screen (Dark Midnight Theme)

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
  Alert,
  TextInput,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../store/authStore';
import { webSocketService } from '../services/WebSocketService';
import { storageService } from '../services/StorageService';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, SHADOWS } from '../constants/theme';

const API_URL = 'http://192.168.1.100:3001'; // CHANGE THIS TO YOUR SERVER IP

export function AuthScreen({ navigation }: any) {
  const [loading, setLoading] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const { setUser, setToken } = useAuthStore();

  // Simple demo login (for development in Expo Go)
  const connectDemo = async () => {
    setLoading(true);
    try {
      // Generate demo wallet address if not provided
      const demoAddress = walletAddress || `0x${Math.random().toString(16).slice(2, 42)}`;
      
      console.log('✅ Demo login:', demoAddress);

      // Create demo user
      const demoUser = {
        walletAddress: demoAddress,
        username: `User${demoAddress.slice(2, 6)}`,
        publicKey: 'demo-public-key',
      };

      // Generate demo token
      const demoToken = `demo-token-${Date.now()}`;

      // Save auth data
      setToken(demoToken);
      setUser(demoUser);
      await storageService.setAuthToken(demoToken);
      await storageService.setUser(demoUser);

      // Connect WebSocket (will fail if server not running, but that's OK for UI testing)
      try {
        await webSocketService.connect(demoToken);
      } catch (error) {
        console.log('⚠️ WebSocket connection failed (server may not be running)');
      }

      Alert.alert('Success', 'Connected in demo mode!');
      
      // Navigate to main app
      navigation.replace('Main');
    } catch (error: any) {
      console.error('Auth error:', error);
      Alert.alert('Error', error.message || 'Failed to connect');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {/* Logo */}
      <View style={styles.logoContainer}>
        <LinearGradient
          colors={[COLORS.primary, COLORS.cyan]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.logo}
        >
          <Text style={styles.logoText}>B★</Text>
        </LinearGradient>
        <Text style={styles.title}>BlockStar Cypher</Text>
        <Text style={styles.subtitle}>Decentralized Communication</Text>
      </View>

      {/* Features */}
      <View style={styles.features}>
        <FeatureItem icon="🔐" text="End-to-End Encrypted" />
        <FeatureItem icon="🌐" text="Web3 Identity" />
        <FeatureItem icon="📞" text="Voice & Video Calls" />
        <FeatureItem icon="📡" text="Mesh Networking" />
      </View>

      {/* Demo Mode Notice */}
      <View style={styles.demoNotice}>
        <Text style={styles.demoTitle}>📱 Demo Mode (Expo Go)</Text>
        <Text style={styles.demoText}>
          WalletConnect requires a production build.{'\n'}
          Use demo mode to test the UI!
        </Text>
      </View>

      {/* Optional Wallet Address Input */}
      <TextInput
        style={styles.input}
        placeholder="Wallet Address (optional)"
        placeholderTextColor={COLORS.textMuted}
        value={walletAddress}
        onChangeText={setWalletAddress}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {/* Connect Button */}
      <TouchableOpacity
        style={[styles.buttonContainer, loading && styles.buttonDisabled]}
        onPress={connectDemo}
        disabled={loading}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={[COLORS.primary, COLORS.cyan]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.button}
        >
          {loading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={styles.buttonText}>Enter Demo Mode</Text>
          )}
        </LinearGradient>
      </TouchableOpacity>

      {/* Info */}
      <Text style={styles.infoText}>
        For production wallet support, use EAS Build
      </Text>

      {/* Version */}
      <Text style={styles.versionText}>
        BlockStar Cypher v1.0.0 · BlockStar Mainnet
      </Text>
    </View>
  );
}

function FeatureItem({ icon, text }: { icon: string; text: string }) {
  return (
    <View style={styles.featureItem}>
      <Text style={styles.featureIcon}>{icon}</Text>
      <Text style={styles.featureText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: SPACING.xxl,
  },
  logo: {
    width: 100,
    height: 100,
    borderRadius: BORDER_RADIUS.xl,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.lg,
    ...SHADOWS.glow,
  },
  logoText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  title: {
    fontSize: FONT_SIZES.xxxl,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
  },
  features: {
    width: '100%',
    marginBottom: SPACING.xl,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.md,
    paddingHorizontal: SPACING.lg,
  },
  featureIcon: {
    fontSize: 24,
    marginRight: SPACING.sm + 4,
  },
  featureText: {
    fontSize: FONT_SIZES.md,
    color: COLORS.textSecondary,
  },
  demoNotice: {
    backgroundColor: COLORS.bgCard,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.lg,
    width: '100%',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  demoTitle: {
    fontSize: FONT_SIZES.md,
    fontWeight: 'bold',
    color: COLORS.primary,
    marginBottom: SPACING.xs,
    textAlign: 'center',
  },
  demoText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
  },
  input: {
    width: '100%',
    backgroundColor: COLORS.bgCard,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 4,
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.sm,
    marginBottom: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  buttonContainer: {
    width: '100%',
    marginBottom: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
  },
  button: {
    paddingHorizontal: SPACING.xxl,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    ...SHADOWS.glow,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
  },
  infoText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
  versionText: {
    position: 'absolute',
    bottom: SPACING.xl,
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    textAlign: 'center',
  },
});
