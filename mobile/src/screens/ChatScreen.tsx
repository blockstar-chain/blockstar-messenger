// mobile/src/screens/ChatScreen.tsx
// BlockStar Cypher - Chat Screen (Dark Midnight Theme)

import React, { useState, useEffect } from 'react';
import { View, FlatList, TextInput, TouchableOpacity, Text, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { useChatStore } from '../store/chatStore';
import { COLORS, SPACING, BORDER_RADIUS, FONT_SIZES, SHADOWS } from '../constants/theme';

export function ChatScreen({ route, navigation }: any) {
  const { conversationId } = route.params;
  const [message, setMessage] = useState('');
  const [messages, setMessages] = useState<any[]>([]);

  useEffect(() => {
    // Set navigation options
    navigation.setOptions({
      headerShown: true,
      headerStyle: { 
        backgroundColor: COLORS.bgSecondary,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.border,
        elevation: 0,
        shadowOpacity: 0,
      },
      headerTintColor: COLORS.textPrimary,
      headerLeft: () => (
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginLeft: SPACING.md }}>
          <Icon name="arrow-back" size={24} color={COLORS.textPrimary} />
        </TouchableOpacity>
      ),
      headerTitle: 'Chat',
      headerRight: () => (
        <View style={{ flexDirection: 'row', marginRight: SPACING.md, gap: SPACING.md }}>
          <TouchableOpacity 
            onPress={() => navigation.navigate('Call', { conversationId, type: 'audio' })} 
          >
            <Icon name="call" size={24} color={COLORS.textSecondary} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Call', { conversationId, type: 'video' })}>
            <Icon name="videocam" size={24} color={COLORS.textSecondary} />
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

  const renderMessage = ({ item }: any) => {
    const isSender = item.isSender !== false; // Default to sent
    
    return (
      <View style={[
        styles.messageContainer,
        isSender ? styles.messageContainerSent : styles.messageContainerReceived
      ]}>
        {isSender ? (
          <LinearGradient
            colors={[COLORS.primary, COLORS.primaryDark]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.messageBubbleSent}
          >
            <Text style={styles.messageText}>{item.content}</Text>
            <View style={styles.messageFooter}>
              <Text style={styles.messageTime}>{item.time || '12:00 PM'}</Text>
              <Icon 
                name={item.read ? "checkmark-done" : "checkmark"} 
                size={14} 
                color={item.read ? COLORS.cyan : 'rgba(255,255,255,0.6)'} 
              />
            </View>
          </LinearGradient>
        ) : (
          <View style={styles.messageBubbleReceived}>
            <Text style={styles.messageTextReceived}>{item.content}</Text>
            <Text style={styles.messageTimeReceived}>{item.time || '12:00 PM'}</Text>
          </View>
        )}
      </View>
    );
  };

  const renderEmptyChat = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.encryptionBadge}>
        <Icon name="lock-closed" size={14} color={COLORS.success} />
        <Text style={styles.encryptionText}>Messages are end-to-end encrypted</Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item: any) => item.id}
        contentContainerStyle={[
          styles.messagesList,
          messages.length === 0 && styles.emptyList
        ]}
        ListEmptyComponent={renderEmptyChat}
        inverted={messages.length > 0}
      />
      
      <View style={styles.inputContainer}>
        <TouchableOpacity style={styles.attachButton}>
          <Icon name="add-circle" size={28} color={COLORS.primary} />
        </TouchableOpacity>
        
        <TouchableOpacity style={styles.emojiButton}>
          <Icon name="happy-outline" size={24} color={COLORS.textSecondary} />
        </TouchableOpacity>
        
        <TextInput
          style={styles.input}
          value={message}
          onChangeText={setMessage}
          placeholder="Type a message..."
          placeholderTextColor={COLORS.textMuted}
          onSubmitEditing={handleSend}
          multiline
          maxLength={5000}
        />
        
        <TouchableOpacity style={styles.micButton}>
          <Icon name="mic-outline" size={24} color={COLORS.textSecondary} />
        </TouchableOpacity>
        
        <TouchableOpacity onPress={handleSend} activeOpacity={0.8}>
          <LinearGradient
            colors={[COLORS.primary, COLORS.cyan]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.sendButton}
          >
            <Icon name="send" size={20} color={COLORS.textPrimary} />
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { 
    flex: 1, 
    backgroundColor: COLORS.bgPrimary,
  },
  messagesList: { 
    padding: SPACING.md,
  },
  emptyList: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  encryptionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: `${COLORS.success}15`,
    borderWidth: 1,
    borderColor: `${COLORS.success}30`,
    paddingVertical: SPACING.xs + 2,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.full,
    gap: SPACING.xs,
  },
  encryptionText: {
    color: COLORS.success,
    fontSize: FONT_SIZES.xs,
  },
  messageContainer: {
    marginBottom: SPACING.sm,
    maxWidth: '80%',
  },
  messageContainerSent: {
    alignSelf: 'flex-end',
  },
  messageContainerReceived: {
    alignSelf: 'flex-start',
  },
  messageBubbleSent: { 
    padding: SPACING.sm + 4, 
    borderRadius: BORDER_RADIUS.lg,
    borderBottomRightRadius: SPACING.xs,
  },
  messageBubbleReceived: { 
    backgroundColor: COLORS.bgCard, 
    padding: SPACING.sm + 4, 
    borderRadius: BORDER_RADIUS.lg,
    borderBottomLeftRadius: SPACING.xs,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  messageText: { 
    color: COLORS.textPrimary, 
    fontSize: FONT_SIZES.md,
  },
  messageTextReceived: { 
    color: COLORS.textPrimary, 
    fontSize: FONT_SIZES.md,
  },
  messageFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginTop: SPACING.xs,
    gap: SPACING.xs,
  },
  messageTime: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: FONT_SIZES.xs,
  },
  messageTimeReceived: {
    color: COLORS.textMuted,
    fontSize: FONT_SIZES.xs,
    marginTop: SPACING.xs,
    textAlign: 'right',
  },
  inputContainer: { 
    flexDirection: 'row', 
    padding: SPACING.sm + 4, 
    borderTopWidth: 1, 
    borderTopColor: COLORS.border, 
    alignItems: 'flex-end',
    backgroundColor: COLORS.bgSecondary,
    gap: SPACING.sm,
  },
  attachButton: { 
    padding: SPACING.xs,
  },
  emojiButton: {
    padding: SPACING.xs,
  },
  micButton: {
    padding: SPACING.xs,
  },
  input: { 
    flex: 1, 
    backgroundColor: COLORS.bgCard, 
    borderRadius: BORDER_RADIUS.lg, 
    paddingHorizontal: SPACING.md, 
    paddingVertical: SPACING.sm + 2, 
    color: COLORS.textPrimary,
    fontSize: FONT_SIZES.md,
    maxHeight: 100,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sendButton: { 
    width: 44, 
    height: 44, 
    borderRadius: BORDER_RADIUS.md, 
    justifyContent: 'center', 
    alignItems: 'center',
    ...SHADOWS.glow,
  },
});
