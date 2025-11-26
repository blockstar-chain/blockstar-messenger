import React, { useState, useEffect } from 'react';
import { View, FlatList, TextInput, TouchableOpacity, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { useChatStore } from '../store/chatStore';

export function ChatScreen({ route, navigation }: any) {
  const { conversationId } = route.params;
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    // Set navigation options
    navigation.setOptions({
      headerShown: true,
      headerStyle: { backgroundColor: '#000' },
      headerTintColor: '#fff',
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginLeft: 16 }}>
          <Icon name="arrow-back" size={24} color="#fff" />
        </TouchableOpacity>
      ),
      headerTitle: 'Chat',
      headerRight: () => (
        <View style={{ flexDirection: 'row', marginRight: 16 }}>
          <TouchableOpacity 
            onPress={() => navigation.navigate('Call', { conversationId, type: 'audio' })} 
            style={{ marginRight: 16 }}
          >
            <Icon name="call" size={24} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Call', { conversationId, type: 'video' })}>
            <Icon name="videocam" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, conversationId]);

  const handleSend = () => {
    if (message.trim()) {
      // Send message logic here
      setMessage('');
    }
  };

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={messages}
        renderItem={({ item }) => (
          <View style={styles.messageBubble}>
            <Text style={styles.messageText}>{item.content}</Text>
          </View>
        )}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={styles.messagesList}
      />
      
      <View style={styles.inputContainer}>
        <TouchableOpacity style={styles.attachButton}>
          <Icon name="add-circle" size={28} color="#3b82f6" />
        </TouchableOpacity>
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder="Type a message..."
          placeholderTextColor="#666"
          onSubmitEditing={handleSend}
        />
        <TouchableOpacity style={styles.sendButton} onPress={handleSend}>
          <Icon name="send" size={24} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  messagesList: { padding: 16 },
  messageBubble: { backgroundColor: '#3b82f6', padding: 12, borderRadius: 16, marginBottom: 8, maxWidth: '80%', alignSelf: 'flex-end' },
  messageText: { color: '#fff', fontSize: 16 },
  inputContainer: { flexDirection: 'row', padding: 12, borderTopWidth: 1, borderTopColor: '#1a1a1a', alignItems: 'center' },
  attachButton: { marginRight: 8 },
  input: { flex: 1, backgroundColor: '#1a1a1a', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, color: '#fff', marginRight: 8 },
  sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#3b82f6', justifyContent: 'center', alignItems: 'center' },
});
