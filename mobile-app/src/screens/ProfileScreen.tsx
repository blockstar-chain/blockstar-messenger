import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useNavigation, useRoute } from '@react-navigation/native';

export default function ProfileScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { userId, name } = route.params || { userId: '1', name: '@user' };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color="#1f2937" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Profile</Text>
        <TouchableOpacity>
          <Icon name="ellipsis-horizontal" size={24} color="#1f2937" />
        </TouchableOpacity>
      </View>

      <View style={styles.profileSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.slice(1, 3).toUpperCase()}</Text>
        </View>
        <Text style={styles.name}>{name}</Text>
        <Text style={styles.bio}>Blockchain enthusiast | Web3 Developer</Text>
        
        <View style={styles.actions}>
          <TouchableOpacity 
            style={styles.actionButton}
            onPress={() => navigation.navigate('Chat', { chatId: userId, name })}
          >
            <Icon name="chatbubble" size={22} color="#fff" />
            <Text style={styles.actionText}>Message</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.actionButton, styles.secondaryButton]}
            onPress={() => navigation.navigate('Call', { type: 'audio', name })}
          >
            <Icon name="call" size={22} color="#0ea5e9" />
            <Text style={[styles.actionText, styles.secondaryText]}>Call</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Info</Text>
        <View style={styles.infoItem}>
          <Icon name="wallet-outline" size={20} color="#6b7280" />
          <Text style={styles.infoLabel}>Wallet</Text>
          <Text style={styles.infoValue}>0x1234...5678</Text>
        </View>
        <View style={styles.infoItem}>
          <Icon name="calendar-outline" size={20} color="#6b7280" />
          <Text style={styles.infoLabel}>Joined</Text>
          <Text style={styles.infoValue}>January 2024</Text>
        </View>
        <View style={styles.infoItem}>
          <Icon name="shield-checkmark-outline" size={20} color="#6b7280" />
          <Text style={styles.infoLabel}>Verified</Text>
          <Icon name="checkmark-circle" size={20} color="#22c55e" />
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Shared Media</Text>
        <View style={styles.mediaGrid}>
          <View style={styles.mediaItem}>
            <Icon name="images-outline" size={32} color="#d1d5db" />
          </View>
          <View style={styles.mediaItem}>
            <Icon name="images-outline" size={32} color="#d1d5db" />
          </View>
          <View style={styles.mediaItem}>
            <Icon name="images-outline" size={32} color="#d1d5db" />
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <TouchableOpacity style={styles.dangerButton}>
          <Icon name="ban-outline" size={20} color="#ef4444" />
          <Text style={styles.dangerText}>Block User</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.dangerButton}>
          <Icon name="flag-outline" size={20} color="#ef4444" />
          <Text style={styles.dangerText}>Report User</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: '#fff',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1f2937',
  },
  profileSection: {
    alignItems: 'center',
    paddingVertical: 24,
    backgroundColor: '#fff',
    marginBottom: 16,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#0ea5e9',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  avatarText: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '600',
  },
  name: {
    fontSize: 24,
    fontWeight: '600',
    color: '#1f2937',
    marginBottom: 4,
  },
  bio: {
    fontSize: 14,
    color: '#6b7280',
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0ea5e9',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 10,
  },
  secondaryButton: {
    backgroundColor: '#eff6ff',
  },
  actionText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  secondaryText: {
    color: '#0ea5e9',
  },
  section: {
    backgroundColor: '#fff',
    marginBottom: 16,
    paddingVertical: 16,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6b7280',
    paddingHorizontal: 16,
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  infoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  infoLabel: {
    flex: 1,
    fontSize: 16,
    color: '#1f2937',
    marginLeft: 12,
  },
  infoValue: {
    fontSize: 14,
    color: '#6b7280',
  },
  mediaGrid: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 8,
  },
  mediaItem: {
    width: 100,
    height: 100,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dangerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  dangerText: {
    fontSize: 16,
    color: '#ef4444',
    marginLeft: 12,
  },
});
