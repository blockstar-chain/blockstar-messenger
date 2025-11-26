import React, { useEffect, useState } from 'react';
import { View, FlatList, TouchableOpacity, Text, StyleSheet, RefreshControl } from 'react-native';
import { useChatStore } from '../store/chatStore';
import Icon from 'react-native-vector-icons/Ionicons';

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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Chats</Text>
        <TouchableOpacity onPress={() => navigation.navigate('CreateGroup')}>
          <Icon name="add-circle" size={32} color="#3b82f6" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={conversations}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.chatItem}
            onPress={() => navigation.navigate('Chat', { conversationId: item.id })}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.name?.[0] || '?'}</Text>
            </View>
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
        )}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  chatItem: { flexDirection: 'row', padding: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  avatar: { width: 50, height: 50, borderRadius: 25, backgroundColor: '#3b82f6', justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 20, color: '#fff', fontWeight: 'bold' },
  chatInfo: { flex: 1, marginLeft: 12 },
  chatName: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 4 },
  lastMessage: { fontSize: 14, color: '#888' },
  badge: { backgroundColor: '#3b82f6', borderRadius: 12, minWidth: 24, height: 24, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 8 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
});
