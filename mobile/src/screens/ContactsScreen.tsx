import React from 'react';
import { View, FlatList, Text, TouchableOpacity, StyleSheet } from 'react-native';

export function ContactsScreen({ navigation }: any) {
  const contacts = [];
  
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Contacts</Text>
      </View>
      <FlatList
        data={contacts}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.contactItem}>
            <Text style={styles.contactName}>{item.name}</Text>
          </TouchableOpacity>
        )}
        keyExtractor={(item: any) => item.id}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  header: { padding: 20, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  headerTitle: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
  contactItem: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#1a1a1a' },
  contactName: { fontSize: 16, color: '#fff' },
});
