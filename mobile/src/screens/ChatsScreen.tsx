// mobile/src/screens/ChatsScreen.tsx
// BlockStar Cypher - Chats List Screen (Dark Midnight Theme)

import React, { useEffect, useState } from 'react';
import { View, FlatList, TouchableOpacity, Text, StyleSheet, RefreshControl } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useChatStore } from '../store/chatStore';
import Icon from 'react-native-vector-icons/Ionicons';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, SHADOWS } from '../constants/theme';

export function ChatsScreen({ navigation }: any) {
  const { conversations, loadConversations } = useChatStore();
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    loadConversations();
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadConversations();
    setRefreshing(false);
  };

  const renderChatItem = ({ item }: any) => (
    <TouchableOpacity
      style={styles.chatItem}
      onPress={() => navigation.navigate('Chat', { conversationId: item.id })}
      activeOpacity={0.7}
    >
      <LinearGradient
        colors={[COLORS.primary, COLORS.cyan]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.avatar}
      >
        <Text style={styles.avatarText}>{item.name?.[0]?.toUpperCase() || '?'}</Text>
      </LinearGradient>
      <View style={styles.chatInfo}>
        <Text style={styles.chatName}>{item.name || 'Unknown'}</Text>
        <Text style={styles.lastMessage} numberOfLines={1}>
          {item.lastMessage || 'No messages yet'}
        </Text>
      </View>
      {item.unreadCount > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{item.unreadCount}</Text>
        </View>
      )}
    </TouchableOpacity>
  );

  const renderEmptyList = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIcon}>
        <Icon name="chatbubbles-outline" size={48} color={COLORS.border} />
      </View>
      <Text style={styles.emptyTitle}>No conversations yet</Text>
      <Text style={styles.emptyText}>Start a new chat to begin messaging</Text>
      <TouchableOpacity
        style={styles.newChatButton}
        onPress={() => navigation.navigate('CreateGroup')}
        activeOpacity={0.8}
      >
        <LinearGradient
          colors={[COLORS.primary, COLORS.cyan]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.newChatButtonGradient}
        >
          <Icon name="add" size={20} color={COLORS.textPrimary} />
          <Text style={styles.newChatButtonText}>New Chat</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <LinearGradient
            colors={[COLORS.primary, COLORS.cyan]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.headerIcon}
          >
            <Icon name="chatbubbles" size={18} color={COLORS.textPrimary} />
          </LinearGradient>
          <Text style={styles.headerTitle}>Messages</Text>
        </View>
        <TouchableOpacity 
          onPress={() => navigation.navigate('CreateGroup')}
          style={styles.addButton}
        >
          <Icon name="add-circle" size={32} color={COLORS.primary} />
        </TouchableOpacity>
      </View>

      <FlatList
        data={conversations}
        renderItem={renderChatItem}
        keyExtractor={(item) => item.id}
        refreshControl={
          <RefreshControl 
            refreshing={refreshing} 
            onRefresh={handleRefresh}
            tintColor={COLORS.primary}
            colors={[COLORS.primary]}
          />
        }
        ListEmptyComponent={renderEmptyList}
        contentContainerStyle={conversations.length === 0 ? styles.emptyList : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: COLORS.bgPrimary,
  },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
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
  addButton: {
    padding: SPACING.xs,
  },
  chatItem: { 
    flexDirection: 'row', 
    padding: SPACING.md, 
    borderBottomWidth: 1, 
    borderBottomColor: COLORS.border,
    alignItems: 'center',
  },
  avatar: { 
    width: 50, 
    height: 50, 
    borderRadius: 25, 
    justifyContent: 'center', 
    alignItems: 'center',
  },
  avatarText: { 
    fontSize: FONT_SIZES.xl, 
    color: COLORS.textPrimary, 
    fontWeight: 'bold',
  },
  chatInfo: { 
    flex: 1, 
    marginLeft: SPACING.sm + 4,
  },
  chatName: { 
    fontSize: FONT_SIZES.md, 
    fontWeight: '600', 
    color: COLORS.textPrimary, 
    marginBottom: SPACING.xs,
  },
  lastMessage: { 
    fontSize: FONT_SIZES.sm, 
    color: COLORS.textSecondary,
  },
  badge: { 
    backgroundColor: COLORS.primary, 
    borderRadius: BORDER_RADIUS.full, 
    minWidth: 24, 
    height: 24, 
    justifyContent: 'center', 
    alignItems: 'center', 
    paddingHorizontal: SPACING.sm,
  },
  badgeText: { 
    color: COLORS.textPrimary, 
    fontSize: FONT_SIZES.xs, 
    fontWeight: 'bold',
  },
  emptyList: {
    flexGrow: 1,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: BORDER_RADIUS.lg,
    backgroundColor: COLORS.bgCard,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  emptyTitle: {
    fontSize: FONT_SIZES.lg,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  emptyText: {
    fontSize: FONT_SIZES.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  newChatButton: {
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
  },
  newChatButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.sm + 4,
    paddingHorizontal: SPACING.lg,
  },
  newChatButtonText: {
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
    fontWeight: '600',
  },
});
