import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import Toast from 'react-native-toast-message';
import { useAuthStore } from '../store/authStore';

export default function AuthScreen() {
  const [isConnecting, setIsConnecting] = useState(false);
  const { setUser, setAuthenticated } = useAuthStore();

  const handleConnect = async () => {
    setIsConnecting(true);
    
    try {
      // In production, use WalletConnect or similar
      // For now, simulate connection
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Simulated user for development
      const user = {
        walletAddress: '0x1234...5678',
        username: '@devuser',
        publicKey: 'mock-public-key',
      };
      
      setUser(user);
      setAuthenticated(true);
      
      Toast.show({
        type: 'success',
        text1: 'Connected!',
        text2: `Welcome, ${user.username}`,
      });
    } catch (error: any) {
      Toast.show({
        type: 'error',
        text1: 'Connection Failed',
        text2: error.message || 'Please try again',
      });
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <View style={styles.logoCircle}>
          <Text style={styles.logoText}>B</Text>
        </View>
        <Text style={styles.title}>BlockStar Messenger</Text>
        <Text style={styles.subtitle}>Secure, Decentralized Communication</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Connect Your Wallet</Text>
        
        <View style={styles.features}>
          <FeatureItem icon="🔗" title="Connect Wallet" description="Link your Web3 wallet" />
          <FeatureItem icon="✓" title="Verify NFT" description="Confirm your @name ownership" />
          <FeatureItem icon="🔒" title="E2E Encryption" description="Military-grade security" />
        </View>

        <TouchableOpacity
          style={[styles.button, isConnecting && styles.buttonDisabled]}
          onPress={handleConnect}
          disabled={isConnecting}
        >
          {isConnecting ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Connect Wallet</Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function FeatureItem({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <View style={styles.featureItem}>
      <Text style={styles.featureIcon}>{icon}</Text>
      <View style={styles.featureText}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureDesc}>{description}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0ea5e9',
    padding: 20,
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  logoText: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#0ea5e9',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: 'rgba(255,255,255,0.8)',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 5,
  },
  cardTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#1f2937',
    textAlign: 'center',
    marginBottom: 24,
  },
  features: {
    marginBottom: 24,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  featureIcon: {
    fontSize: 24,
    marginRight: 12,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
  featureDesc: {
    fontSize: 14,
    color: '#6b7280',
  },
  button: {
    backgroundColor: '#0ea5e9',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
});
