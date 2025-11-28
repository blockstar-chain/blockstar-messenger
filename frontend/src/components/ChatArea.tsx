import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAppStore } from '@/store';
import { db, dbHelpers } from '@/lib/database';
import { webSocketService } from '@/lib/websocket';
import { webRTCService } from '@/lib/webrtc';
import { encryptionService } from '@/lib/encryption';
import { voiceMessageService } from '@/lib/voice-message-service';
import { Message } from '@/types';
import { Send, Phone, Video, MoreVertical, Menu, Paperclip, Mic, MicOff, Lock, Search, X, Bell, BellOff, Smile, Check, CheckCheck, Trash2, Shield, MessageSquare, Users, RefreshCw } from 'lucide-react';
import { generateMessageId, generateConversationId, formatMessageTime, truncateAddress, getInitials, getAvatarColor } from '@/utils/helpers';
import { resolveProfile, type BlockStarProfile } from '@/lib/profileResolver';
import toast from 'react-hot-toast';
import EmojiPicker from './EmojiPicker';

// Store for decrypted message content (in-memory + localStorage cache)
const decryptedContentCache = new Map<string, string>();

// Load decrypted content cache from localStorage on startup
const DECRYPTED_CACHE_KEY = 'blockstar_decrypted_cache';
try {
  const storedCache = localStorage.getItem(DECRYPTED_CACHE_KEY);
  if (storedCache) {
    const parsed = JSON.parse(storedCache);
    Object.entries(parsed).forEach(([key, value]) => {
      decryptedContentCache.set(key, value as string);
    });
    console.log('📝 Loaded', decryptedContentCache.size, 'cached decrypted messages');
  }
} catch (e) {
  console.warn('Failed to load decrypted cache:', e);
}

// Save decrypted content to both in-memory and localStorage
const saveDecryptedContent = (messageId: string, content: string) => {
  decryptedContentCache.set(messageId, content);
  
  // Persist to localStorage (limit to last 500 messages to prevent bloat)
  try {
    const cacheObj: Record<string, string> = {};
    const entries = Array.from(decryptedContentCache.entries());
    // Keep only the last 500 entries
    const recentEntries = entries.slice(-500);
    recentEntries.forEach(([k, v]) => {
      cacheObj[k] = v;
    });
    localStorage.setItem(DECRYPTED_CACHE_KEY, JSON.stringify(cacheObj));
  } catch (e) {
    // localStorage might be full, just use in-memory
    console.warn('Failed to persist decrypted cache:', e);
  }
};

// Helper function to render text with clickable links
const renderTextWithLinks = (text: string): React.ReactNode => {
  // URL regex pattern that matches http, https, and www links
  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
  
  const parts = text.split(urlRegex);
  const matches = text.match(urlRegex) || [];
  
  if (matches.length === 0) {
    return text;
  }
  
  const result: React.ReactNode[] = [];
  let matchIndex = 0;
  
  parts.forEach((part, index) => {
    if (part) {
      // Check if this part is a URL
      if (urlRegex.test(part)) {
        urlRegex.lastIndex = 0; // Reset regex
        let href = part;
        // Add protocol if missing (for www. links)
        if (href.startsWith('www.')) {
          href = 'https://' + href;
        }
        result.push(
          <a
            key={`link-${index}`}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:opacity-80 transition break-all"
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        );
      } else {
        result.push(<span key={`text-${index}`}>{part}</span>);
      }
    }
  });
  
  return result;
};

export default function ChatArea() {
  const {
    currentUser,
    activeConversationId,
    conversations,
    messages,
    setMessages,
    addMessage,
    toggleSidebar,
    setActiveCall,
    setCallModalOpen,
  } = useAppStore();

  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [userStatuses, setUserStatuses] = useState<Map<string, string>>(new Map());
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [readMessageIds, setReadMessageIds] = useState<Set<string>>(new Set());
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [showMessageMenu, setShowMessageMenu] = useState(false);
  const [messageMenuPosition, setMessageMenuPosition] = useState({ x: 0, y: 0 });
  const [contactProfile, setContactProfile] = useState<BlockStarProfile | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingDuration, setRecordingDuration] = useState(0);
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const messageMenuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const conversationMessages = activeConversationId ? messages.get(activeConversationId) || [] : [];
  
  const filteredMessages = searchQuery 
    ? conversationMessages.filter(msg => 
        msg.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversationMessages;
  const isGroupChat = activeConversation?.type === 'group' || 
                      (activeConversation?.participants && activeConversation.participants.length > 2) ||
                      !!(activeConversation as any)?.groupName;
  const groupConv = activeConversation as any; // Type assertion for group properties
  const otherParticipant = !isGroupChat ? activeConversation?.participants.find(
    (p) => p.toLowerCase() !== currentUser?.walletAddress.toLowerCase()
  )?.toLowerCase() : null;

  const getStatus = (address: string) => {
    const status = userStatuses.get(address.toLowerCase());
    return status || 'offline';
  };

  // Cleanup recording on conversation change or unmount
  useEffect(() => {
    return () => {
      if (isRecording) {
        voiceMessageService.cancelRecording();
        if (recordingIntervalRef.current) {
          clearInterval(recordingIntervalRef.current);
        }
      }
    };
  }, [activeConversationId, isRecording]);

  // Fetch user status
  useEffect(() => {
    if (otherParticipant) {
      const fetchStatus = async () => {
        try {
          const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
          const response = await fetch(`${API_URL}/api/users/${otherParticipant.toLowerCase()}/status`);
          if (response.ok) {
            const data = await response.json();
            const status = data.isOnline ? 'online' : 'offline';
            setUserStatuses((prev) => {
              const newMap = new Map(prev);
              newMap.set(otherParticipant.toLowerCase(), status);
              return newMap;
            });
          }
        } catch (error) {
          setUserStatuses((prev) => {
            const newMap = new Map(prev);
            newMap.set(otherParticipant.toLowerCase(), 'offline');
            return newMap;
          });
        }
      };
      fetchStatus();
      const interval = setInterval(fetchStatus, 30000);
      return () => clearInterval(interval);
    }
  }, [otherParticipant]);

  // Load contact profile
  useEffect(() => {
    const loadContactProfile = async () => {
      if (!otherParticipant) {
        setContactProfile(null);
        return;
      }
      
      try {
        const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
        const response = await fetch(`${API_URL}/api/profile/${otherParticipant}`);
        
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.profile?.nftName) {
            const profile = await resolveProfile(data.profile.nftName);
            setContactProfile(profile);
            return;
          }
        }
        
        setContactProfile(null);
      } catch (error) {
        setContactProfile(null);
      }
    };
    
    loadContactProfile();
  }, [otherParticipant]);

  useEffect(() => {
    if (activeConversationId) {
      // Always fetch fresh data when switching conversations to ensure read states are accurate
      loadMessages(true);
    }
  }, [activeConversationId]);

  useEffect(() => {
    scrollToBottom();
  }, [conversationMessages]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowChatMenu(false);
      }
      if (messageMenuRef.current && !messageMenuRef.current.contains(event.target as Node)) {
        setShowMessageMenu(false);
        setSelectedMessageId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (activeConversationId) {
      const mutedConvos = JSON.parse(localStorage.getItem('mutedConversations') || '[]');
      setIsMuted(mutedConvos.includes(activeConversationId));
      setSearchMode(false);
      setSearchQuery('');
    }
  }, [activeConversationId]);

  useEffect(() => {
    const unsubscribe = webSocketService.onStatus((data) => {
      const address = data.address.toLowerCase();
      const prevStatus = userStatuses.get(address);
      
      setUserStatuses((prev) => {
        const newMap = new Map(prev);
        newMap.set(address, data.status);
        return newMap;
      });
      
      // When user comes online, clear their key cache so we can refetch
      if (data.status === 'online' && prevStatus !== 'online') {
        encryptionService.clearKeyCache(address);
        console.log('🔑 User came online, cleared key cache for', address);
      }
    });
    return () => unsubscribe();
  }, [userStatuses]);

  // Listen for incoming messages
  useEffect(() => {
    const unsubscribe = webSocketService.onMessage(async (message) => {
      try {
        // Skip if we've already processed this message
        if (decryptedContentCache.has(message.id)) {
          console.log('Skipping already processed message:', message.id);
          return;
        }
        
        // Skip messages we sent ourselves (they're already in our store)
        if (message.senderId.toLowerCase() === currentUser?.walletAddress.toLowerCase()) {
          console.log('Skipping own message:', message.id);
          // Don't cache encrypted content - we'll decrypt it when loading
          return;
        }

        let displayContent = message.content;
        
        // Only try to decrypt text messages, not voice/file messages
        if (message.type === 'text' || !message.type) {
          try {
            // For received messages, use sender's public key
            const { decrypted, wasEncrypted, decryptionFailed } = await encryptionService.decryptFromSender(
              message.content,
              message.senderId
            );
            displayContent = decrypted;
            if (!decryptionFailed) {
              saveDecryptedContent(message.id, displayContent);
            }
          } catch (decryptError) {
            console.warn('Decryption failed, showing placeholder:', decryptError);
            displayContent = '🔒 [Unable to decrypt message]';
          }
        } else {
          saveDecryptedContent(message.id, displayContent);
        }
        
        const senderId = message.senderId.toLowerCase();
        const recipientId = (typeof message.recipientId === 'string' 
          ? message.recipientId 
          : message.recipientId[0]).toLowerCase();
        
        const conversationId = message.conversationId || generateConversationId(senderId, recipientId);
        
        const displayMessage: Message = { 
          ...message, 
          content: displayContent,
          conversationId,
          senderId,
          recipientId,
          delivered: true,
          type: message.type || 'text', // Explicitly preserve message type
        };
        
        await dbHelpers.saveMessage(displayMessage);
        
        const { conversations, addConversation } = useAppStore.getState();
        const convExists = conversations.some(c => c.id === conversationId);
        
        if (!convExists) {
          const newConv = {
            id: conversationId,
            type: 'direct' as const,
            participants: [senderId, recipientId],
            unreadCount: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            lastMessage: displayMessage,
          };
          
          await db.conversations.put(newConv);
          addConversation(newConv);
        }
        
        addMessage(displayMessage);
        webSocketService.markDelivered(message.id);
      } catch (error) {
        console.error('Error processing message:', error);
      }
    });

    return () => unsubscribe();
  }, [currentUser, addMessage]);

  // Listen for delivery confirmations
  useEffect(() => {
    const unsubscribe = webSocketService.on('message:delivered', (data: { messageId: string; deliveredTo: string; deliveredAt: number }) => {
      if (activeConversationId) {
        const msgs = messages.get(activeConversationId);
        if (msgs) {
          const updatedMsgs = msgs.map(msg => 
            msg.id === data.messageId ? { ...msg, delivered: true } : msg
          );
          setMessages(activeConversationId, updatedMsgs);
          db.messages.update(data.messageId, { delivered: true }).catch(console.error);
        }
      }
    });
    return () => unsubscribe();
  }, [activeConversationId, messages, setMessages]);

  const loadMessages = async (forceRefresh: boolean = false) => {
    if (!activeConversationId || !currentUser?.walletAddress) return;

    try {
      const myAddress = currentUser.walletAddress.toLowerCase();
      
      // Clear cache if force refresh requested
      if (forceRefresh) {
        dbHelpers.clearMessageCache(activeConversationId);
      }
      
      let msgs = await dbHelpers.getConversationMessages(activeConversationId);
      
      // Process read states for all messages based on readBy array
      // This works whether messages came from cache or fresh API fetch
      msgs = msgs.map(msg => {
        const msgWithReadBy = msg as Message & { readBy?: string[] };
        const readBy = msgWithReadBy.readBy || [];
        const isMySentMessage = msg.senderId.toLowerCase() === myAddress;
        
        let isRead = false;
        if (isMySentMessage) {
          // My outgoing message - check if recipient (anyone other than me) has read it
          isRead = readBy.some((r: string) => r.toLowerCase() !== myAddress);
        } else {
          // Incoming message - check if I've already read it
          isRead = readBy.some((r: string) => r.toLowerCase() === myAddress);
        }
        
        return { ...msg, read: isRead };
      });
      
      // Try to decrypt messages
      // In ECDH, the shared secret is derived from your private key + other party's public key
      // So for BOTH sent and received messages, we need the OTHER participant's public key
      for (const msg of msgs) {
        if (!decryptedContentCache.has(msg.id) && (msg.type === 'text' || !msg.type)) {
          try {
            // Determine the other party's address for key derivation
            const isMySentMessage = msg.senderId.toLowerCase() === myAddress;
            // Handle recipientId being string or string[]
            const recipientAddr = Array.isArray(msg.recipientId) 
              ? msg.recipientId[0] 
              : msg.recipientId;
            const otherPartyAddress = isMySentMessage 
              ? recipientAddr  // For sent messages, use recipient's key
              : msg.senderId;  // For received messages, use sender's key
            
            if (!otherPartyAddress) {
              console.warn('Cannot decrypt: no other party address for message', msg.id);
              continue;
            }
            
            const { decrypted, wasEncrypted, decryptionFailed } = await encryptionService.decryptFromSender(
              msg.content,
              otherPartyAddress
            );
            if (wasEncrypted) {
              msg.content = decrypted;
              if (!decryptionFailed) {
                saveDecryptedContent(msg.id, decrypted);
              }
            }
          } catch {}
        } else if (decryptedContentCache.has(msg.id)) {
          msg.content = decryptedContentCache.get(msg.id)!;
        }
      }
      
      // Update cache with processed messages
      for (const msg of msgs) {
        await dbHelpers.saveMessage(msg);
      }
      
      setMessages(activeConversationId, msgs);
    } catch (error) {
      console.error('Error loading messages:', error);
    }
  };

  const handleToggleSearch = () => {
    setSearchMode(!searchMode);
    setSearchQuery('');
    setShowChatMenu(false);
  };

  const handleToggleMute = () => {
    if (!activeConversationId) return;
    
    const mutedConvos = JSON.parse(localStorage.getItem('mutedConversations') || '[]');
    const newMuted = !isMuted;
    
    if (newMuted) {
      mutedConvos.push(activeConversationId);
      toast.success('Notifications muted for this chat');
    } else {
      const index = mutedConvos.indexOf(activeConversationId);
      if (index > -1) mutedConvos.splice(index, 1);
      toast.success('Notifications unmuted for this chat');
    }
    
    localStorage.setItem('mutedConversations', JSON.stringify(mutedConvos));
    setIsMuted(newMuted);
    setShowChatMenu(false);
  };

  const handleClearChat = async () => {
    if (!activeConversationId) return;
    
    if (confirm('Are you sure you want to clear all messages in this chat?')) {
      try {
        await db.messages.where('conversationId').equals(activeConversationId).delete();
        setMessages(activeConversationId, []);
        toast.success('Chat cleared!');
      } catch (error) {
        toast.error('Failed to clear chat');
      }
    }
    setShowChatMenu(false);
  };

  const handleRetryDecryption = async () => {
    if (!activeConversationId) return;
    
    // Check if this is a group chat
    const isGroup = isGroupChat || 
                    (activeConversation?.participants && activeConversation.participants.length > 2) ||
                    !!(activeConversation as any)?.groupName;
    
    if (isGroup) {
      // For groups, clear key cache for all participants except self
      const myAddress = currentUser?.walletAddress.toLowerCase();
      activeConversation?.participants.forEach(participant => {
        if (participant.toLowerCase() !== myAddress) {
          encryptionService.clearKeyCache(participant);
        }
      });
    } else if (otherParticipant) {
      // For direct chats, clear key cache for the other participant
      encryptionService.clearKeyCache(otherParticipant);
    }
    
    // Clear decrypted content cache for this conversation
    const msgs = messages.get(activeConversationId) || [];
    msgs.forEach(msg => decryptedContentCache.delete(msg.id));
    
    // Clear the message cache to force refetch from server
    dbHelpers.clearMessageCache(activeConversationId);
    
    // Reload messages
    toast.loading('Retrying decryption...', { id: 'retry-decrypt' });
    await loadMessages();
    toast.success('Decryption retried!', { id: 'retry-decrypt' });
    
    setShowChatMenu(false);
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!activeConversationId) return;
    
    try {
      // Delete from local database
      await db.messages.delete(messageId);
      
      // Update UI immediately
      const msgs = messages.get(activeConversationId) || [];
      const updatedMsgs = msgs.filter(m => m.id !== messageId);
      setMessages(activeConversationId, updatedMsgs);
      decryptedContentCache.delete(messageId);
      
      // Sync deletion to server
      const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      try {
        await fetch(`${API_URL}/api/messages/${messageId}`, {
          method: 'DELETE',
        });
      } catch (syncError) {
        console.warn('Could not sync message deletion to server:', syncError);
      }
      
      toast.success('Message deleted');
    } catch (error) {
      toast.error('Failed to delete message');
    }
    
    setShowMessageMenu(false);
    setSelectedMessageId(null);
  };

  const handleMessageContextMenu = (e: React.MouseEvent, messageId: string, isSender: boolean) => {
    e.preventDefault();
    if (!isSender) return;
    
    setSelectedMessageId(messageId);
    setMessageMenuPosition({ x: e.clientX, y: e.clientY });
    setShowMessageMenu(true);
  };

  // Voice recording handlers
  const handleVoiceRecordToggle = async () => {
    if (isRecording) {
      // Stop recording
      try {
        const voiceMessage = await voiceMessageService.stopRecording();
        
        // Clear recording timer
        if (recordingIntervalRef.current) {
          clearInterval(recordingIntervalRef.current);
          recordingIntervalRef.current = null;
        }
        setIsRecording(false);
        setRecordingDuration(0);
        
        // Upload voice message as file
        const file = await voiceMessageService.voiceMessageToFile(voiceMessage);
        await uploadVoiceMessage(file, voiceMessage.duration);
        
      } catch (error) {
        console.error('Error stopping recording:', error);
        toast.error('Failed to save voice message');
        setIsRecording(false);
        setRecordingDuration(0);
      }
    } else {
      // Start recording
      try {
        await voiceMessageService.startRecording();
        setIsRecording(true);
        setRecordingDuration(0);
        
        // Start duration timer
        recordingIntervalRef.current = setInterval(() => {
          setRecordingDuration(prev => prev + 1);
        }, 1000);
        
        toast.success('Recording started...', { duration: 1500 });
      } catch (error) {
        console.error('Error starting recording:', error);
        toast.error('Failed to access microphone');
      }
    }
  };

  const handleCancelRecording = () => {
    voiceMessageService.cancelRecording();
    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current);
      recordingIntervalRef.current = null;
    }
    setIsRecording(false);
    setRecordingDuration(0);
    toast('Recording cancelled', { icon: '🗑️' });
  };

  const uploadVoiceMessage = async (file: File, duration: number) => {
    if (!currentUser || !activeConversationId) return;
    
    // Check if this is a group chat
    const isGroup = isGroupChat || 
                    (activeConversation?.participants && activeConversation.participants.length > 2) ||
                    !!(activeConversation as any)?.groupName;
    
    // For direct chats, require otherParticipant
    if (!isGroup && !otherParticipant) return;
    
    setIsSending(true);
    const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
    
    try {
      // Upload file to server
      const formData = new FormData();
      formData.append('file', file);
      formData.append('senderWallet', currentUser.walletAddress);
      formData.append('conversationId', activeConversationId);
      
      const uploadResponse = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });
      
      if (!uploadResponse.ok) throw new Error('Upload failed');
      
      const { file: uploadedFile } = await uploadResponse.json();
      
      console.log('Voice file uploaded:', uploadedFile);
      
      // Create message content with file info
      const content = JSON.stringify({
        type: 'voice',
        fileId: uploadedFile.id,
        filename: uploadedFile.filename,
        url: uploadedFile.url,
        duration: duration,
      });
      
      const messageId = generateMessageId();
      const senderId = currentUser.walletAddress.toLowerCase();
      
      if (isGroup) {
        // Group chat voice message
        const recipients = activeConversation?.participants.filter(
          p => p.toLowerCase() !== senderId
        ) || [];
        
        const message: Message = {
          id: messageId,
          conversationId: activeConversationId,
          senderId,
          recipientId: recipients,
          content: content,
          timestamp: Date.now(),
          type: 'voice',
          delivered: false,
          read: false,
        };
        
        await dbHelpers.saveMessage(message);
        addMessage(message);
        saveDecryptedContent(messageId, content);
        
        // Send to group
        webSocketService.emit('group:message', {
          groupId: activeConversationId,
          message,
          recipients,
        });
      } else {
        // Direct chat voice message
        const message: Message = {
          id: messageId,
          conversationId: activeConversationId,
          senderId,
          recipientId: otherParticipant!,
          content: content,
          timestamp: Date.now(),
          type: 'voice',
          delivered: false,
          read: false,
        };
        
        await dbHelpers.saveMessage(message);
        addMessage(message);
        saveDecryptedContent(messageId, content);
        webSocketService.sendMessage(message);
      }
      
      toast.success('Voice message sent!');
    } catch (error) {
      console.error('Error sending voice message:', error);
      toast.error('Failed to send voice message');
    } finally {
      setIsSending(false);
    }
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleEmojiSelect = (emoji: string) => {
    setMessageText((prev) => prev + emoji);
    setShowEmojiPicker(false);
    inputRef.current?.focus();
  };

  const markMessagesAsRead = useCallback((messageIds: string[]) => {
    if (!currentUser) return;
    
    const unreadIds = messageIds.filter(id => !readMessageIds.has(id));
    if (unreadIds.length === 0) return;
    
    console.log('📖 Marking messages as read:', unreadIds);
    
    unreadIds.forEach(messageId => {
      webSocketService.markRead(messageId);
    });
    
    setReadMessageIds(prev => {
      const newSet = new Set(prev);
      unreadIds.forEach(id => newSet.add(id));
      return newSet;
    });
  }, [currentUser, readMessageIds]);

  useEffect(() => {
    if (!currentUser || !activeConversationId) return;
    
    const unreadMessages = conversationMessages.filter(
      msg => msg.senderId.toLowerCase() !== currentUser.walletAddress.toLowerCase() && !msg.read
    );
    
    if (unreadMessages.length > 0) {
      const timer = setTimeout(() => {
        markMessagesAsRead(unreadMessages.map(msg => msg.id));
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [activeConversationId, conversationMessages, currentUser, markMessagesAsRead]);

  useEffect(() => {
    const unsubscribe = webSocketService.on('message:read', (data: { messageId: string; readBy: string; readAt: number }) => {
      console.log('📖 Received read receipt:', data);
      
      // Update in database cache first (works across all conversations)
      // Pass the reader's address so readBy array is updated
      dbHelpers.updateMessageRead(data.messageId, data.readBy);
      
      if (activeConversationId) {
        const msgs = messages.get(activeConversationId);
        if (msgs) {
          const messageToUpdate = msgs.find(m => m.id === data.messageId);
          if (messageToUpdate) {
            console.log('📖 Marking message as read in UI:', data.messageId);
            const updatedMsgs = msgs.map(msg => {
              if (msg.id === data.messageId) {
                // Update both read flag and readBy array
                const msgAny = msg as any;
                const readBy = msgAny.readBy || [];
                if (!readBy.includes(data.readBy.toLowerCase())) {
                  readBy.push(data.readBy.toLowerCase());
                }
                return { ...msg, read: true, readBy };
              }
              return msg;
            });
            setMessages(activeConversationId, updatedMsgs);
          } else {
            // Message might be in a different conversation or not loaded yet
            // The cache was already updated above, so when we switch conversations
            // or reload messages, they will have the correct read state
            console.log('📖 Message not in current view (cached for later):', data.messageId);
          }
        }
      }
    });
    return () => unsubscribe();
  }, [activeConversationId, messages, setMessages]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 10MB');
      return;
    }

    if (!currentUser || !activeConversationId) {
      toast.error('Please select a conversation first');
      return;
    }
    
    // Check if this is a group chat
    const isGroup = isGroupChat || 
                    (activeConversation?.participants && activeConversation.participants.length > 2) ||
                    !!(activeConversation as any)?.groupName;
    
    // For direct chats, require otherParticipant
    if (!isGroup && !otherParticipant) {
      toast.error('Please select a conversation first');
      return;
    }

    setIsSending(true);
    const loadingToast = toast.loading(`Uploading ${file.name}...`);

    try {
      const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) throw new Error('Upload failed');

      const data = await response.json();
      
      const senderId = currentUser.walletAddress.toLowerCase();

      let messageType: Message['type'] = 'file';
      if (file.type.startsWith('image/')) messageType = 'image';
      else if (file.type.startsWith('video/')) messageType = 'video';
      else if (file.type.startsWith('audio/')) messageType = 'audio';

      const fileInfo = JSON.stringify({
        url: data.file.url,
        filename: data.file.filename,
        mimetype: data.file.mimetype,
        size: data.file.size,
      });

      const messageId = generateMessageId();
      
      if (isGroup) {
        // Group chat file upload
        const recipients = activeConversation?.participants.filter(
          p => p.toLowerCase() !== senderId
        ) || [];
        
        const message: Message = {
          id: messageId,
          conversationId: activeConversationId,
          senderId,
          recipientId: recipients,
          content: fileInfo,
          timestamp: Date.now(),
          delivered: false,
          read: false,
          type: messageType,
        };

        saveDecryptedContent(messageId, fileInfo);
        await dbHelpers.saveMessage(message);
        addMessage(message);

        // Send to group
        webSocketService.emit('group:message', {
          groupId: activeConversationId,
          message,
          recipients,
        });
      } else {
        // Direct chat file upload
        const recipientId = otherParticipant!.toLowerCase();
        
        const message: Message = {
          id: messageId,
          conversationId: activeConversationId,
          senderId,
          recipientId,
          content: fileInfo,
          timestamp: Date.now(),
          delivered: false,
          read: false,
          type: messageType,
        };

        saveDecryptedContent(messageId, fileInfo);
        await dbHelpers.saveMessage(message);
        addMessage(message);
        webSocketService.sendMessage(message);
      }

      toast.dismiss(loadingToast);
      toast.success('File sent!');
    } catch (error) {
      toast.dismiss(loadingToast);
      toast.error('Failed to upload file');
    } finally {
      setIsSending(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!messageText.trim() || !currentUser || !activeConversationId) {
      console.log('❌ Send blocked - missing:', { 
        text: !!messageText.trim(), 
        user: !!currentUser, 
        convId: !!activeConversationId 
      });
      return;
    }
    
    // Determine if this is a group chat - check type or fall back to participant count
    const isGroup = activeConversation?.type === 'group' || 
                    (activeConversation?.participants && activeConversation.participants.length > 2) ||
                    !!(activeConversation as any)?.groupName;
    
    console.log('📤 Sending message:', { 
      isGroup, 
      type: activeConversation?.type,
      participants: activeConversation?.participants?.length,
      groupName: (activeConversation as any)?.groupName,
      otherParticipant 
    });
    
    // For direct chats, require otherParticipant. For groups, we'll handle multiple recipients
    if (!isGroup && !otherParticipant) {
      console.log('❌ Send blocked - no recipient for direct chat');
      return;
    }

    setIsSending(true);
    const plainText = messageText.trim();

    try {
      const senderId = currentUser.walletAddress.toLowerCase();
      const messageId = generateMessageId();
      
      let messageContent = plainText;
      
      if (isGroup) {
        // Group chat: For now, send unencrypted (group encryption is complex)
        // In production, you'd use a shared group key
        const recipients = activeConversation?.participants.filter(
          p => p.toLowerCase() !== senderId
        ) || [];
        
        console.log('📢 Group message to recipients:', recipients);
        
        const message: Message = {
          id: messageId,
          conversationId: activeConversationId,
          senderId,
          recipientId: recipients,  // Array for group
          content: plainText,
          timestamp: Date.now(),
          delivered: false,
          read: false,
          type: 'text',
        };

        saveDecryptedContent(messageId, plainText);
        
        const localMessage = { ...message };
        await dbHelpers.saveMessage(localMessage);
        addMessage(localMessage);

        // Send to group
        webSocketService.emit('group:message', {
          groupId: activeConversationId,
          message,
          recipients,
        });
        
        console.log('✅ Group message sent');
      } else {
        // Direct chat: encrypt for recipient
        const recipientId = otherParticipant!.toLowerCase();
        const { encrypted, error } = await encryptionService.encryptForRecipient(plainText, recipientId);

        if (error) {
          toast.error(error, { duration: 3000 });
        }

        messageContent = encrypted || plainText;

        const message: Message = {
          id: messageId,
          conversationId: activeConversationId,
          senderId,
          recipientId,
          content: messageContent,
          timestamp: Date.now(),
          delivered: false,
          read: false,
          type: 'text',
        };

        saveDecryptedContent(messageId, plainText);

        const localMessage = { ...message, content: plainText };
        await dbHelpers.saveMessage(localMessage);
        addMessage(localMessage);

        webSocketService.sendMessage(message);
      }

      setMessageText('');
    } catch (error) {
      toast.error('Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const handleStartCall = async (type: 'audio' | 'video') => {
    if (!otherParticipant || !currentUser) return;

    try {
      console.log('========================================');
      console.log('INITIATING CALL');
      console.log('Call type:', type);
      console.log('To:', otherParticipant);
      console.log('========================================');
      
      toast.loading(`Starting ${type} call...`, { id: 'call-init' });
      
      const stream = await webRTCService.initializeLocalStream(type === 'audio');
      
      // Check audio tracks
      const audioTracks = stream.getAudioTracks();
      console.log('Local audio tracks:', audioTracks.length);
      audioTracks.forEach((t, i) => {
        console.log('Track ' + i + ':', { enabled: t.enabled, muted: t.muted, readyState: t.readyState });
      });
      
      if (audioTracks.length > 0 && audioTracks[0].muted) {
        toast.dismiss('call-init');
        toast.error('🎤 Your microphone is muted! Please unmute and try again.', { duration: 5000 });
        webRTCService.stopLocalStream();
        return;
      }
      
      const callId = `${currentUser.walletAddress.toLowerCase()}-${otherParticipant}-${Date.now()}`;
      console.log('Generated call ID:', callId);
      
      let offerSent = false;
      
      webRTCService.createCall(
        callId,
        type === 'audio',
        (signal) => {
          if (signal.type === 'offer' && !offerSent) {
            console.log('📤 Sending OFFER to:', otherParticipant);
            webSocketService.initiateCall(otherParticipant, type, signal, callId);
            offerSent = true;
          } else if (signal.candidate || signal.type === 'candidate') {
            console.log('📤 Sending ICE candidate');
            webSocketService.sendIceCandidate(otherParticipant, signal, callId);
          } else if (signal.type !== 'offer') {
            console.log('📤 Sending other signal:', signal.type);
            webSocketService.sendIceCandidate(otherParticipant, signal, callId);
          }
        },
        (candidate) => {
          console.log('📤 Sending ICE candidate (separate callback)');
          webSocketService.sendIceCandidate(otherParticipant, candidate, callId);
        }
      );

      const call = {
        id: callId,
        callerId: currentUser.walletAddress.toLowerCase(),
        recipientId: otherParticipant,
        recipientAddress: otherParticipant, // Keep for backwards compatibility
        type,
        status: 'calling' as const,
        startTime: Date.now(),
        localStream: stream,
      };

      toast.dismiss('call-init');
      setActiveCall(call);
      setCallModalOpen(true);
    } catch (error: any) {
      toast.dismiss('call-init');
      console.error('Call initiation error:', error);
      
      if (error.name === 'NotAllowedError') {
        toast.error('Please allow microphone/camera access');
      } else if (error.name === 'NotFoundError') {
        toast.error('No microphone/camera found');
      } else {
        toast.error('Failed to start call: ' + error.message);
      }
    }
  };

  // Empty state
  if (!activeConversationId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-midnight text-muted relative overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/3 left-1/3 w-96 h-96 bg-primary-500/5 rounded-full blur-3xl"></div>
          <div className="absolute bottom-1/3 right-1/3 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl"></div>
        </div>
        
        <div className="relative z-10 text-center">
          <div className="w-24 h-24 bg-card border border-midnight rounded-2xl flex items-center justify-center mb-6 mx-auto">
            <MessageSquare size={40} className="text-primary-500" />
          </div>
          <h3 className="text-xl font-semibold text-white mb-2">Welcome to BlockStar Cypher</h3>
          <p className="text-secondary max-w-sm">
            Select a conversation to start messaging or create a new chat.
          </p>
          <div className="mt-8 flex items-center justify-center gap-2 text-xs text-muted">
            <Shield size={14} className="text-success-500" />
            <span>End-to-end encrypted messaging</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-screen bg-midnight">
      {/* Chat Header */}
      <div className="bg-midnight-light border-b border-midnight p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSidebar}
              className="md:hidden p-2 hover:bg-dark-200 rounded-lg transition"
            >
              <Menu size={20} className="text-secondary" />
            </button>
            
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold overflow-hidden ${
              isGroupChat 
                ? 'bg-gradient-to-br from-purple-500/50 to-pink-500/50'
                : 'bg-gradient-to-br from-primary-500/50 to-cyan-500/50'
            }`}>
              {isGroupChat ? (
                <Users size={20} />
              ) : contactProfile?.avatar ? (
                <img 
                  src={contactProfile.avatar} 
                  alt={contactProfile.username || 'Avatar'} 
                  className="w-full h-full object-cover"
                />
              ) : (
                getInitials(contactProfile?.username || otherParticipant || '')
              )}
            </div>
            
            <div>
              {isGroupChat ? (
                <>
                  <h2 className="font-semibold text-white">{groupConv?.groupName || 'Group Chat'}</h2>
                  <p className="text-xs text-muted">{activeConversation?.participants.length} members</p>
                </>
              ) : contactProfile?.username ? (
                <>
                  <h2 className="font-semibold text-white">@{contactProfile.username}</h2>
                  <p className="text-xs text-muted">{truncateAddress(otherParticipant || '')}</p>
                </>
              ) : (
                <h2 className="font-semibold text-white">
                  {truncateAddress(otherParticipant || '')}
                </h2>
              )}
              <div className="flex items-center gap-2 text-sm">
                {!isGroupChat && (
                  <>
                    <span className={`w-2 h-2 rounded-full ${
                      getStatus(otherParticipant || '') === 'online' 
                        ? 'bg-success-500 shadow-glow-green' 
                        : 'bg-muted'
                    }`} />
                    <span className="text-secondary">
                      {getStatus(otherParticipant || '') === 'online' ? 'Online' : 'Offline'}
                    </span>
                    <span className="text-muted">•</span>
                  </>
                )}
                <span className="text-success-500 text-xs flex items-center gap-1">
                  <Lock size={10} />
                  E2E Encrypted
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => handleStartCall('audio')}
              className="p-2 hover:bg-dark-200 rounded-lg transition text-secondary hover:text-white"
              title="Voice call"
            >
              <Phone size={20} />
            </button>
            <button
              onClick={() => handleStartCall('video')}
              className="p-2 hover:bg-dark-200 rounded-lg transition text-secondary hover:text-white"
              title="Video call"
            >
              <Video size={20} />
            </button>
            
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowChatMenu(!showChatMenu)}
                className="p-2 hover:bg-dark-200 rounded-lg transition text-secondary hover:text-white"
              >
                <MoreVertical size={20} />
              </button>
              
              {showChatMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-card border border-midnight rounded-xl shadow-lg py-1 z-50">
                  <button
                    onClick={handleToggleSearch}
                    className="w-full px-4 py-2.5 text-left text-sm text-secondary hover:text-white hover:bg-dark-200 flex items-center gap-3 transition"
                  >
                    <Search size={16} />
                    {searchMode ? 'Close Search' : 'Search in Chat'}
                  </button>
                  <button
                    onClick={handleToggleMute}
                    className="w-full px-4 py-2.5 text-left text-sm text-secondary hover:text-white hover:bg-dark-200 flex items-center gap-3 transition"
                  >
                    {isMuted ? <Bell size={16} /> : <BellOff size={16} />}
                    {isMuted ? 'Unmute Notifications' : 'Mute Notifications'}
                  </button>
                  <button
                    onClick={handleRetryDecryption}
                    className="w-full px-4 py-2.5 text-left text-sm text-secondary hover:text-white hover:bg-dark-200 flex items-center gap-3 transition"
                  >
                    <RefreshCw size={16} />
                    Retry Decryption
                  </button>
                  <div className="border-t border-midnight my-1"></div>
                  <button
                    onClick={handleClearChat}
                    className="w-full px-4 py-2.5 text-left text-sm text-danger-500 hover:bg-danger-500/10 flex items-center gap-3 transition"
                  >
                    <X size={16} />
                    Clear Chat
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Search Bar */}
      {searchMode && (
        <div className="bg-midnight-light border-b border-midnight p-4">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2.5 bg-card border border-midnight rounded-xl text-white placeholder-muted focus:outline-none focus:border-primary-500 transition"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-secondary"
              >
                <X size={16} />
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="text-xs text-muted mt-2">
              Found {filteredMessages.length} message{filteredMessages.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-midnight">
        {/* Encryption notice */}
        <div className="flex justify-center mb-4">
          <div className="bg-success-500/10 border border-success-500/30 text-success-400 text-xs px-4 py-1.5 rounded-full flex items-center gap-2">
            <Lock size={12} />
            Messages are end-to-end encrypted
          </div>
        </div>

        {filteredMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted">
            <p>{searchQuery ? 'No messages found matching your search.' : 'No messages yet. Start the conversation!'}</p>
          </div>
        ) : (
          filteredMessages.map((message, index) => {
            const isSender = message.senderId.toLowerCase() === currentUser?.walletAddress.toLowerCase();
            const showAvatar = index === 0 || filteredMessages[index - 1].senderId !== message.senderId;

            let fileInfo: { url: string; filename: string; mimetype: string; size: number } | null = null;
            if (message.type && message.type !== 'text') {
              // Skip corrupted [object Object] content
              if (message.content !== '[object Object]') {
                try {
                  fileInfo = JSON.parse(message.content);
                } catch {}
              }
            }

            const renderMessageContent = () => {
              // Handle corrupted [object Object] content for file types
              if (message.type && message.type !== 'text' && message.content === '[object Object]') {
                return (
                  <div className="p-3 bg-red-500/20 rounded-lg">
                    <p className="text-sm opacity-70">
                      {message.type === 'image' ? '🖼️ Image unavailable' :
                       message.type === 'video' ? '🎥 Video unavailable' :
                       message.type === 'audio' ? '🔊 Audio unavailable' :
                       '📎 File unavailable'}
                    </p>
                  </div>
                );
              }
              
              // Helper to ensure URL uses HTTPS for non-localhost
              const ensureHttpsUrl = (url: string) => {
                if (!url) return url;
                // Fix localhost URLs
                if (url.includes('localhost:3001')) {
                  const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
                  const filename = url.split('/uploads/').pop();
                  return `${API_URL}/uploads/${filename}`;
                }
                // Force HTTPS for non-localhost
                if (!url.includes('localhost') && url.startsWith('http://')) {
                  return url.replace('http://', 'https://');
                }
                return url;
              };
              
              if (message.type === 'image' && fileInfo) {
                const imageUrl = ensureHttpsUrl(fileInfo.url);
                return (
                  <div className="max-w-xs">
                    <img 
                      src={imageUrl} 
                      alt={fileInfo.filename}
                      className="rounded-lg max-w-full cursor-pointer hover:opacity-90 transition"
                      onClick={() => window.open(imageUrl, '_blank')}
                    />
                    <p className="text-xs mt-1 opacity-70">{fileInfo.filename}</p>
                  </div>
                );
              }

              if (message.type === 'video' && fileInfo) {
                const videoUrl = ensureHttpsUrl(fileInfo.url);
                return (
                  <div className="max-w-xs">
                    <video src={videoUrl} controls className="rounded-lg max-w-full" />
                    <p className="text-xs mt-1 opacity-70">{fileInfo.filename}</p>
                  </div>
                );
              }

              if (message.type === 'audio' && fileInfo) {
                const audioFileUrl = ensureHttpsUrl(fileInfo.url);
                return (
                  <div className="min-w-[200px]">
                    <audio src={audioFileUrl} controls className="w-full" />
                    <p className="text-xs mt-1 opacity-70">{fileInfo.filename}</p>
                  </div>
                );
              }

              // Voice message type - check both type field and content format
              if (message.type === 'voice' || (message.content && message.content.startsWith && message.content.startsWith('{"type":"voice"'))) {
                let voiceInfo: { type: string; fileId: string; filename: string; url: string; duration: number } | null = null;
                
                // Handle corrupted data - [object Object] was stored instead of JSON string
                if (!message.content || message.content === '[object Object]') {
                  // Show placeholder for corrupted voice message
                  return (
                    <div className="min-w-[200px] p-3 bg-red-500/20 rounded-lg">
                      <div className="flex items-center gap-2">
                        <Mic size={16} className="opacity-50" />
                        <span className="text-sm opacity-70">Voice message unavailable</span>
                      </div>
                    </div>
                  );
                }
                
                try {
                  voiceInfo = JSON.parse(message.content);
                  // Verify it's actually a voice message
                  if (voiceInfo?.type !== 'voice') {
                    voiceInfo = null;
                  }
                } catch (parseError) {
                  // Content might be encrypted or malformed - don't log repeatedly
                  // console.warn('Failed to parse voice message JSON:', parseError);
                }
                
                if (voiceInfo && voiceInfo.url) {
                  const formatVoiceDuration = (seconds: number) => {
                    const mins = Math.floor(seconds / 60);
                    const secs = Math.floor(seconds % 60);
                    return `${mins}:${secs.toString().padStart(2, '0')}`;
                  };
                  
                  // Fix URL - ensure it uses the correct API URL with HTTPS
                  let audioUrl = voiceInfo.url;
                  const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
                  
                  // If URL contains localhost or is relative, fix it
                  if (audioUrl.includes('localhost:3001') || audioUrl.startsWith('/uploads/')) {
                    const filename = audioUrl.split('/uploads/').pop() || voiceInfo.filename;
                    audioUrl = `${API_URL}/uploads/${filename}`;
                  } else if (!audioUrl.startsWith('http') && !audioUrl.startsWith('blob:')) {
                    // Relative URL without /uploads/
                    audioUrl = `${API_URL}/uploads/${audioUrl}`;
                  }
                  
                  // Ensure HTTPS for non-localhost URLs
                  if (!audioUrl.includes('localhost') && audioUrl.startsWith('http://')) {
                    audioUrl = audioUrl.replace('http://', 'https://');
                  }
                  
                  return (
                    <div className="min-w-[220px] max-w-[280px]">
                      <div className="flex items-center gap-3 mb-2">
                        <div className={`p-2 rounded-full ${isSender ? 'bg-white/20' : 'bg-primary-500/20'}`}>
                          <Mic size={18} />
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium">Voice Message</p>
                          <p className="text-xs opacity-70">{formatVoiceDuration(voiceInfo.duration || 0)}</p>
                        </div>
                      </div>
                      <audio 
                        src={audioUrl} 
                        controls 
                        preload="auto"
                        className="w-full h-10" 
                        style={{ filter: isSender ? 'invert(1) hue-rotate(180deg)' : 'none' }}
                        crossOrigin="anonymous"
                        onError={(e) => {
                          console.error('Audio load error:', audioUrl, e);
                        }}
                        onLoadedMetadata={(e) => {
                          console.log('Audio loaded:', audioUrl);
                        }}
                      >
                        <source src={audioUrl} type="audio/webm" />
                        <source src={audioUrl} type="audio/ogg" />
                        <source src={audioUrl} type="audio/mpeg" />
                        <source src={audioUrl} type="audio/mp4" />
                        Your browser does not support the audio element.
                      </audio>
                    </div>
                  );
                }
                
                // Fallback if parsing fails - show message type and that it's encrypted
                if (message.type === 'voice') {
                  return (
                    <div className="flex items-center gap-2 text-sm italic opacity-70">
                      <Mic size={16} />
                      <span>Voice message (encrypted)</span>
                    </div>
                  );
                }
                
                return <p className="break-words text-sm italic">Voice message (unable to load)</p>;
              }

              if (message.type === 'file' && fileInfo) {
                const formatSize = (bytes: number) => {
                  if (bytes < 1024) return bytes + ' B';
                  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
                  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
                };

                return (
                  <a href={fileInfo.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 hover:opacity-80 transition">
                    <div className={`p-2 rounded-lg ${isSender ? 'bg-white/20' : 'bg-primary-500/20'}`}>
                      <Paperclip size={20} />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{fileInfo.filename}</p>
                      <p className="text-xs opacity-70">{formatSize(fileInfo.size)}</p>
                    </div>
                  </a>
                );
              }

              // Default text rendering - check for unhandled JSON content
              if (message.content && message.content.startsWith && message.content.startsWith('{') && message.content.includes('"type"')) {
                try {
                  const parsed = JSON.parse(message.content);
                  // If it's a voice message that wasn't caught earlier
                  if (parsed.type === 'voice' && parsed.url) {
                    const formatVoiceDuration = (seconds: number) => {
                      const mins = Math.floor(seconds / 60);
                      const secs = Math.floor(seconds % 60);
                      return `${mins}:${secs.toString().padStart(2, '0')}`;
                    };
                    
                    // Fix URL - ensure it uses the correct API URL
                    let audioUrl = parsed.url;
                    const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
                    
                    // If URL contains localhost or is relative, fix it
                    if (audioUrl.includes('localhost:3001') || audioUrl.startsWith('/uploads/')) {
                      const filename = audioUrl.split('/uploads/').pop() || parsed.filename;
                      audioUrl = `${API_URL}/uploads/${filename}`;
                    } else if (!audioUrl.startsWith('http') && !audioUrl.startsWith('blob:')) {
                      audioUrl = `${API_URL}/uploads/${audioUrl}`;
                    }
                    
                    // Ensure HTTPS for non-localhost URLs
                    if (!audioUrl.includes('localhost') && audioUrl.startsWith('http://')) {
                      audioUrl = audioUrl.replace('http://', 'https://');
                    }
                    
                    return (
                      <div className="min-w-[220px] max-w-[280px]">
                        <div className="flex items-center gap-3 mb-2">
                          <div className={`p-2 rounded-full ${isSender ? 'bg-white/20' : 'bg-primary-500/20'}`}>
                            <Mic size={18} />
                          </div>
                          <div className="flex-1">
                            <p className="text-sm font-medium">Voice Message</p>
                            <p className="text-xs opacity-70">{formatVoiceDuration(parsed.duration || 0)}</p>
                          </div>
                        </div>
                        <audio 
                          src={audioUrl} 
                          controls 
                          preload="auto"
                          className="w-full h-10" 
                          style={{ filter: isSender ? 'invert(1) hue-rotate(180deg)' : 'none' }}
                          crossOrigin="anonymous"
                          onError={(e) => {
                            console.error('Audio load error:', audioUrl, e);
                          }}
                        >
                          <source src={audioUrl} type="audio/webm" />
                          <source src={audioUrl} type="audio/ogg" />
                          <source src={audioUrl} type="audio/mpeg" />
                          <source src={audioUrl} type="audio/mp4" />
                          Your browser does not support the audio element.
                        </audio>
                      </div>
                    );
                  }
                  // If it's a file/image that wasn't caught
                  if (parsed.url && parsed.filename) {
                    return (
                      <a href={parsed.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 hover:opacity-80 transition">
                        <div className={`p-2 rounded-lg ${isSender ? 'bg-white/20' : 'bg-primary-500/20'}`}>
                          <Paperclip size={20} />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{parsed.filename}</p>
                        </div>
                      </a>
                    );
                  }
                } catch {}
              }

              return <p className="break-words">{renderTextWithLinks(message.content)}</p>;
            };

            return (
              <div
                key={message.id}
                className={`flex items-end gap-2 ${isSender ? 'flex-row-reverse' : 'flex-row'}`}
                onContextMenu={(e) => handleMessageContextMenu(e, message.id, isSender)}
              >
                {showAvatar && !isSender && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500/50 to-cyan-500/50 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                    {getInitials(message.senderId)}
                  </div>
                )}
                {!showAvatar && !isSender && <div className="w-8" />}

                <div
                  className={`max-w-md px-4 py-2.5 rounded-2xl ${
                    isSender
                      ? 'bg-gradient-to-br from-primary-500 to-primary-600 text-white'
                      : 'bg-card border border-midnight text-white'
                  } ${selectedMessageId === message.id ? 'ring-2 ring-primary-400' : ''}`}
                >
                  {renderMessageContent()}
                  <div className={`flex items-center gap-1.5 mt-1 ${isSender ? 'justify-end' : 'justify-start'}`}>
                    <span className={`text-xs ${isSender ? 'text-white/60' : 'text-muted'}`}>
                      {formatMessageTime(message.timestamp)}
                    </span>
                    {isSender && (
                      <span className="flex items-center">
                        {message.read ? (
                          // Read by recipient - double cyan checkmark
                          <CheckCheck size={14} className="text-cyan-300" />
                        ) : message.delivered ? (
                          // Delivered but not read - single white checkmark
                          <Check size={14} className="text-white/60" />
                        ) : (
                          // Sent but not yet delivered - single gray checkmark
                          <Check size={14} className="text-white/40" />
                        )}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Context Menu */}
      {showMessageMenu && (
        <div
          ref={messageMenuRef}
          className="fixed bg-card border border-midnight rounded-xl shadow-lg py-1 z-50"
          style={{ left: messageMenuPosition.x, top: messageMenuPosition.y }}
        >
          <button
            onClick={() => handleDeleteMessage(selectedMessageId!)}
            className="w-full px-4 py-2.5 text-left text-sm text-danger-500 hover:bg-danger-500/10 flex items-center gap-2 transition"
          >
            <Trash2 size={14} />
            Delete Message
          </button>
        </div>
      )}

      {/* Message Input */}
      <div className="bg-midnight-light border-t border-midnight p-4">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          className="hidden"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
        />
        
        <form onSubmit={handleSendMessage} className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 hover:bg-dark-200 rounded-xl transition text-secondary hover:text-white"
            title="Attach file"
          >
            <Paperclip size={20} />
          </button>
          
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              className={`p-2.5 hover:bg-dark-200 rounded-xl transition ${showEmojiPicker ? 'bg-dark-200 text-white' : 'text-secondary hover:text-white'}`}
              title="Add emoji"
            >
              <Smile size={20} />
            </button>
            {showEmojiPicker && (
              <EmojiPicker
                onEmojiSelect={handleEmojiSelect}
                onClose={() => setShowEmojiPicker(false)}
                position="top"
              />
            )}
          </div>
          
          {isRecording ? (
            // Recording UI
            <div className="flex-1 flex items-center gap-3 px-4 py-3 bg-danger-500/20 border border-danger-500/50 rounded-xl">
              <div className="w-3 h-3 rounded-full bg-danger-500 animate-pulse" />
              <span className="text-white font-medium">{formatDuration(recordingDuration)}</span>
              <span className="text-secondary text-sm flex-1">Recording...</span>
              <button
                type="button"
                onClick={handleCancelRecording}
                className="p-2 hover:bg-danger-500/30 rounded-lg transition text-danger-500"
                title="Cancel recording"
              >
                <X size={18} />
              </button>
            </div>
          ) : (
            <input
              ref={inputRef}
              type="text"
              value={messageText}
              onChange={(e) => setMessageText(e.target.value)}
              placeholder="Type a message..."
              disabled={isSending}
              className="flex-1 px-4 py-3 bg-card border border-midnight rounded-xl text-white placeholder-muted focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition"
            />
          )}
          <button
            type="button"
            onClick={handleVoiceRecordToggle}
            disabled={isSending}
            className={`p-2.5 rounded-xl transition ${
              isRecording 
                ? 'bg-danger-500 text-white hover:bg-danger-600 animate-pulse' 
                : 'hover:bg-dark-200 text-secondary hover:text-white'
            }`}
            title={isRecording ? "Stop recording" : "Voice message"}
          >
            {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <button
            type="submit"
            disabled={(!messageText.trim() && !isRecording) || isSending}
            className="p-3 bg-gradient-to-r from-primary-500 to-cyan-500 text-white rounded-xl hover:shadow-glow transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}
