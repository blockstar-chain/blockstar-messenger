// mobile/src/screens/SettingsScreen.tsx
// BlockStar Cypher - Settings Screen (Dark Midnight Theme)

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { useAuthStore } from '../store/authStore';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, SHADOWS } from '../constants/theme';

export function SettingsScreen({ navigation }: any) {
  const { user, logout } = useAuthStore();

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <LinearGradient
            colors={[COLORS.primary, COLORS.cyan]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.headerIcon}
          >
            <Icon name="settings" size={18} color={COLORS.textPrimary} />
          </LinearGradient>
          <Text style={styles.headerTitle}>Settings</Text>
        </View>
      </View>

      {/* Profile Section */}
      <View style={styles.profileSection}>
        <LinearGradient
          colors={[COLORS.primary, COLORS.cyan]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.profileAvatar}
        >
          <Text style={styles.profileAvatarText}>
            {user?.username?.[0]?.toUpperCase() || 'U'}
          </Text>
        </LinearGradient>
        <View style={styles.profileInfo}>
          <Text style={styles.profileName}>{user?.username || 'Unknown'}</Text>
          <Text style={styles.profileAddress}>
            {user?.walletAddress?.slice(0, 6)}...{user?.walletAddress?.slice(-4)}
          </Text>
          <View style={styles.nftBadge}>
            <Icon name="diamond" size={12} color={COLORS.primary} />
            <Text style={styles.nftBadgeText}>NFT Domain</Text>
          </View>
        </View>
      </View>

      {/* Settings Items */}
      <View style={styles.section}>
        <SettingItem
          icon="person"
          text="Profile"
          onPress={() => navigation.navigate('Profile')}
        />
        <SettingItem
          icon="git-network"
          text="Mesh Network"
          onPress={() => navigation.navigate('MeshNetwork')}
        />
        <SettingItem
          icon="notifications"
          text="Notifications"
        />
        <SettingItem
          icon="lock-closed"
          text="Privacy & Security"
        />
        <SettingItem
          icon="cloud"
          text="Data & Storage"
        />
      </View>

      {/* Encryption Status */}
      <View style={styles.encryptionCard}>
        <View style={styles.encryptionHeader}>
          <Icon name="shield-checkmark" size={24} color={COLORS.success} />
          <Text style={styles.encryptionTitle}>End-to-End Encryption</Text>
        </View>
        <Text style={styles.encryptionStatus}>ACTIVE</Text>
      </View>

      {/* About Section */}
      <View style={styles.section}>
        <SettingItem
          icon="information-circle"
          text="About"
        />
      </View>

      {/* Network Info */}
      <View style={styles.infoCard}>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Version</Text>
          <Text style={styles.infoValue}>1.0.0</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Network</Text>
          <Text style={[styles.infoValue, { color: COLORS.primary }]}>BlockStar Mainnet</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Chain ID</Text>
          <Text style={[styles.infoValue, styles.monoText]}>0x1588</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={logout} activeOpacity={0.8}>
        <Icon name="log-out-outline" size={20} color={COLORS.textPrimary} />
        <Text style={styles.logoutText}>Logout</Text>
      </TouchableOpacity>

      <Text style={styles.footerText}>
        BlockStar Cypher - Decentralized Web3 Messaging
      </Text>
    </ScrollView>
  );
}

function SettingItem({ icon, text, onPress }: any) {
  return (
    <TouchableOpacity
      style={styles.settingItem}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.settingIconContainer}>
        <Icon name={icon} size={22} color={COLORS.textPrimary} />
      </View>
      <Text style={styles.settingText}>{text}</Text>
      <Icon name="chevron-forward" size={20} color={COLORS.textMuted} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bgPrimary,
  },
  header: {
    padding: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    backgroundColor: COLORS.bgSecondary,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  headerIcon: {
    width: 32,
    height: 32,
    borderRadius: BORDER_RADIUS.sm,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  profileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.lg,
    backgroundColor: COLORS.bgCard,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  profileAvatar: {
    width: 60,
    height: 60,
    borderRadius: 30,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.glow,
  },
  profileAvatarText: {
    fontSize: FONT_SIZES.xxl,
    fontWeight: 'bold',
    color: COLORS.textPrimary,
  },
  profileInfo: {
    marginLeft: SPACING.md,
    flex: 1,
  },
  profileName: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  profileAddress: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  nftBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: `${COLORS.primary}20`,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.full,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: `${COLORS.primary}30`,
  },
  nftBadgeText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.primary,
    fontWeight: '500',
  },
  section: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.bgCard,
    marginHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  settingItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  settingIconContainer: {
    width: 36,
    height: 36,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.bgCardHover,
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingText: {
    flex: 1,
    fontSize: FONT_SIZES.md,
    color: COLORS.textPrimary,
    marginLeft: SPACING.sm + 4,
  },
  encryptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: SPACING.md,
    backgroundColor: `${COLORS.success}15`,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: `${COLORS.success}30`,
  },
  encryptionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  encryptionTitle: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.success,
    fontWeight: '500',
  },
  encryptionStatus: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.success,
    fontWeight: 'bold',
    backgroundColor: `${COLORS.success}20`,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderRadius: BORDER_RADIUS.sm,
  },
  infoCard: {
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    padding: SPACING.md,
    backgroundColor: COLORS.bgCard,
    borderRadius: BORDER_RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: SPACING.xs + 2,
  },
  infoLabel: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
  },
  infoValue: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textPrimary,
  },
  monoText: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: SPACING.sm,
    margin: SPACING.lg,
    padding: SPACING.md,
    backgroundColor: COLORS.danger,
    borderRadius: BORDER_RADIUS.md,
  },
  logoutText: {
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  footerText: {
    fontSize: FONT_SIZES.xs,
    color: COLORS.textMuted,
    textAlign: 'center',
    marginBottom: SPACING.xxl,
  },
});
