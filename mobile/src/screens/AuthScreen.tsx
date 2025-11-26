// mobile/src/screens/AuthScreen.tsx
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
import { useAuthStore } from '../store/authStore';
import { webSocketService } from '../services/WebSocketService';
import { storageService } from '../services/StorageService';

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
        <View style={styles.logo}>
          <Text style={styles.logoText}>B★</Text>
        </View>
        <Text style={styles.title}>BlockStar Messenger</Text>
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
        placeholderTextColor="#666"
        value={walletAddress}
        onChangeText={setWalletAddress}
        autoCapitalize="none"
        autoCorrect={false}
      />

      {/* Connect Button */}
      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={connectDemo}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" size="small" />
        ) : (
          <Text style={styles.buttonText}>Enter Demo Mode</Text>
        )}
      </TouchableOpacity>

      {/* Info */}
      <Text style={styles.infoText}>
        For production wallet support, use EAS Build
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
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#3b82f6',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  logoText: {
    fontSize: 48,
    fontWeight: 'bold',
    color: '#fff',
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
  },
  features: {
    width: '100%',
    marginBottom: 30,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 20,
  },
  featureIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  featureText: {
    fontSize: 16,
    color: '#ccc',
  },
  demoNotice: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    width: '100%',
    borderWidth: 1,
    borderColor: '#333',
  },
  demoTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#3b82f6',
    marginBottom: 8,
    textAlign: 'center',
  },
  demoText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    lineHeight: 20,
  },
  input: {
    width: '100%',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#333',
  },
  button: {
    backgroundColor: '#3b82f6',
    paddingHorizontal: 60,
    paddingVertical: 16,
    borderRadius: 12,
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  infoText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
});
