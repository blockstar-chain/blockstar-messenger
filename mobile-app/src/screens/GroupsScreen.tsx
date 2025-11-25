import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

interface Group {
  id: string;
  name: string;
  members: number;
  lastMessage: string;
  timestamp: number;
}

export default function GroupsScreen() {
  const [groups, setGroups] = useState<Group[]>([
    {
      id: '1',
      name: 'Team Alpha',
      members: 12,
      lastMessage: 'Meeting at 3pm',
      timestamp: Date.now() - 1800000,
    },
    {
      id: '2',
      name: 'Project Crypto',
      members: 8,
      lastMessage: 'Great work everyone!',
      timestamp: Date.now() - 7200000,
    },
  ]);

  const formatTime = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
    return new Date(timestamp).toLocaleDateString();
  };

  const renderGroup = ({ item }: { item: Group }) => (
    <TouchableOpacity style={styles.groupItem}>
      <View style={styles.groupAvatar}>
        <Icon name="people" size={24} color="#fff" />
      </View>
      <View style={styles.groupInfo}>
        <View style={styles.groupHeader}>
          <Text style={styles.groupName}>{item.name}</Text>
          <Text style={styles.groupTime}>{formatTime(item.timestamp)}</Text>
        </View>
        <Text style={styles.groupMembers}>{item.members} members</Text>
        <Text style={styles.groupMessage} numberOfLines={1}>
          {item.lastMessage}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Groups</Text>
        <TouchableOpacity>
          <Icon name="add-circle" size={28} color="#0ea5e9" />
        </TouchableOpacity>
      </View>

      <FlatList
        data={groups}
        renderItem={renderGroup}
        keyExtractor={item => item.id}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Icon name="people-outline" size={64} color="#d1d5db" />
            <Text style={styles.emptyText}>No groups yet</Text>
            <TouchableOpacity style={styles.createButton}>
              <Text style={styles.createButtonText}>Create a Group</Text>
            </TouchableOpacity>
          </View>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 20,
    backgroundColor: '#fff',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#1f2937',
  },
  groupItem: {
    flexDirection: 'row',
    padding: 16,
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginTop: 8,
    borderRadius: 12,
  },
  groupAvatar: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: '#8b5cf6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  groupInfo: {
    flex: 1,
  },
  groupHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  groupName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
  groupTime: {
    fontSize: 12,
    color: '#9ca3af',
  },
  groupMembers: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  groupMessage: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingTop: 100,
  },
  emptyText: {
    fontSize: 18,
    color: '#6b7280',
    marginTop: 16,
    marginBottom: 24,
  },
  createButton: {
    backgroundColor: '#0ea5e9',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  createButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
