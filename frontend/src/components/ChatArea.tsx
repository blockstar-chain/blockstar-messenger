import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useAppStore } from '@/store';
import { db, dbHelpers } from '@/lib/database';
import { webSocketService } from '@/lib/websocket';
import { webRTCService } from '@/lib/webrtc';
import { isNative, platform } from '@/lib/mediaPermissions';
import { encryptionService } from '@/lib/encryption';
import { voiceMessageService } from '@/lib/voice-message-service';
import { notificationService } from '@/lib/notifications';
import { Message, Conversation } from '@/types';
import { Send, Phone, Video, MoreVertical, Menu, Paperclip, Mic, MicOff, Lock, LockOpen, Search, X, Bell, BellOff, Smile, Check, CheckCheck, Trash2, Shield, ShieldAlert, MessageSquare, Users, RefreshCw, Settings, UserPlus, VolumeX, Volume2, ChevronLeft } from 'lucide-react';
import { generateMessageId, generateConversationId, formatMessageTime, truncateAddress, getInitials, getAvatarColor } from '@/utils/helpers';
import { resolveProfile, getProfileByWallet, type BlockStarProfile } from '@/lib/profileResolver';
import toast from 'react-hot-toast';
import EmojiPicker from './EmojiPicker';
import GroupSettingsModal from './GroupSettingsModal';
import UserProfileModal from './UserProfileModal';
import { addToContacts, isContact } from './ContactsSection';
import { isConversationDeleted, removeFromDeletedConversations } from './Sidebar';

// Store for decrypted message content (in-memory + localStorage cache)
const decryptedContentCache = new Map<string, string>();

interface ChatAreaProps {
  onBackClick?: () => void;
}

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

export default function ChatArea({ onBackClick }: ChatAreaProps) {
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
  const [userStatuses, setUserStatuses] = useState<Map<string, { status: string; lastSeen?: number }>>(new Map());
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
  const [showGroupSettings, setShowGroupSettings] = useState(false);
  const [memberProfiles, setMemberProfiles] = useState<Map<string, BlockStarProfile | null>>(new Map());
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [isUserContact, setIsUserContact] = useState(false);
  const [encryptionStatus, setEncryptionStatus] = useState<'encrypted' | 'unencrypted' | 'checking'>('checking');
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [messageReactions, setMessageReactions] = useState<Map<string, Array<{ emoji: string; userId: string }>>>(new Map());
  const [showReactionPicker, setShowReactionPicker] = useState<string | null>(null);
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

  // Display profile - check cache as fallback if state is null
  // This ensures we show @name even if the state wasn't updated when cache was populated
  // Adding conversations.length triggers re-check when new conversations (with cached profiles) are added
  const displayProfile = React.useMemo(() => {
    if (contactProfile) return contactProfile;
    if (otherParticipant) {
      return getProfileByWallet(otherParticipant) || null;
    }
    return null;
  }, [contactProfile, otherParticipant, conversations.length]);

  const getStatus = (address: string) => {
    const statusInfo = userStatuses.get(address.toLowerCase());
    return statusInfo?.status || 'offline';
  };

  const getLastSeen = (address: string): number | null => {
    const statusInfo = userStatuses.get(address.toLowerCase());
    return statusInfo?.lastSeen || null;
  };

  const formatLastSeen = (timestamp: number | null): string => {
    if (!timestamp) return '';
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    
    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString();
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

  // Reset unread count when conversation is opened
  useEffect(() => {
    if (activeConversationId && activeConversation && activeConversation.unreadCount > 0) {
      // Reset unread count in store and database
      useAppStore.getState().updateConversation(activeConversationId, { unreadCount: 0 });
      db.conversations.update(activeConversationId, { unreadCount: 0 }).catch(console.error);
    }
  }, [activeConversationId]);

  // Fetch user status
  useEffect(() => {
    if (otherParticipant) {
      const fetchStatus = async () => {
        try {
          const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
          const response = await fetch(`${API_URL}/api/users/${otherParticipant.toLowerCase()}/status`);
          if (response.ok) {
            const data = await response.json();
            const statusInfo = {
              status: data.isOnline ? 'online' : 'offline',
              lastSeen: data.lastSeen || null,
            };
            setUserStatuses((prev) => {
              const newMap = new Map(prev);
              newMap.set(otherParticipant.toLowerCase(), statusInfo);
              return newMap;
            });
          }
        } catch (error) {
          setUserStatuses((prev) => {
            const newMap = new Map(prev);
            newMap.set(otherParticipant.toLowerCase(), { status: 'offline', lastSeen: null });
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
        setIsUserContact(false);
        return;
      }
      
      // Check if this user is in contacts
      setIsUserContact(isContact(otherParticipant));
      
      try {
        // First check local wallet cache (populated when @name was resolved)
        const cachedProfile = getProfileByWallet(otherParticipant);
        if (cachedProfile) {
          setContactProfile(cachedProfile);
          return;
        }
        
        // Try to resolve by looking up if they have an NFT name in our database
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

  // Check encryption status for direct chats and groups
  useEffect(() => {
    const checkEncryptionStatus = async () => {
      if (isGroupChat) {
        // Group chats: Check if we have keys for ALL members (not just any)
        setEncryptionStatus('checking');
        
        const participants = activeConversation?.participants || [];
        const otherParticipants = participants.filter(
          p => p.toLowerCase() !== currentUser?.walletAddress.toLowerCase()
        );
        
        if (otherParticipants.length === 0) {
          setEncryptionStatus('unencrypted');
          return;
        }
        
        let allHaveKeys = true;
        let checkedCount = 0;
        
        for (const participant of otherParticipants) {
          try {
            const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
            const response = await fetch(`${API_URL}/api/keys/${participant.toLowerCase()}`);
            if (response.ok) {
              const data = await response.json();
              if (data.success && data.publicKey) {
                checkedCount++;
              } else {
                allHaveKeys = false;
              }
            } else {
              allHaveKeys = false;
            }
          } catch (error) {
            allHaveKeys = false;
          }
        }
        
        // Encrypted if all other participants have keys
        const isEncrypted = allHaveKeys && checkedCount === otherParticipants.length;
        console.log(`🔐 Group encryption check: ${checkedCount}/${otherParticipants.length} members have keys, encrypted: ${isEncrypted}`);
        setEncryptionStatus(isEncrypted ? 'encrypted' : 'unencrypted');
        return;
      }
      
      if (!otherParticipant) {
        setEncryptionStatus('checking');
        return;
      }
      
      setEncryptionStatus('checking');
      
      try {
        const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
        const response = await fetch(`${API_URL}/api/keys/${otherParticipant}`);
        
        if (response.ok) {
          const data = await response.json();
          if (data.publicKey) {
            setEncryptionStatus('encrypted');
          } else {
            setEncryptionStatus('unencrypted');
          }
        } else {
          setEncryptionStatus('unencrypted');
        }
      } catch (error) {
        console.error('Error checking encryption status:', error);
        setEncryptionStatus('unencrypted');
      }
    };
    
    checkEncryptionStatus();
  }, [otherParticipant, isGroupChat, activeConversation?.participants]);

  // Load member profiles for group chats
  useEffect(() => {
    const loadMemberProfiles = async () => {
      if (!isGroupChat || !activeConversation) return;
      
      const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      const newProfiles = new Map<string, BlockStarProfile | null>();
      
      for (const participant of activeConversation.participants) {
        const normalizedAddress = participant.toLowerCase();
        
        // FIRST check local wallet cache (may have been populated since last load)
        const cachedProfile = getProfileByWallet(normalizedAddress);
        if (cachedProfile) {
          newProfiles.set(normalizedAddress, cachedProfile);
          continue;
        }
        
        // Then check if already loaded (and no cache available)
        if (memberProfiles.has(normalizedAddress)) {
          newProfiles.set(normalizedAddress, memberProfiles.get(normalizedAddress) || null);
          continue;
        }
        
        try {
          const response = await fetch(`${API_URL}/api/profile/${normalizedAddress}`);
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.profile?.nftName) {
              const profile = await resolveProfile(data.profile.nftName);
              newProfiles.set(normalizedAddress, profile);
              continue;
            }
          }
          newProfiles.set(normalizedAddress, null);
        } catch (error) {
          newProfiles.set(normalizedAddress, null);
        }
      }
      
      setMemberProfiles(newProfiles);
    };
    
    loadMemberProfiles();
  }, [isGroupChat, activeConversation?.id, activeConversation?.participants.length]);

  // Listen for refresh requests from Sidebar
  useEffect(() => {
    const handleRefresh = async () => {
      console.log('🔄 Refresh requested, reloading messages...');
      if (activeConversationId) {
        await loadMessages(true);
      }
    };
    
    window.addEventListener('blockstar:refresh', handleRefresh);
    return () => window.removeEventListener('blockstar:refresh', handleRefresh);
  }, [activeConversationId]);

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
      setIsMuted(notificationService.isConversationMuted(activeConversationId));
      setSearchMode(false);
      setSearchQuery('');
    }
  }, [activeConversationId]);

  useEffect(() => {
    const unsubscribe = webSocketService.onStatus((data) => {
      const address = data.address.toLowerCase();
      const prevStatusInfo = userStatuses.get(address);
      const prevStatus = prevStatusInfo?.status;
      
      setUserStatuses((prev) => {
        const newMap = new Map(prev);
        newMap.set(address, { 
          status: data.status, 
          lastSeen: data.lastSeen || (data.status === 'offline' ? Date.now() : null)
        });
        return newMap;
      });
      
      // When user comes online, clear their key cache so we can refetch
      if (data.status === 'online' && prevStatus !== 'online') {
        encryptionService.clearKeyCache(address);
        console.log('🔑 User came online, cleared key cache for', address);
        
        // Re-check encryption status if this is our chat partner
        if (address === otherParticipant?.toLowerCase() && encryptionStatus === 'unencrypted') {
          // Re-check after a short delay to allow key registration
          setTimeout(async () => {
            try {
              const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
              const response = await fetch(`${API_URL}/api/keys/${address}`);
              if (response.ok) {
                const keyData = await response.json();
                if (keyData.publicKey) {
                  setEncryptionStatus('encrypted');
                  toast.success('🔐 Encryption now active!', { duration: 3000 });
                }
              }
            } catch (error) {
              console.error('Error re-checking encryption:', error);
            }
          }, 1000);
        }
      }
    });
    return () => unsubscribe();
  }, [userStatuses, otherParticipant, encryptionStatus]);

  // iOS keyboard handling - scroll input into view when keyboard opens
  useEffect(() => {
    // Only run on iOS/mobile
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    if (!isIOS && !('visualViewport' in window)) return;

    const inputEl = inputRef.current;
    if (!inputEl) return;

    // Handle focus - scroll input into view
    const handleFocus = () => {
      // Small delay to let keyboard animate open
      setTimeout(() => {
        inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    };

    // Visual viewport resize handler for iOS keyboard
    const handleViewportResize = () => {
      if (document.activeElement === inputEl) {
        inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    };

    inputEl.addEventListener('focus', handleFocus);
    
    if ('visualViewport' in window && window.visualViewport) {
      window.visualViewport.addEventListener('resize', handleViewportResize);
    }

    return () => {
      inputEl.removeEventListener('focus', handleFocus);
      if ('visualViewport' in window && window.visualViewport) {
        window.visualViewport.removeEventListener('resize', handleViewportResize);
      }
    };
  }, []);

  // Listen for incoming messages
  useEffect(() => {
    const unsubscribe = webSocketService.onMessage(async (message) => {
      try {
        // Handle special system messages for group invites (from offline queue)
        if (message.type === 'system:group_invite' && message.groupInfo) {
          console.log('📢 Processing offline group invite:', message.groupInfo.groupName);
          
          const { conversations, addConversation } = useAppStore.getState();
          
          // Check if group already exists
          const existingGroup = conversations.find(c => c.id === message.groupInfo.id);
          if (existingGroup) {
            console.log('Group already exists, skipping invite');
            return;
          }
          
          // Create the group from the invite
          const newGroup: Conversation = {
            id: message.groupInfo.id,
            type: 'group',
            participants: message.groupInfo.participants || [],
            groupName: message.groupInfo.groupName,
            groupAvatar: message.groupInfo.groupAvatar,
            admins: message.groupInfo.admins || [],
            createdBy: message.groupInfo.createdBy || '',
            unreadCount: 0,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          
          await db.conversations.put(newGroup);
          addConversation(newGroup);
          
          toast.success(`You were added to group "${message.groupInfo.groupName}"`, { duration: 4000 });
          return; // Don't process as regular message
        }
        
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
          : message.recipientId?.[0] || currentUser?.walletAddress).toLowerCase();
        
        // Use message's conversationId (for groups) or generate one (for direct)
        const conversationId = message.conversationId || generateConversationId(senderId, recipientId);
        const isGroupMessage = Array.isArray(message.recipientId) || message.conversationId?.startsWith('group_');
        
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
        
        const { conversations, addConversation, updateConversation, activeConversationId: currentActiveId } = useAppStore.getState();
        
        // For direct messages, check if conversation exists by ID or by participants
        let conv = conversations.find(c => c.id === conversationId);
        
        // If not found by ID, try to find by participants
        if (!conv) {
          if (isGroupMessage) {
            // For group messages, check if we have a group with these participants
            // The message might reference a group_id we don't have locally
            const messageParticipants = Array.isArray(message.recipientId) 
              ? [...message.recipientId, senderId].map(p => p.toLowerCase()).sort()
              : [senderId, recipientId].map(p => p.toLowerCase()).sort();
            
            conv = conversations.find(c => {
              if (c.type !== 'group') return false;
              const convParticipants = (c.participants || []).map(p => p.toLowerCase()).sort();
              return convParticipants.join(',') === messageParticipants.join(',');
            });
            
            if (conv) {
              console.log(`📨 Found existing group by participants: ${conv.id} (${(conv as any).groupName})`);
              displayMessage.conversationId = conv.id;
              // Use the existing conversation ID for further processing
              const existingConvId = conv.id;
              
              // Update the existing conversation
              const updates: any = {
                lastMessage: displayMessage,
                updatedAt: Date.now()
              };
              
              const isActiveConv = currentActiveId === existingConvId;
              if (!isActiveConv) {
                updates.unreadCount = (conv.unreadCount || 0) + 1;
              }
              
              useAppStore.getState().updateConversation(existingConvId, updates);
              await db.conversations.update(existingConvId, updates);
              
              addMessage(displayMessage);
              webSocketService.markDelivered(message.id);
              return; // Don't continue to create a new conversation
            }
          } else {
            // For direct messages
            const participants = [senderId, recipientId].map(p => p.toLowerCase()).sort();
            conv = conversations.find(c => {
              if (c.type !== 'direct') return false;
              const convParticipants = (c.participants || []).map(p => p.toLowerCase()).sort();
              return convParticipants.length === 2 && 
                convParticipants[0] === participants[0] && 
                convParticipants[1] === participants[1];
            });
            
            if (conv) {
              console.log(`📨 Found existing direct conversation by participants: ${conv.id}`);
              displayMessage.conversationId = conv.id;
            }
          }
        }
        
        const isActiveConversation = currentActiveId === conversationId || currentActiveId === conv?.id;
        
        // Check if this conversation was deleted by the user
        // If so, remove from deleted list so it reappears with the new message
        // Check multiple ID formats (server ObjectId, client-generated ID, etc.)
        const idsToCheck = new Set<string>();
        if (conversationId) idsToCheck.add(conversationId);
        if (conv?.id) idsToCheck.add(conv.id);
        
        // For direct messages, also check client-generated ID format
        if (!isGroupMessage) {
          const clientStyleId = generateConversationId(senderId, recipientId);
          idsToCheck.add(clientStyleId);
        }
        
        for (const idToCheck of idsToCheck) {
          if (isConversationDeleted(idToCheck, currentUser?.walletAddress)) {
            console.log('📬 New message for deleted conversation, restoring:', idToCheck);
            removeFromDeletedConversations(idToCheck, currentUser?.walletAddress);
          }
        }
        
        if (!conv) {
          // Conversation doesn't exist yet
          if (isGroupMessage) {
            // For group messages, try to create the group from groupInfo if available
            // This handles the case where group:created event was missed
            if (message.groupInfo && message.groupInfo.groupName) {
              console.log(`📨 Creating group from message groupInfo: ${message.groupInfo.groupName}`);
              
              const newGroup: Conversation = {
                id: conversationId,
                type: 'group',
                participants: message.groupInfo.participants || [],
                groupName: message.groupInfo.groupName,
                groupAvatar: message.groupInfo.groupAvatar,
                admins: message.groupInfo.admins || [],
                createdBy: message.groupInfo.createdBy || '',
                unreadCount: isActiveConversation ? 0 : 1,
                createdAt: Date.now(),
                updatedAt: Date.now(),
                lastMessage: displayMessage,
              };
              
              await db.conversations.put(newGroup);
              addConversation(newGroup);
              conv = newGroup;
            } else {
              // No groupInfo available - wait for group:created event
              console.log(`📨 Received message for unknown group ${conversationId}, waiting for group:created event`);
              
              // Save message to IndexedDB so it appears when group is created
              await dbHelpers.saveMessage(displayMessage);
              
              // Don't add to UI yet - the group:created handler will load conversations
              // which will pick up this message
              return;
            }
          } else {
            // For direct messages, create the conversation
            const newConv = {
              id: conversationId,
              type: 'direct' as const,
              participants: [senderId, recipientId],
              unreadCount: isActiveConversation ? 0 : 1,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              lastMessage: displayMessage,
            };
            
            await db.conversations.put(newConv);
            addConversation(newConv);
          }
        } else {
          // Update existing conversation - increment unread if not the active conversation
          const updates: any = {
            lastMessage: displayMessage,
            updatedAt: Date.now()
          };
          
          if (!isActiveConversation) {
            updates.unreadCount = (conv.unreadCount || 0) + 1;
          }
          
          useAppStore.getState().updateConversation(conv.id, updates);
          await db.conversations.update(conv.id, updates);
        }
        
        addMessage(displayMessage);
        webSocketService.markDelivered(message.id);
        
        // Trigger notification for incoming messages
        // Get sender name for notification
        let senderName = truncateAddress(senderId);
        try {
          const senderProfile = await getProfileByWallet(senderId);
          if (senderProfile?.name || senderProfile?.username) {
            senderName = senderProfile.name || senderProfile.username || senderName;
          }
        } catch (e) {
          // Use address if profile fetch fails
        }
        
        // Get group name if it's a group message
        const groupConv = isGroupMessage ? conversations.find(c => c.id === conversationId) : null;
        const groupName = groupConv ? (groupConv as any).groupName : undefined;
        
        // Send notification
        notificationService.notifyNewMessage(
          senderName,
          displayContent.length > 100 ? displayContent.substring(0, 100) + '...' : displayContent,
          {
            conversationId: conv?.id || conversationId,
            isGroup: isGroupMessage,
            groupName,
            onClick: () => {
              // Focus the conversation when notification is clicked
              useAppStore.getState().setActiveConversationId(conv?.id || conversationId);
            }
          }
        );
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
      
      // Pass wallet address to get user-specific encrypted content for group messages
      let msgs = await dbHelpers.getConversationMessages(activeConversationId, myAddress);
      
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
        
        // Parse system message content to extract metadata
        // System messages store their metadata as JSON in the content field
        if (msg.type === 'system' && msg.content) {
          try {
            const metadata = JSON.parse(msg.content);
            return {
              ...msg,
              read: isRead,
              isSystemMessage: metadata.isSystemMessage || true,
              systemMessageType: metadata.systemMessageType,
              callType: metadata.callType,
              metadata: {
                callId: metadata.callId,
                callerId: metadata.callerId,
                callerName: metadata.callerName,
                reason: metadata.reason,
              },
            };
          } catch {
            // Not JSON, leave as is
          }
        }
        
        return { ...msg, read: isRead };
      });
      
      // Try to decrypt messages
      // In ECDH, the shared secret is derived from your private key + other party's public key
      // So for BOTH sent and received messages, we need the OTHER participant's public key
      
      // Only attempt decryption if encryption service is ready
      const canDecrypt = encryptionService.isReady();
      if (!canDecrypt) {
        console.warn('⚠️ Encryption service not ready, messages may appear encrypted');
      }
      
      for (const msg of msgs) {
        if (!decryptedContentCache.has(msg.id) && (msg.type === 'text' || !msg.type)) {
          // Skip decryption if encryption service isn't ready
          if (!canDecrypt) continue;
          
          try {
            // Determine the other party's address for key derivation
            const isMySentMessage = msg.senderId.toLowerCase() === myAddress;
            
            // Handle recipientId being string or string[]
            let recipientAddr = Array.isArray(msg.recipientId) 
              ? msg.recipientId[0] 
              : msg.recipientId;
            
            // If recipientId is missing (common when loading from server), derive from conversation participants
            if (!recipientAddr && activeConversation?.participants) {
              const otherParticipants = activeConversation.participants.filter(
                p => p.toLowerCase() !== myAddress
              );
              if (otherParticipants.length > 0) {
                recipientAddr = otherParticipants[0];
              }
            }
            
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
      
      // Populate reactions from loaded messages
      const newReactions = new Map<string, Array<{ emoji: string; userId: string }>>();
      for (const msg of msgs) {
        const msgWithReactions = msg as any;
        if (msgWithReactions.reactions && msgWithReactions.reactions.length > 0) {
          newReactions.set(msg.id, msgWithReactions.reactions.map((r: any) => ({
            emoji: r.emoji,
            userId: r.userId,
          })));
        }
      }
      setMessageReactions(newReactions);
      
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
    
    const newMuted = !isMuted;
    
    if (newMuted) {
      notificationService.muteConversation(activeConversationId);
      toast.success('Notifications muted for this chat');
    } else {
      notificationService.unmuteConversation(activeConversationId);
      toast.success('Notifications unmuted for this chat');
    }
    
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

  // Quick emoji reactions
  const quickReactions = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
  
  const handleAddReaction = async (messageId: string, emoji: string) => {
    if (!currentUser?.walletAddress) return;
    
    const userId = currentUser.walletAddress.toLowerCase();
    
    // Update local state
    setMessageReactions(prev => {
      const newMap = new Map(prev);
      const existing = newMap.get(messageId) || [];
      
      // Check if user already reacted with this emoji
      const existingReaction = existing.find(r => r.userId === userId && r.emoji === emoji);
      if (existingReaction) {
        // Remove reaction
        newMap.set(messageId, existing.filter(r => !(r.userId === userId && r.emoji === emoji)));
      } else {
        // Add reaction
        newMap.set(messageId, [...existing, { emoji, userId }]);
      }
      
      return newMap;
    });
    
    // Send to server
    try {
      webSocketService.emit('message:reaction', {
        messageId,
        emoji,
        conversationId: activeConversationId,
        userId,
      });
    } catch (error) {
      console.error('Error sending reaction:', error);
    }
    
    setShowReactionPicker(null);
  };

  // Listen for reaction updates
  useEffect(() => {
    const unsubscribe = webSocketService.on('message:reaction', (data: { 
      messageId: string; 
      emoji: string; 
      userId: string;
      action: 'add' | 'remove';
      reactions?: Array<{ emoji: string; userId: string }>;
    }) => {
      setMessageReactions(prev => {
        const newMap = new Map(prev);
        
        // If server sent full reactions list, use it directly
        if (data.reactions) {
          newMap.set(data.messageId, data.reactions.map(r => ({
            emoji: r.emoji,
            userId: r.userId,
          })));
        } else {
          // Fallback to add/remove logic
          const existing = newMap.get(data.messageId) || [];
          
          if (data.action === 'remove') {
            newMap.set(data.messageId, existing.filter(r => !(r.userId === data.userId && r.emoji === data.emoji)));
          } else {
            // Check if already exists
            if (!existing.find(r => r.userId === data.userId && r.emoji === data.emoji)) {
              newMap.set(data.messageId, [...existing, { emoji: data.emoji, userId: data.userId }]);
            }
          }
        }
        
        return newMap;
      });
    });
    
    return () => unsubscribe();
  }, []);

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
        filename: data.file.originalName || file.name, // Use original filename
        storedFilename: data.file.filename, // Keep server filename for URL
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
    
    // IMPORTANT: If user is sending a message to a conversation they previously deleted,
    // remove it from the deleted list so it won't disappear after logout
    removeFromDeletedConversations(activeConversationId, currentUser.walletAddress);
    
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
        // Group chat: Pairwise E2E encryption - encrypt for each recipient
        const recipients = activeConversation?.participants.filter(
          p => p.toLowerCase() !== senderId
        ) || [];
        
        console.log('📢 Group message to recipients:', recipients);
        
        // Encrypt message for each recipient (pairwise encryption)
        const encryptedPayloads: Record<string, string> = {};
        let hasEncryption = false;
        
        for (const recipient of recipients) {
          const recipientLower = recipient.toLowerCase();
          const { encrypted, error } = await encryptionService.encryptForRecipient(plainText, recipientLower);
          
          if (encrypted && !error) {
            encryptedPayloads[recipientLower] = encrypted;
            hasEncryption = true;
          } else {
            // Fallback to plain text for this recipient
            encryptedPayloads[recipientLower] = plainText;
            console.log(`⚠️ Could not encrypt for ${recipientLower}:`, error);
          }
        }
        
        // IMPORTANT: Also encrypt for the sender so they can decrypt their own messages later
        // This is needed when messages are loaded from the server after cache is cleared
        if (hasEncryption) {
          // For sender's own copy, encrypt using first recipient's key (we'll decrypt with same key)
          // Actually, we store plaintext for sender since they sent it
          encryptedPayloads[senderId] = plainText;
          console.log('📢 Added sender payload for self-decryption');
        }
        
        // Update encryption status based on results
        if (hasEncryption) {
          setEncryptionStatus('encrypted');
        }
        
        const message: Message = {
          id: messageId,
          conversationId: activeConversationId,
          senderId,
          recipientId: recipients,  // Array for group
          content: plainText, // Store plain text locally
          timestamp: Date.now(),
          delivered: false,
          read: false,
          type: 'text',
        };

        saveDecryptedContent(messageId, plainText);
        
        const localMessage = { ...message };
        await dbHelpers.saveMessage(localMessage);
        addMessage(localMessage);
        
        // Update conversation with last message for sorting
        useAppStore.getState().updateConversation(activeConversationId, {
          lastMessage: localMessage,
          updatedAt: Date.now()
        });
        await db.conversations.update(activeConversationId, {
          updatedAt: Date.now()
        });

        // Get group info to include in message (for recipients who might not have the group yet)
        const groupInfo = {
          id: activeConversationId,
          groupName: (activeConversation as any)?.groupName || 'Group Chat',
          participants: activeConversation?.participants || [],
          admins: (activeConversation as any)?.admins || [],
          createdBy: (activeConversation as any)?.createdBy || senderId,
        };

        // Send to group with encrypted payloads for each recipient
        webSocketService.emit('group:message', {
          groupId: activeConversationId,
          message: {
            ...message,
            content: hasEncryption ? '__ENCRYPTED_GROUP__' : plainText,
            encryptedPayloads, // Each recipient's encrypted copy
          },
          recipients,
          groupInfo, // Include group metadata for recipients
        });
        
        console.log('✅ Group message sent with E2E encryption for', Object.keys(encryptedPayloads).length, 'recipients');
      } else {
        // Direct chat: encrypt for recipient
        const recipientId = otherParticipant!.toLowerCase();
        const { encrypted, error } = await encryptionService.encryptForRecipient(plainText, recipientId);

        if (error) {
          // Only show toast once per conversation session, not on every message
          if (encryptionStatus !== 'unencrypted') {
            toast(error.replace(' - message sent unencrypted', ''), { 
              icon: '🔓',
              duration: 4000 
            });
            setEncryptionStatus('unencrypted');
          }
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
        
        // Update conversation with last message for sorting
        useAppStore.getState().updateConversation(activeConversationId, {
          lastMessage: localMessage,
          updatedAt: Date.now()
        });
        await db.conversations.update(activeConversationId, {
          updatedAt: Date.now()
        });

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
    if (!currentUser) return;

    // Check if this is a group call
    const isGroup = isGroupChat || 
                    (activeConversation?.participants && activeConversation.participants.length > 2) ||
                    !!(activeConversation as any)?.groupName;

    // For direct calls, require otherParticipant
    if (!isGroup && !otherParticipant) return;

    try {
      console.log('========================================');
      console.log('INITIATING CALL');
      console.log('Call type:', type);
      console.log('Is group call:', isGroup);
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

      if (isGroup) {
        // GROUP CALL
        const groupConversation = activeConversation as any;
        const recipients = activeConversation?.participants.filter(
          p => p.toLowerCase() !== currentUser.walletAddress.toLowerCase()
        ) || [];

        if (recipients.length === 0) {
          toast.dismiss('call-init');
          toast.error('No other participants in group');
          webRTCService.stopLocalStream();
          return;
        }

        const callId = `${activeConversationId}-${Date.now()}`;
        console.log('Generated group call ID:', callId);
        console.log('Recipients:', recipients);

        // Create peer connections for each recipient
        for (const recipientAddress of recipients) {
          const peerId = `${callId}-${recipientAddress.toLowerCase()}`;
          let offerSent = false;

          webRTCService.createCall(
            peerId,
            type === 'audio',
            (signal) => {
              if (signal.type === 'offer' && !offerSent) {
                console.log('📤 Sending group call OFFER to:', recipientAddress);
                webSocketService.emit('group:call:initiate', {
                  recipientAddress,
                  callType: type,
                  offer: signal,
                  callId,
                  groupId: activeConversationId,
                  groupName: groupConversation?.groupName || 'Group Call',
                  participants: activeConversation?.participants,
                });
                offerSent = true;
              } else if (signal.candidate || signal.type === 'candidate') {
                console.log('📤 Sending group call ICE candidate to:', recipientAddress);
                webSocketService.emit('group:call:ice-candidate', {
                  recipientAddress,
                  candidate: signal,
                  callId,
                  peerId,
                });
              }
            },
            (candidate) => {
              webSocketService.emit('group:call:ice-candidate', {
                recipientAddress,
                candidate,
                callId,
                peerId,
              });
            }
          );
        }

        const call = {
          id: callId,
          callerId: currentUser.walletAddress.toLowerCase(),
          recipientId: recipients,
          type,
          status: 'calling' as const,
          startTime: Date.now(),
          localStream: stream,
          isGroupCall: true,
          participants: activeConversation?.participants || [],
          groupName: groupConversation?.groupName || 'Group Call',
        };

        toast.dismiss('call-init');
        toast.success(`Calling ${recipients.length} participants...`);
        setActiveCall(call);
        setCallModalOpen(true);
      } else {
        // DIRECT CALL (existing logic)
        const callId = `${currentUser.walletAddress.toLowerCase()}-${otherParticipant}-${Date.now()}`;
        console.log('Generated call ID:', callId);
        
        let offerSent = false;
        
        // Get caller name for display on recipient side
        const callerName = currentUser.username?.replace('@', '') || '';
        
        webRTCService.createCall(
          callId,
          type === 'audio',
          (signal) => {
            if (signal.type === 'offer' && !offerSent) {
              console.log('📤 Sending OFFER to:', otherParticipant);
              console.log('📤 Caller name:', callerName);
              webSocketService.initiateCall(otherParticipant!, type, signal, callId, callerName);
              offerSent = true;
            } else if (signal.candidate || signal.type === 'candidate') {
              console.log('📤 Sending ICE candidate');
              webSocketService.sendIceCandidate(otherParticipant!, signal, callId);
            } else if (signal.type !== 'offer') {
              console.log('📤 Sending other signal:', signal.type);
              webSocketService.sendIceCandidate(otherParticipant!, signal, callId);
            }
          },
          (candidate) => {
            console.log('📤 Sending ICE candidate (separate callback)');
            webSocketService.sendIceCandidate(otherParticipant!, candidate, callId);
          }
        );

        const call = {
          id: callId,
          callerId: currentUser.walletAddress.toLowerCase(),
          recipientId: otherParticipant!,
          recipientAddress: otherParticipant, // Keep for backwards compatibility
          type,
          status: 'calling' as const,
          startTime: Date.now(),
          localStream: stream,
        };

        toast.dismiss('call-init');
        setActiveCall(call);
        setCallModalOpen(true);
      }
    } catch (error: any) {
      toast.dismiss('call-init');
      console.error('Call initiation error:', error);
      console.error('Error name:', error.name);
      console.error('Error message:', error.message);
      
      // Show user-friendly error message
      // The webRTCService now returns properly formatted error messages
      const errorMessage = error.message || 'Failed to start call';
      
      // Check if it's a permission error and show appropriate message
      if (errorMessage.toLowerCase().includes('permission denied') || 
          errorMessage.toLowerCase().includes('permission') ||
          error.name === 'NotAllowedError') {
        
        // Show a more detailed toast with instructions for mobile
        if (isNative) {
          if (platform === 'android') {
            toast.error(
              '🎤 Microphone permission required!\n\nGo to Settings > Apps > BlockStar > Permissions and enable Microphone.',
              { duration: 8000 }
            );
          } else if (platform === 'ios') {
            toast.error(
              '🎤 Microphone permission required!\n\nGo to Settings > BlockStar and enable Microphone.',
              { duration: 8000 }
            );
          } else {
            toast.error('🎤 ' + errorMessage, { duration: 6000 });
          }
        } else {
          toast.error('🎤 Please allow microphone access in your browser settings', { duration: 5000 });
        }
      } else if (errorMessage.toLowerCase().includes('not found') || error.name === 'NotFoundError') {
        toast.error('🎤 No microphone found. Please connect a microphone.', { duration: 5000 });
      } else if (errorMessage.toLowerCase().includes('in use') || error.name === 'NotReadableError') {
        toast.error('🎤 Microphone is in use by another app. Please close other apps.', { duration: 5000 });
      } else {
        toast.error('Failed to start call: ' + errorMessage, { duration: 5000 });
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
    <div className="flex-1 flex flex-col h-full md:h-screen bg-midnight">
      {/* Chat Header */}
      <div className="bg-midnight-light border-b border-midnight p-3 md:p-4 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
            {/* Back button - visible on mobile */}
            <button
              onClick={onBackClick}
              className="md:hidden p-2.5 hover:bg-dark-200 rounded-lg transition flex-shrink-0 active:bg-dark-100"
              aria-label="Back to conversations"
            >
              <ChevronLeft size={22} className="text-secondary" />
            </button>
            
            {/* Clickable Avatar */}
            <div 
              className={`w-10 h-10 md:w-10 md:h-10 rounded-full flex items-center justify-center text-white font-semibold overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary-500 transition flex-shrink-0 ${
                isGroupChat 
                  ? 'bg-gradient-to-br from-purple-500/50 to-pink-500/50'
                  : 'bg-gradient-to-br from-primary-500/50 to-cyan-500/50'
              }`}
              onClick={() => {
                if (!isGroupChat && otherParticipant) {
                  setShowProfileModal(true);
                } else if (isGroupChat) {
                  setShowGroupSettings(true);
                }
              }}
              title={isGroupChat ? 'Group Settings' : 'View Profile'}
            >
              {isGroupChat ? (
                (groupConv?.groupAvatar || groupConv?.avatar) ? (
                  <img 
                    src={groupConv.groupAvatar || groupConv.avatar} 
                    alt={groupConv.groupName || 'Group'} 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Users size={20} />
                )
              ) : displayProfile?.avatar ? (
                <img 
                  src={displayProfile.avatar} 
                  alt={displayProfile.username || 'Avatar'} 
                  className="w-full h-full object-cover"
                />
              ) : (
                getInitials(displayProfile?.username || otherParticipant || '')
              )}
            </div>
            
            {/* Clickable Name */}
            <div 
              className="cursor-pointer hover:opacity-80 transition min-w-0 flex-1"
              onClick={() => {
                if (!isGroupChat && otherParticipant) {
                  setShowProfileModal(true);
                } else if (isGroupChat) {
                  setShowGroupSettings(true);
                }
              }}
            >
              {isGroupChat ? (
                <>
                  <h2 className="font-semibold text-white text-sm md:text-base truncate">{groupConv?.groupName || 'Group Chat'}</h2>
                  <p className="text-xs text-muted">{activeConversation?.participants.length} members</p>
                </>
              ) : displayProfile?.username ? (
                <>
                  <h2 className="font-semibold text-white text-sm md:text-base truncate">@{displayProfile.username}</h2>
                  <p className="text-xs text-muted truncate hidden md:block">{truncateAddress(otherParticipant || '')}</p>
                </>
              ) : (
                <h2 className="font-semibold text-white text-sm md:text-base truncate">
                  {truncateAddress(otherParticipant || '')}
                </h2>
              )}
              <div className="flex items-center gap-1 md:gap-2 text-xs md:text-sm flex-wrap">
                {!isGroupChat && (
                  <>
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      getStatus(otherParticipant || '') === 'online' 
                        ? 'bg-success-500 shadow-glow-green' 
                        : 'bg-muted'
                    }`} />
                    <span className="text-secondary truncate">
                      {getStatus(otherParticipant || '') === 'online' 
                        ? 'Online' 
                        : (() => {
                            // Show last seen time if available
                            const lastSeenTime = getLastSeen(otherParticipant || '');
                            if (lastSeenTime) {
                              return `Last seen ${formatLastSeen(lastSeenTime)}`;
                            }
                            return 'Offline';
                          })()
                      }
                    </span>
                    <span className="text-muted hidden md:inline">•</span>
                  </>
                )}
                {encryptionStatus === 'encrypted' ? (
                  <span className="text-success-500 text-xs flex items-center gap-1 flex-shrink-0">
                    <Lock size={10} />
                    <span className="hidden md:inline">E2E Encrypted</span>
                  </span>
                ) : encryptionStatus === 'unencrypted' ? (
                  <span className="text-yellow-500 text-xs flex items-center gap-1 flex-shrink-0" title={isGroupChat ? "Some members haven't set up encryption yet" : "Recipient hasn't set up encryption yet"}>
                    <LockOpen size={10} />
                    <span className="hidden md:inline">Not Encrypted</span>
                  </span>
                ) : (
                  <span className="text-muted text-xs flex items-center gap-1 flex-shrink-0">
                    <Lock size={10} />
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-0.5 md:gap-1 flex-shrink-0">
            {/* Add to Contacts Button (only for direct chats if not already a contact) */}
            {!isGroupChat && otherParticipant && !isUserContact && (
              <button
                onClick={async () => {
                  const added = await addToContacts(otherParticipant);
                  if (added) {
                    setIsUserContact(true);
                    toast.success('Added to contacts!');
                  } else {
                    toast.error('Already in contacts');
                  }
                }}
                className="p-2.5 hover:bg-dark-200 rounded-lg transition text-secondary hover:text-success-400 active:bg-dark-100"
                title="Add to contacts"
              >
                <UserPlus size={20} />
              </button>
            )}
            
            {/* Group Settings Button (only for group chats) */}
            {isGroupChat && (
              <button
                onClick={() => setShowGroupSettings(true)}
                className="p-2.5 hover:bg-dark-200 rounded-lg transition text-secondary hover:text-white active:bg-dark-100 hidden md:block"
                title="Group settings"
              >
                <Settings size={20} />
              </button>
            )}
            <button
              onClick={() => handleStartCall('audio')}
              className="p-2.5 hover:bg-dark-200 rounded-lg transition text-secondary hover:text-white active:bg-dark-100"
              title="Voice call"
            >
              <Phone size={20} />
            </button>
            <button
              onClick={() => handleStartCall('video')}
              className="p-2.5 hover:bg-dark-200 rounded-lg transition text-secondary hover:text-white active:bg-dark-100 hidden md:block"
              title="Video call"
            >
              <Video size={20} />
            </button>
            
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowChatMenu(!showChatMenu)}
                className="p-2.5 hover:bg-dark-200 rounded-lg transition text-secondary hover:text-white active:bg-dark-100"
              >
                <MoreVertical size={20} />
              </button>
              
              {showChatMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-card border border-midnight rounded-xl shadow-lg py-1 z-50">
                  {/* Video call option visible in menu on mobile */}
                  <button
                    onClick={() => {
                      handleStartCall('video');
                      setShowChatMenu(false);
                    }}
                    className="w-full px-4 py-3 md:hidden text-left text-sm text-secondary hover:text-white hover:bg-dark-200 flex items-center gap-3 transition active:bg-dark-100"
                  >
                    <Video size={16} />
                    Video Call
                  </button>
                  <button
                    onClick={handleToggleSearch}
                    className="w-full px-4 py-3 text-left text-sm text-secondary hover:text-white hover:bg-dark-200 flex items-center gap-3 transition active:bg-dark-100"
                  >
                    <Search size={16} />
                    {searchMode ? 'Close Search' : 'Search in Chat'}
                  </button>
                  <button
                    onClick={handleToggleMute}
                    className="w-full px-4 py-3 text-left text-sm text-secondary hover:text-white hover:bg-dark-200 flex items-center gap-3 transition active:bg-dark-100"
                  >
                    {isMuted ? <Bell size={16} /> : <BellOff size={16} />}
                    {isMuted ? 'Unmute Notifications' : 'Mute Notifications'}
                  </button>
                  <button
                    onClick={handleRetryDecryption}
                    className="w-full px-4 py-3 text-left text-sm text-secondary hover:text-white hover:bg-dark-200 flex items-center gap-3 transition active:bg-dark-100"
                  >
                    <RefreshCw size={16} />
                    Retry Decryption
                  </button>
                  <div className="border-t border-midnight my-1"></div>
                  <button
                    onClick={handleClearChat}
                    className="w-full px-4 py-3 text-left text-sm text-danger-500 hover:bg-danger-500/10 flex items-center gap-3 transition active:bg-danger-500/20"
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
      <div className="flex-1 overflow-y-auto p-3 md:p-6 space-y-3 md:space-y-4 bg-midnight chat-messages-container">
        {/* Encryption notice */}
        <div className="flex justify-center mb-2 md:mb-4">
          {encryptionStatus === 'encrypted' ? (
            <div className="bg-success-500/10 border border-success-500/30 text-success-400 text-xs px-3 md:px-4 py-1.5 rounded-full flex items-center gap-2">
              <Lock size={12} />
              <span className="hidden md:inline">Messages are end-to-end encrypted</span>
              <span className="md:hidden">E2E Encrypted</span>
            </div>
          ) : encryptionStatus === 'unencrypted' ? (
            <div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs px-3 md:px-4 py-1.5 rounded-full flex items-center gap-2">
              <LockOpen size={12} />
              <span className="hidden md:inline">
                {isGroupChat 
                  ? 'Group messages are not yet encrypted' 
                  : 'Messages not encrypted - recipient needs to set up encryption'}
              </span>
              <span className="md:hidden">Not Encrypted</span>
            </div>
          ) : (
            <div className="bg-dark-200 border border-midnight text-muted text-xs px-3 md:px-4 py-1.5 rounded-full flex items-center gap-2">
              <Lock size={12} />
              <span className="hidden md:inline">Checking encryption status...</span>
            </div>
          )}
        </div>

        {filteredMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted">
            <p>{searchQuery ? 'No messages found matching your search.' : 'No messages yet. Start the conversation!'}</p>
          </div>
        ) : (
          filteredMessages.map((message, index) => {
            // Handle system messages (missed calls, etc.)
            if (message.type === 'system' || message.isSystemMessage) {
              // Determine the system message type - check both direct property and metadata
              const sysType = message.systemMessageType || 
                (message.metadata as any)?.systemMessageType;
              const callType = message.callType || 
                (message.metadata as any)?.callType || 'audio';
              
              return (
                <div key={message.id} className="flex justify-center my-4">
                  {(sysType === 'missed_call' || (!sysType && message.type === 'system')) && (
                    <div className="flex items-center gap-2 px-4 py-2 bg-red-500/20 rounded-full border border-red-500/40">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-red-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                      <span className="text-sm font-medium text-red-400">
                        Missed {callType === 'video' ? 'video' : 'voice'} call
                      </span>
                      <span className="text-sm text-red-300">
                        • {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                  {sysType === 'call_declined' && (
                    <div className="flex items-center gap-2 px-4 py-2 bg-orange-500/20 rounded-full border border-orange-500/40">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-orange-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                        <line x1="23" y1="1" x2="17" y2="7"/>
                        <line x1="17" y1="1" x2="23" y2="7"/>
                      </svg>
                      <span className="text-sm font-medium text-orange-400">
                        {callType === 'video' ? 'Video' : 'Voice'} call declined
                      </span>
                      <span className="text-sm text-orange-300">
                        • {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                  {sysType === 'call_ended' && (
                    <div className="flex items-center gap-2 px-4 py-2 bg-green-500/20 rounded-full border border-green-500/40">
                      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
                      </svg>
                      <span className="text-sm font-medium text-green-400">
                        {callType === 'video' ? 'Video' : 'Voice'} call ended
                      </span>
                      <span className="text-sm text-green-300">
                        • {new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  )}
                </div>
              );
            }
            
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

              // Handle encrypted group message marker that couldn't be decrypted
              if (message.content === '__ENCRYPTED_GROUP__') {
                return (
                  <div className="flex items-center gap-2 text-muted italic">
                    <Lock size={14} />
                    <span>Encrypted message</span>
                  </div>
                );
              }
              
              // Handle encrypted direct messages that couldn't be decrypted
              // They appear as base64 strings (no spaces, mostly alphanumeric with +/=)
              const looksEncrypted = /^[A-Za-z0-9+/=]{20,}$/.test(message.content) && 
                                    !message.content.includes(' ');
              if (looksEncrypted) {
                return (
                  <div className="flex items-center gap-2 text-muted italic">
                    <Lock size={14} />
                    <span>Encrypted message</span>
                  </div>
                );
              }

              return <p className="break-words">{renderTextWithLinks(message.content)}</p>;
            };

            return (
              <div
                key={message.id}
                className={`flex items-end gap-2 ${isSender ? 'flex-row-reverse' : 'flex-row'} group relative`}
                onContextMenu={(e) => handleMessageContextMenu(e, message.id, isSender)}
                onMouseEnter={() => setHoveredMessageId(message.id)}
                onMouseLeave={() => {
                  setHoveredMessageId(null);
                  setShowReactionPicker(null);
                }}
              >
                {showAvatar && !isSender && (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500/50 to-cyan-500/50 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 overflow-hidden">
                    {(() => {
                      // For group chats, get sender profile from memberProfiles
                      // For direct chats, use displayProfile (the other participant)
                      const senderProfile = isGroupChat 
                        ? memberProfiles.get(message.senderId.toLowerCase())
                        : displayProfile;
                      
                      if (senderProfile?.avatar) {
                        return <img src={senderProfile.avatar} alt="" className="w-full h-full object-cover" />;
                      }
                      return getInitials(senderProfile?.username || message.senderId);
                    })()}
                  </div>
                )}
                {!showAvatar && !isSender && <div className="w-8" />}

                <div className="relative">
                  {/* Quick reaction button on hover */}
                  {hoveredMessageId === message.id && (
                    <div className={`absolute ${isSender ? 'left-0 -translate-x-full pr-2' : 'right-0 translate-x-full pl-2'} top-1/2 -translate-y-1/2 z-10`}>
                      <button
                        onClick={() => setShowReactionPicker(showReactionPicker === message.id ? null : message.id)}
                        className="p-1.5 bg-dark-200 hover:bg-dark-100 rounded-full text-muted hover:text-white transition opacity-0 group-hover:opacity-100"
                        title="Add reaction"
                      >
                        <Smile size={16} />
                      </button>
                    </div>
                  )}
                  
                  {/* Reaction picker */}
                  {showReactionPicker === message.id && (
                    <div className={`absolute ${isSender ? 'right-0' : 'left-0'} -top-10 z-20 bg-card border border-midnight rounded-full px-2 py-1 flex gap-1 shadow-lg`}>
                      {quickReactions.map(emoji => (
                        <button
                          key={emoji}
                          onClick={() => handleAddReaction(message.id, emoji)}
                          className="p-1 hover:bg-dark-200 rounded-full transition text-lg"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  <div
                    className={`max-w-md px-4 py-2.5 rounded-2xl ${
                      isSender
                        ? 'bg-gradient-to-br from-primary-500 to-primary-600 text-white'
                        : 'bg-card border border-midnight text-white'
                    } ${selectedMessageId === message.id ? 'ring-2 ring-primary-400' : ''}`}
                  >
                    {/* Show sender name in group chats for received messages */}
                    {isGroupChat && !isSender && showAvatar && (
                      <p className="text-xs font-medium text-primary-400 mb-1">
                        {(() => {
                          const senderProfile = memberProfiles.get(message.senderId.toLowerCase());
                          if (senderProfile?.username) {
                            return `@${senderProfile.username}`;
                          }
                          return truncateAddress(message.senderId);
                        })()}
                      </p>
                    )}
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
                  
                  {/* Display reactions */}
                  {messageReactions.get(message.id)?.length > 0 && (
                    <div className={`flex flex-wrap gap-1 mt-1 ${isSender ? 'justify-end' : 'justify-start'}`}>
                      {Object.entries(
                        (messageReactions.get(message.id) || []).reduce((acc, r) => {
                          acc[r.emoji] = (acc[r.emoji] || 0) + 1;
                          return acc;
                        }, {} as Record<string, number>)
                      ).map(([emoji, count]) => (
                        <button
                          key={emoji}
                          onClick={() => handleAddReaction(message.id, emoji)}
                          className={`px-1.5 py-0.5 rounded-full text-xs flex items-center gap-1 transition ${
                            messageReactions.get(message.id)?.find(r => r.emoji === emoji && r.userId === currentUser?.walletAddress.toLowerCase())
                              ? 'bg-primary-500/30 border border-primary-500/50'
                              : 'bg-dark-200 border border-midnight hover:bg-dark-100'
                          }`}
                        >
                          <span>{emoji}</span>
                          {count > 1 && <span className="text-muted">{count}</span>}
                        </button>
                      ))}
                    </div>
                  )}
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
      <div className="bg-midnight-light border-t border-midnight p-3 md:p-4 pb-safe flex-shrink-0 chat-input-container">
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          className="hidden"
          accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.txt"
        />
        
        <form onSubmit={handleSendMessage} className="flex items-center gap-2 md:gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 hover:bg-dark-200 rounded-xl transition text-secondary hover:text-white active:bg-dark-100 flex-shrink-0"
            title="Attach file"
          >
            <Paperclip size={20} />
          </button>
          
          <div className="relative hidden md:block">
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
            <div className="flex-1 flex items-center gap-2 md:gap-3 px-3 md:px-4 py-2.5 md:py-3 bg-danger-500/20 border border-danger-500/50 rounded-xl">
              <div className="w-3 h-3 rounded-full bg-danger-500 animate-pulse flex-shrink-0" />
              <span className="text-white font-medium text-sm md:text-base">{formatDuration(recordingDuration)}</span>
              <span className="text-secondary text-xs md:text-sm flex-1 truncate">Recording...</span>
              <button
                type="button"
                onClick={handleCancelRecording}
                className="p-2 hover:bg-danger-500/30 rounded-lg transition text-danger-500 active:bg-danger-500/40 flex-shrink-0"
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
              className="flex-1 min-w-0 px-3 md:px-4 py-2.5 md:py-3 bg-card border border-midnight rounded-xl text-white placeholder-muted focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition text-base"
              style={{ fontSize: '16px' }} // Prevents iOS zoom on focus
            />
          )}
          <button
            type="button"
            onClick={handleVoiceRecordToggle}
            disabled={isSending}
            className={`p-2.5 rounded-xl transition flex-shrink-0 ${
              isRecording 
                ? 'bg-danger-500 text-white hover:bg-danger-600 animate-pulse' 
                : 'hover:bg-dark-200 text-secondary hover:text-white active:bg-dark-100'
            }`}
            title={isRecording ? "Stop recording" : "Voice message"}
          >
            {isRecording ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
          <button
            type="submit"
            disabled={(!messageText.trim() && !isRecording) || isSending}
            className="p-2.5 md:p-3 bg-gradient-to-r from-primary-500 to-cyan-500 text-white rounded-xl hover:shadow-glow transition disabled:opacity-50 disabled:cursor-not-allowed active:opacity-80 flex-shrink-0"
          >
            <Send size={20} />
          </button>
        </form>
      </div>

      {/* Group Settings Modal */}
      {isGroupChat && activeConversation && (
        <GroupSettingsModal
          isOpen={showGroupSettings}
          onClose={() => setShowGroupSettings(false)}
          conversation={activeConversation}
        />
      )}

      {/* User Profile Modal */}
      {!isGroupChat && otherParticipant && (
        <UserProfileModal
          isOpen={showProfileModal}
          onClose={() => setShowProfileModal(false)}
          walletAddress={otherParticipant}
          onAddContact={async () => {
            const added = await addToContacts(otherParticipant);
            if (added) {
              setIsUserContact(true);
              toast.success('Added to contacts!');
            }
          }}
          isContact={isUserContact}
        />
      )}
    </div>
  );
}
