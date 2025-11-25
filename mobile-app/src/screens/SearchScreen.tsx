import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useNavigation } from '@react-navigation/native';

interface SearchResult {
  id: string;
  type: 'user' | 'message' | 'group';
  title: string;
  subtitle: string;
}

export default function SearchScreen() {
  const navigation = useNavigation<any>();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);

  const handleSearch = (text: string) => {
    setQuery(text);
    
    if (text.length > 0) {
      // Simulate search results
      setResults([
        { id: '1', type: 'user', title: '@alice', subtitle: 'Alice Johnson' },
        { id: '2', type: 'user', title: '@bob', subtitle: 'Bob Smith' },
        { id: '3', type: 'message', title: 'Meeting tomorrow', subtitle: 'In conversation with @alice' },
        { id: '4', type: 'group', title: 'Team Alpha', subtitle: '12 members' },
      ].filter(r => 
        r.title.toLowerCase().includes(text.toLowerCase()) ||
        r.subtitle.toLowerCase().includes(text.toLowerCase())
      ));
    } else {
      setResults([]);
    }
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'user': return 'person';
      case 'message': return 'chatbubble';
      case 'group': return 'people';
      default: return 'search';
    }
  };

  const renderResult = ({ item }: { item: SearchResult }) => (
    <TouchableOpacity style={styles.resultItem}>
      <View style={[styles.resultIcon, item.type === 'group' && styles.groupIcon]}>
        <Icon name={getIcon(item.type)} size={20} color="#fff" />
      </View>
      <View style={styles.resultInfo}>
        <Text style={styles.resultTitle}>{item.title}</Text>
        <Text style={styles.resultSubtitle}>{item.subtitle}</Text>
      </View>
      <Icon name="chevron-forward" size={20} color="#9ca3af" />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()}>
          <Icon name="arrow-back" size={24} color="#1f2937" />
        </TouchableOpacity>
        <View style={styles.searchContainer}>
          <Icon name="search" size={20} color="#9ca3af" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search users, messages, groups..."
            value={query}
            onChangeText={handleSearch}
            autoFocus
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => handleSearch('')}>
              <Icon name="close-circle" size={20} color="#9ca3af" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {query.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="search" size={64} color="#d1d5db" />
          <Text style={styles.emptyText}>Search for users, messages, or groups</Text>
        </View>
      ) : results.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="search-outline" size={64} color="#d1d5db" />
          <Text style={styles.emptyText}>No results found</Text>
        </View>
      ) : (
        <FlatList
          data={results}
          renderItem={renderResult}
          keyExtractor={item => item.id}
          contentContainerStyle={styles.resultsList}
        />
      )}
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
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 50,
    paddingBottom: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e7eb',
  },
  searchContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f3f4f6',
    marginLeft: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 8,
    fontSize: 16,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: '#6b7280',
    marginTop: 16,
  },
  resultsList: {
    padding: 16,
  },
  resultItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 8,
  },
  resultIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#0ea5e9',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  groupIcon: {
    backgroundColor: '#8b5cf6',
  },
  resultInfo: {
    flex: 1,
  },
  resultTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1f2937',
  },
  resultSubtitle: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 2,
  },
});
