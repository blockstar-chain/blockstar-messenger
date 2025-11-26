import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useAuthStore } from '../store/authStore';

export function SettingsScreen({ navigation }: any) {
  const { user, logout } = useAuthStore();
  
  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Settings</Text>
      </View>
      
      <SettingItem icon="person" text="Profile" onPress={() => navigation.navigate('Profile')} />
      <SettingItem icon="git-network" text="Mesh Network" onPress={() => navigation.navigate('MeshNetwork')} />
      <SettingItem icon="notifications" text="Notifications" />
      <SettingItem icon="lock-closed" text="Privacy & Security" />
      <SettingItem icon="cloud" text="Data & Storage" />
      <SettingItem icon="information-circle" text="About" />
      
      <TouchableOpacity style={styles.logoutButton} onPress={logout}>
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function SettingItem({ icon, text, onPress }: any) {
  return (
    <TouchableOpacity style={styles.settingItem} onPress={onPress}>
      <Icon name={icon} size={24} color="#fff" />
      <Text style={styles.settingText}>{text}</Text>
      <Icon name="chevron-forward" size={24} color="#666" />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { padding: 20, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  settingItem: { flexDirection: 'row', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  settingText: { flex: 1, fontSize: 16, color: '#fff', marginLeft: 16 },
  logoutButton: { margin: 20, padding: 16, backgroundColor: '#ef4444', borderRadius: 8, alignItems: 'center' },
  logoutText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});
