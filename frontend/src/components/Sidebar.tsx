import React, { useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import { db, dbHelpers } from '@/lib/database';
import { Conversation } from '@/types';
import { Search, Plus, Settings, LogOut, X, MessageSquarePlus, Lock, ExternalLink, Globe, Mail, Twitter, MessageSquare, Trash2, Users, ExternalLinkIcon, BookUser, Radio } from 'lucide-react';
import { truncateAddress, formatTimestamp, getInitials, getAvatarColor, generateConversationId } from '@/utils/helpers';
import { blockchainService } from '@/lib/blockchain';
import { resolveProfile, getProfileByWallet, type BlockStarProfile } from '@/lib/profileResolver';
import { groupChatService } from '@/lib/group-chat-service';
import { webSocketService } from '@/lib/websocket';
import { encryptionService } from '@/lib/encryption';
import toast from 'react-hot-toast';
import { useSettingReslover } from '@/hooks/useSetting';
import { resolveAccountDisplay } from '@/utils/constant';
import ContactsSection from './ContactsSection';
import UserProfileModal from './UserProfileModal';
import { addToContacts, isContact } from './ContactsSection';
import MeshStatusIndicator from './MeshStatusIndicator';
import MeshQRConnect from './MeshQRConnect';

// Cache for decrypted message previews
const decryptedPreviewCache = new Map<string, string>();

// Track deleted conversations to prevent them from reappearing
const DELETED_CONVERSATIONS_KEY = 'blockstar_deleted_conversations';

// Get deleted conversations for current user
export const getDeletedConversations = (walletAddress?: string): Set<string> => {
  try {
    const key = walletAddress 
      ? `${DELETED_CONVERSATIONS_KEY}_${walletAddress.toLowerCase()}`
      : DELETED_CONVERSATIONS_KEY;
    const stored = localStorage.getItem(key);
    if (stored) {
      return new Set(JSON.parse(stored));
    }
  } catch (e) {
    console.warn('Failed to load deleted conversations:', e);
  }
  return new Set();
};

// Add a conversation to deleted list for current user
export const addDeletedConversation = (conversationId: string, walletAddress?: string) => {
  const key = walletAddress 
    ? `${DELETED_CONVERSATIONS_KEY}_${walletAddress.toLowerCase()}`
    : DELETED_CONVERSATIONS_KEY;
  const deleted = getDeletedConversations(walletAddress);
  deleted.add(conversationId);
  localStorage.setItem(key, JSON.stringify([...deleted]));
  console.log(`🗑️ Added ${conversationId} to deleted list for ${walletAddress || 'unknown'}`);
};

// Check if a conversation is deleted
export const isConversationDeleted = (conversationId: string, walletAddress?: string): boolean => {
  return getDeletedConversations(walletAddress).has(conversationId);
};

// Remove a conversation from deleted list (when new message arrives)
export const removeFromDeletedConversations = (conversationId: string, walletAddress?: string) => {
  const key = walletAddress 
    ? `${DELETED_CONVERSATIONS_KEY}_${walletAddress.toLowerCase()}`
    : DELETED_CONVERSATIONS_KEY;
  const deleted = getDeletedConversations(walletAddress);
  if (deleted.has(conversationId)) {
    deleted.delete(conversationId);
    localStorage.setItem(key, JSON.stringify([...deleted]));
    console.log(`📬 Removed ${conversationId} from deleted list - new message received`);
  }
};

export default function Sidebar() {
  const { currentUser, conversations, setActiveConversation, activeConversationId, setConversations, addConversation } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([]);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [newChatAddress, setNewChatAddress] = useState('');
  const [userProfile, setUserProfile] = useState<BlockStarProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [contactProfiles, setContactProfiles] = useState<Record<string, BlockStarProfile | null>>({});
  const [hoveredConversation, setHoveredConversation] = useState<string | null>(null);
  const domainName = currentUser?.username ? currentUser.username.includes('@') ? currentUser.username.split('@')[0] : currentUser.username : "";
  const stats = useSettingReslover(domainName || '');



  // Group chat state
  const [chatMode, setChatMode] = useState<'direct' | 'group'>('direct');
  const [groupName, setGroupName] = useState('');
  const [groupAvatar, setGroupAvatar] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [memberInput, setMemberInput] = useState('');
  const [groupMemberProfiles, setGroupMemberProfiles] = useState<Record<string, BlockStarProfile | null>>({});
  const [groupAddMode, setGroupAddMode] = useState<'search' | 'contacts'>('search');
  const [availableContacts, setAvailableContacts] = useState<Array<{ walletAddress: string; nickname?: string; profile?: BlockStarProfile | null }>>([]);
  // Tab state for Messages vs Contacts
  const [activeTab, setActiveTab] = useState<'messages' | 'contacts'>('messages');
  
  // Profile modal state
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [selectedProfileAddress, setSelectedProfileAddress] = useState<string | null>(null);

  // Mesh network state
  const [showMeshQRConnect, setShowMeshQRConnect] = useState(false);

  // Load contacts for group creation when switching to group mode
  useEffect(() => {
    const loadContactsForGroup = async () => {
      if (chatMode !== 'group' || !currentUser?.walletAddress) return;
      
      try {
        const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
        const response = await fetch(`${API_URL}/api/contacts/${currentUser.walletAddress.toLowerCase()}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.contacts) {
            const contactsWithProfiles = await Promise.all(
              data.contacts.map(async (c: any) => {
                let profile = getProfileByWallet(c.contact_wallet);
                if (!profile) {
                  try {
                    const profileResponse = await fetch(`${API_URL}/api/profile/${c.contact_wallet}`);
                    if (profileResponse.ok) {
                      const profileData = await profileResponse.json();
                      if (profileData.success && profileData.profile?.nftName) {
                        profile = await resolveProfile(profileData.profile.nftName);
                      }
                    }
                  } catch {
                    // Continue without profile
                  }
                }
                return {
                  walletAddress: c.contact_wallet,
                  nickname: c.nickname,
                  profile,
                };
              })
            );
            setAvailableContacts(contactsWithProfiles);
          }
        }
      } catch (error) {
        console.error('Error loading contacts for group:', error);
      }
    };
    
    loadContactsForGroup();
  }, [chatMode, currentUser?.walletAddress]);

  // Load conversations when component mounts or currentUser changes
  useEffect(() => {
    if (currentUser?.walletAddress) {
      loadConversations();
    }
  }, [currentUser?.walletAddress]);

  // Listen for group:created events when another user adds us to a group
  useEffect(() => {
    const unsubscribe = webSocketService.on('group:created', (data: { group: any; createdBy: string }) => {
      console.log('📢 Received group:created event:', data);

      // Check if we're already have this group
      const existingConv = conversations.find(c => c.id === data.group.id);
      if (existingConv) {
        console.log('Group already exists in conversations');
        return;
      }

      // Add the group to our conversations
      const newGroup: Conversation = {
        id: data.group.id,
        type: 'group',
        participants: data.group.participants,
        groupName: data.group.groupName,
        groupAvatar: data.group.groupAvatar,
        admins: data.group.admins,
        createdBy: data.group.createdBy,
        unreadCount: 0,
        createdAt: data.group.createdAt || Date.now(),
        updatedAt: data.group.updatedAt || Date.now(),
      };

      // Save locally
      db.conversations.put(newGroup);

      // Add to state
      addConversation(newGroup);

      toast.success(`You were added to group "${data.group.groupName}"`, { duration: 4000 });
    });

    return () => unsubscribe();
  }, [conversations, addConversation]);

  // Listen for group:avatar:updated events
  useEffect(() => {
    const unsubscribe = webSocketService.on('group:avatar:updated', (data: { groupId: string; avatarUrl: string; updatedBy: string }) => {
      console.log('🖼️ Received group:avatar:updated event:', data);

      // Update the conversation with the new avatar
      useAppStore.getState().updateConversation(data.groupId, { 
        groupAvatar: data.avatarUrl,
        avatar: data.avatarUrl 
      });

      // Also update in database
      db.conversations.update(data.groupId, { 
        groupAvatar: data.avatarUrl,
        avatar: data.avatarUrl 
      }).catch(console.error);
    });

    return () => unsubscribe();
  }, []);

  // Load current user profile immediately
  useEffect(() => {
    if (currentUser?.username) {
      const domainName = currentUser.username.includes('@')
        ? currentUser.username.split('@')[0]
        : currentUser.username;

      resolveProfile(domainName)
        .then((profile) => {
          setUserProfile(profile);
        })
        .catch((err) => {
          console.error('Error loading profile:', err);
        });
    }
  }, [currentUser?.username]);

  // Load contact profiles for all conversations
  useEffect(() => {
    const loadContactProfiles = async () => {
      if (!currentUser || conversations.length === 0) return;

      const addresses = conversations
        .filter(conv => conv.type !== 'group') // Only direct conversations
        .map(conv => conv.participants.find(p => p.toLowerCase() !== currentUser.walletAddress.toLowerCase()))
        .filter((addr): addr is string => !!addr);

      for (const address of addresses) {
        const normalizedAddress = address.toLowerCase();
        
        // FIRST check local wallet cache (populated when @name was resolved)
        // This must happen before checking state, because state might have null from previous lookup
        const cachedProfile = getProfileByWallet(address);
        if (cachedProfile) {
          // Update state if we have a cached profile (even if state was null before)
          const currentProfile = contactProfiles[normalizedAddress];
          if (currentProfile !== cachedProfile) {
            setContactProfiles(prev => ({ ...prev, [normalizedAddress]: cachedProfile }));
          }
          continue;
        }
        
        // Skip if already checked (and no cache available)
        if (contactProfiles[normalizedAddress] !== undefined) continue;

        try {
          // Try to resolve by looking up if they have an NFT name in our database
          const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
          const response = await fetch(`${API_URL}/api/profile/${address}`);

          if (response.ok) {
            const data = await response.json();
            if (data.success && data.profile?.nftName) {
              const profile = await resolveProfile(data.profile.nftName);
              setContactProfiles(prev => ({ ...prev, [normalizedAddress]: profile }));
              continue;
            }
          }

          // Mark as no profile found
          setContactProfiles(prev => ({ ...prev, [normalizedAddress]: null }));
        } catch (error) {
          setContactProfiles(prev => ({ ...prev, [normalizedAddress]: null }));
        }
      }
    };

    loadContactProfiles();
  }, [conversations, currentUser]);

  // Refresh user profile when settings modal opens (in case it changed)
  useEffect(() => {
    if (showSettingsModal && currentUser?.username && !userProfile) {
      setLoadingProfile(true);
      const domainName = currentUser.username.includes('@')
        ? currentUser.username.split('@')[0]
        : currentUser.username;

      resolveProfile(domainName)
        .then((profile) => {
          setUserProfile(profile);
          setLoadingProfile(false);
        })
        .catch((err) => {
          console.error('Error loading profile:', err);
          setLoadingProfile(false);
        });
    }
  }, [showSettingsModal, currentUser?.username, userProfile]);

  useEffect(() => {
    // Sort conversations by most recent first (updatedAt or lastMessage timestamp)
    const sortByRecent = (convs: Conversation[]) => {
      return [...convs].sort((a, b) => {
        const aTime = a.updatedAt || (a as any).lastMessage?.timestamp || a.createdAt || 0;
        const bTime = b.updatedAt || (b as any).lastMessage?.timestamp || b.createdAt || 0;
        return bTime - aTime; // Most recent first
      });
    };
    
    if (searchQuery) {
      setFilteredConversations(
        sortByRecent(conversations.filter((conv) =>
          conv.participants.some((p) =>
            p.toLowerCase().includes(searchQuery.toLowerCase())
          ) || (conv as any).groupName?.toLowerCase().includes(searchQuery.toLowerCase())
        ))
      );
    } else {
      setFilteredConversations(sortByRecent(conversations));
    }
  }, [searchQuery, conversations]);

  const loadConversations = async () => {
    if (!currentUser?.walletAddress) return;
    
    try {
      const deletedIds = getDeletedConversations(currentUser.walletAddress);
      let allConversations = await db.conversations.toArray();
      
      // Filter out deleted conversations
      allConversations = allConversations.filter(c => !deletedIds.has(c.id));

      // Always try to sync from server to catch conversations from other devices
      const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

      try {
        const response = await fetch(`${API_URL}/api/conversations/${currentUser.walletAddress}`);

        if (response.ok) {
          const data = await response.json();
          console.log('Server conversations:', data.conversations);
          if (data.success && data.conversations?.length > 0) {
            for (const serverConv of data.conversations) {
              // Skip if deleted locally
              if (deletedIds.has(serverConv.id)) continue;
              
              // Check if we already have this conversation locally
              const existingLocal = allConversations.find(c => c.id === serverConv.id);
              
              const conversation: Conversation = {
                id: serverConv.id,
                type: serverConv.type || 'direct',
                participants: serverConv.participants,
                name: serverConv.name,
                unreadCount: existingLocal?.unreadCount || 0,
                createdAt: serverConv.createdAt,
                updatedAt: serverConv.updatedAt,
                // Group-specific fields
                groupName: serverConv.groupName || serverConv.name,
                groupAvatar: serverConv.groupAvatar || serverConv.avatarUrl,
                admins: serverConv.admins,
                createdBy: serverConv.createdBy,
                lastMessage: serverConv.lastMessage ? {
                  id: serverConv.lastMessage.id,
                  conversationId: serverConv.id,
                  senderId: serverConv.lastMessage.senderWallet,
                  recipientId: serverConv.participants.find((p: string) => p !== serverConv.lastMessage.senderWallet) || '',
                  content: serverConv.lastMessage.content,
                  timestamp: serverConv.lastMessage.timestamp,
                  type: serverConv.lastMessage.type || 'text',
                  delivered: true,
                  read: false,
                } : existingLocal?.lastMessage,
              };

              await db.conversations.put(conversation);
            }

            allConversations = await db.conversations.toArray();
            // Filter again after fetching
            allConversations = allConversations.filter(c => !deletedIds.has(c.id));
          }
        }
      } catch (fetchError) {
        console.warn('Could not fetch from server:', fetchError);
      }

      const sorted = allConversations.sort((a, b) => b.updatedAt - a.updatedAt);
      setConversations(sorted);
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };

  const handleStartNewChat = async () => {
    if (!newChatAddress.trim()) {
      toast.error('Please enter a wallet address or @name');
      return;
    }
    
    // Prevent double submission
    if (loadingProfile) return;
    setLoadingProfile(true);

    let targetAddress = newChatAddress.trim();

    // Check if it's an @name format (e.g., "@david", "david@blockstar" or just "david")
    if (!targetAddress.startsWith('0x')) {
      // It's an @name - need to resolve to wallet address
      toast.loading('Looking up @name...', { id: 'name-lookup' });

      try {
        // Extract the name part (handle "@david", "david@blockstar" or just "david")
        let nameToResolve = targetAddress.trim();
        
        if (nameToResolve.startsWith('@')) {
          nameToResolve = nameToResolve.slice(1); // Remove leading @
        }
        
        if (nameToResolve.includes('@')) {
          // "ashish@blockstar" → "ashish"
          nameToResolve = nameToResolve.split('@')[0];
        }

        const profile = await resolveProfile(nameToResolve);

        if (profile && profile.walletAddress) {
          targetAddress = profile.walletAddress.toLowerCase();
          toast.success(`Found: @${profile.username}`, { id: 'name-lookup' });
          // Set in contactProfiles state for immediate display
          setContactProfiles(prev => ({ ...prev, [targetAddress.toLowerCase()]: profile }));
        } else {
          toast.error(`Could not find @${nameToResolve}`, { id: 'name-lookup' });
          setLoadingProfile(false);
          return;
        }
      } catch (error) {
        toast.error('Failed to look up @name', { id: 'name-lookup' });
        setLoadingProfile(false);
        return;
      }
    } else {
      // It's a wallet address - validate format
      if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
        toast.error('Invalid wallet address format');
        setLoadingProfile(false);
        return;
      }
      targetAddress = targetAddress.toLowerCase();
      
      // Try to look up profile for this wallet address
      try {
        const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
        const profileResponse = await fetch(`${API_URL}/api/profile/${targetAddress}`);
        if (profileResponse.ok) {
          const profileData = await profileResponse.json();
          if (profileData.success && profileData.profile?.nftName) {
            // Resolve the full profile to cache it
            const profile = await resolveProfile(profileData.profile.nftName);
            if (profile) {
              toast.success(`Found: @${profile.username}`, { id: 'wallet-lookup' });
              // Also set in contactProfiles state for immediate display
              setContactProfiles(prev => ({ ...prev, [targetAddress.toLowerCase()]: profile }));
            }
          }
        }
      } catch (error) {
        // Not critical - continue without profile
        console.log('Could not resolve profile for wallet:', error);
      }
    }

    if (targetAddress.toLowerCase() === currentUser?.walletAddress.toLowerCase()) {
      toast.error("You can't chat with yourself");
      setLoadingProfile(false);
      return;
    }

    try {
      const address = targetAddress.toLowerCase();
      const myAddress = currentUser!.walletAddress.toLowerCase();

      // Check for existing conversation (including in IndexedDB)
      let existingConv = conversations.find(conv =>
        conv.type === 'direct' &&
        conv.participants.map(p => p.toLowerCase()).includes(address) && 
        conv.participants.map(p => p.toLowerCase()).includes(myAddress)
      );
      
      // Also check IndexedDB directly
      if (!existingConv) {
        const allConvs = await db.conversations.toArray();
        existingConv = allConvs.find(conv =>
          conv.type === 'direct' &&
          conv.participants.map(p => p.toLowerCase()).includes(address) && 
          conv.participants.map(p => p.toLowerCase()).includes(myAddress)
        );
      }

      if (existingConv) {
        setActiveConversation(existingConv.id);
        setShowNewChatModal(false);
        setNewChatAddress('');
        setLoadingProfile(false);
        toast.success('Opened existing conversation');
        return;
      }

      const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      let conversationId: string;

      try {
        const response = await fetch(`${API_URL}/api/conversations/direct`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user1: myAddress, user2: address }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.conversation) {
            conversationId = data.conversation.id;
            
            // Check if this conversation ID already exists
            const existing = conversations.find(c => c.id === conversationId);
            if (existing) {
              setActiveConversation(conversationId);
              setShowNewChatModal(false);
              setNewChatAddress('');
              setLoadingProfile(false);
              toast.success('Opened existing conversation');
              return;
            }
          } else {
            throw new Error('Invalid server response');
          }
        } else {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (serverError) {
        conversationId = generateConversationId(myAddress, address);
      }

      const newConversation: Conversation = {
        id: conversationId,
        type: 'direct',
        participants: [myAddress, address],
        unreadCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await db.conversations.put(newConversation);
      addConversation(newConversation);
      setActiveConversation(conversationId);

      setShowNewChatModal(false);
      setNewChatAddress('');
      setLoadingProfile(false);
      toast.success('New conversation created!');
    } catch (error) {
      console.error('Error creating conversation:', error);
      toast.error('Failed to create conversation');
      setLoadingProfile(false);
    }
  };

  // Group chat functions
  const handleAddMember = async () => {
    if (!memberInput.trim()) return;

    let memberAddress = memberInput.trim();
    let memberProfile: BlockStarProfile | null = null;

    // Resolve @name to address
    if (!memberAddress.startsWith('0x')) {
      toast.loading('Looking up @name...', { id: 'member-lookup' });

      try {
        // Extract the name part (handle "@kelly", "kelly@blockstar" or just "kelly")
        let nameToResolve = memberAddress;
        
        if (nameToResolve.startsWith('@')) {
          nameToResolve = nameToResolve.slice(1); // Remove leading @
        }
        
        if (nameToResolve.includes('@')) {
          nameToResolve = nameToResolve.split('@')[0]; // Get part before @
        }

        const profile = await resolveProfile(nameToResolve);

        if (profile && profile.walletAddress) {
          memberAddress = profile.walletAddress.toLowerCase();
          memberProfile = profile;
          toast.success(`Added: @${profile.username}`, { id: 'member-lookup' });
        } else {
          toast.error(`Could not find @${nameToResolve}`, { id: 'member-lookup' });
          return;
        }
      } catch (error) {
        toast.error('Failed to look up @name', { id: 'member-lookup' });
        return;
      }
    } else {
      // Validate wallet address
      if (!/^0x[a-fA-F0-9]{40}$/.test(memberAddress)) {
        toast.error('Invalid wallet address format');
        return;
      }
      memberAddress = memberAddress.toLowerCase();
      
      // Try to look up profile for this wallet address
      toast.loading('Looking up wallet...', { id: 'member-lookup' });
      try {
        const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
        const profileResponse = await fetch(`${API_URL}/api/profile/${memberAddress}`);
        if (profileResponse.ok) {
          const profileData = await profileResponse.json();
          if (profileData.success && profileData.profile?.nftName) {
            // Resolve the full profile
            memberProfile = await resolveProfile(profileData.profile.nftName);
            if (memberProfile) {
              toast.success(`Added: @${memberProfile.username}`, { id: 'member-lookup' });
            } else {
              toast.success('Member added', { id: 'member-lookup' });
            }
          } else {
            toast.success('Member added', { id: 'member-lookup' });
          }
        } else {
          toast.success('Member added', { id: 'member-lookup' });
        }
      } catch (error) {
        toast.success('Member added', { id: 'member-lookup' });
      }
    }

    // Check not self
    if (memberAddress === currentUser?.walletAddress.toLowerCase()) {
      toast.error("You'll be added automatically");
      return;
    }

    // Check not already added
    if (groupMembers.includes(memberAddress)) {
      toast.error('Member already added');
      return;
    }

    setGroupMembers([...groupMembers, memberAddress]);
    setGroupMemberProfiles(prev => ({ ...prev, [memberAddress]: memberProfile }));
    setMemberInput('');
  };

  const handleRemoveMember = (address: string) => {
    setGroupMembers(groupMembers.filter(m => m !== address));
    setGroupMemberProfiles(prev => {
      const updated = { ...prev };
      delete updated[address];
      return updated;
    });
  };

  const addContactToGroup = (contact: { walletAddress: string; nickname?: string; profile?: BlockStarProfile | null }) => {
    const memberAddress = contact.walletAddress.toLowerCase();
    
    // Check not self
    if (memberAddress === currentUser?.walletAddress.toLowerCase()) {
      toast.error("You'll be added automatically");
      return;
    }
    
    // Check not already added
    if (groupMembers.includes(memberAddress)) {
      toast.error('Member already added');
      return;
    }
    
    setGroupMembers([...groupMembers, memberAddress]);
    setGroupMemberProfiles(prev => ({ ...prev, [memberAddress]: contact.profile || null }));
    
    const displayName = contact.profile?.username 
      ? `@${contact.profile.username}` 
      : contact.nickname || truncateAddress(memberAddress);
    toast.success(`Added: ${displayName}`);
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) {
      toast.error('Please enter a group name');
      return;
    }

    if (groupMembers.length === 0) {
      toast.error('Please add at least one member');
      return;
    }

    try {
      toast.loading('Creating group...', { id: 'create-group' });

      const group = await groupChatService.createGroup(
        groupName.trim(),
        groupMembers,
        undefined, // description
        groupAvatar || undefined // avatar
      );

      addConversation(group);
      setActiveConversation(group.id);

      // Reset state
      setShowNewChatModal(false);
      setGroupName('');
      setGroupMembers([]);
      setChatMode('direct');

      toast.success('Group created!', { id: 'create-group' });
    } catch (error) {
      console.error('Error creating group:', error);
      toast.error('Failed to create group', { id: 'create-group' });
    }
  };

  const resetNewChatModal = () => {
    setShowNewChatModal(false);
    setNewChatAddress('');
    setGroupName('');
    setGroupAvatar('');
    setGroupMembers([]);
    setGroupMemberProfiles({});
    setMemberInput('');
    setChatMode('direct');
    setGroupAddMode('search');
  };

  const handleLogout = () => {
    blockchainService.disconnect();
    useAppStore.getState().reset();
    window.location.reload();
  };

  const handleDeleteConversation = async (e: React.MouseEvent, conversationId: string) => {
    e.stopPropagation();

    if (!confirm('Remove this conversation from your list? (Messages will still exist for the other user)')) {
      return;
    }

    try {
      // Track this as deleted so it won't reappear on refresh (user-specific)
      addDeletedConversation(conversationId, currentUser?.walletAddress);
      
      // Call backend to hide conversation for this user
      const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
      try {
        await fetch(`${API_URL}/api/conversations/${conversationId}/hide`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ walletAddress: currentUser?.walletAddress?.toLowerCase() }),
        });
      } catch (apiError) {
        console.warn('Could not notify server of deletion:', apiError);
      }
      
      // Delete locally
      await db.conversations.delete(conversationId);
      await db.messages.where('conversationId').equals(conversationId).delete();

      // Clear from local cache
      dbHelpers.clearMessageCache(conversationId);

      // Update local state
      const updated = conversations.filter(c => c.id !== conversationId);
      setConversations(updated);

      // Clear active conversation if it was deleted
      if (activeConversationId === conversationId) {
        setActiveConversation(updated.length > 0 ? updated[0].id : null);
      }

      toast.success('Conversation removed');
    } catch (error) {
      console.error('Error removing conversation:', error);
      toast.error('Failed to remove conversation');
    }
  };

  const getProfileAvatar = () => {
    if (stats?.profile) {
      return (
        <img
          src={stats?.profile}
          alt={stats?.main_domain || 'Profile'}
          className="w-full h-full object-cover rounded-full"
        />
      );
    }
    return (
      <span className="text-white font-semibold text-lg">
        {getInitials(stats?.main_domain || currentUser?.walletAddress || '')}
      </span>
    );
  };

  return (
    <>
      <div className="w-80 bg-midnight-light border-r border-midnight flex flex-col h-screen">
        {/* Header */}
        <div className="p-4 border-b border-midnight">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold text-white">Messages</h1>
            <div className="flex gap-1">
              <button
                onClick={() => setShowNewChatModal(true)}
                className="p-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition-all hover:shadow-glow"
                title="New Chat"
              >
                <Plus size={18} />
              </button>
              <button
                onClick={() => setShowSettingsModal(true)}
                className="p-2 hover:bg-dark-200 text-secondary hover:text-white rounded-lg transition"
                title="Settings"
              >
                <Settings size={18} />
              </button>
              <button
                onClick={handleLogout}
                className="p-2 hover:bg-dark-200 text-secondary hover:text-white rounded-lg transition"
                title="Logout"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>

          {/* Mesh Network Status */}
          <div className="mb-3">
            <MeshStatusIndicator onOpenQRConnect={() => setShowMeshQRConnect(true)} />
          </div>

          {/* Current User */}
          {currentUser && (
            <div className="flex items-center gap-3 mb-4 p-3 bg-card rounded-xl border border-midnight">
              <div className="w-10 h-10 rounded-full border flex items-center justify-center overflow-hidden">
                {stats.profile ? (
                  <img
                    src={stats.profile}
                    alt={currentUser.username || 'Profile'}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-white font-semibold text-sm">
                    {getInitials(currentUser.username || currentUser.walletAddress)}
                  </span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-white truncate">{currentUser.username || 'Anonymous'}</p>
                <p className="text-xs text-secondary truncate">{truncateAddress(currentUser.walletAddress)}</p>
              </div>
              <div className="w-2 h-2 rounded-full bg-success-500 shadow-glow-green"></div>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-midnight rounded-xl text-white placeholder-muted focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition"
            />
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => setActiveTab('messages')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl transition ${
                activeTab === 'messages'
                  ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                  : 'bg-card text-secondary hover:text-white border border-midnight'
              }`}
            >
              <MessageSquare size={16} />
              <span className="text-sm font-medium">Messages</span>
            </button>
            <button
              onClick={() => setActiveTab('contacts')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl transition ${
                activeTab === 'contacts'
                  ? 'bg-primary-500/20 text-primary-400 border border-primary-500/30'
                  : 'bg-card text-secondary hover:text-white border border-midnight'
              }`}
            >
              <BookUser size={16} />
              <span className="text-sm font-medium">Contacts</span>
            </button>
          </div>
        </div>

        {/* Content based on active tab */}
        {activeTab === 'contacts' ? (
          <ContactsSection />
        ) : (
          <>
        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted px-4">
              <MessageSquarePlus size={48} className="mb-4 text-dark-100" />
              <p className="text-center font-medium text-secondary">No conversations yet</p>
              <p className="text-sm text-center mt-1 mb-4">Start a new chat to begin messaging</p>
              <button
                onClick={() => setShowNewChatModal(true)}
                className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition flex items-center gap-2 shadow-glow"
              >
                <Plus size={18} />
                New Chat
              </button>
            </div>
          ) : (
            filteredConversations.map((conversation) => {
              const isGroup = conversation.type === 'group';
              const groupConv = conversation as any; // Type assertion for group properties
              const otherParticipant = !isGroup ? conversation.participants.find(
                (p) => p.toLowerCase() !== currentUser?.walletAddress.toLowerCase()
              ) : null;
              const isActive = conversation.id === activeConversationId;
              
              // Check contactProfiles state first, then fall back to wallet cache
              const stateProfile = otherParticipant ? contactProfiles[otherParticipant.toLowerCase()] : null;
              const contactProfile = stateProfile || (otherParticipant ? getProfileByWallet(otherParticipant) : null);

              return (
                <div
                  key={conversation.id}
                  onClick={() => setActiveConversation(conversation.id)}
                  onMouseEnter={() => setHoveredConversation(conversation.id)}
                  onMouseLeave={() => setHoveredConversation(null)}
                  className={`p-4 border-b border-midnight cursor-pointer transition-all relative ${isActive
                    ? 'bg-primary-500/10 border-l-2 border-l-primary-500'
                    : 'hover:bg-card'
                    }`}
                >
                  <div className="flex items-start gap-3">
                    <div 
                      className={`w-12 h-12 rounded-full flex items-center justify-center text-white font-semibold flex-shrink-0 overflow-hidden cursor-pointer hover:ring-2 hover:ring-primary-500 transition ${isGroup
                        ? 'bg-gradient-to-br from-purple-500/50 to-pink-500/50'
                        : 'bg-gradient-to-br from-primary-500/50 to-cyan-500/50'
                        }`}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!isGroup && otherParticipant) {
                          setSelectedProfileAddress(otherParticipant);
                          setShowProfileModal(true);
                        }
                      }}
                      title={isGroup ? 'Group Chat' : 'View Profile'}
                    >
                      {isGroup ? (
                        (groupConv.groupAvatar || groupConv.avatar) ? (
                          <img
                            src={groupConv.groupAvatar || groupConv.avatar}
                            alt={groupConv.groupName || 'Group'}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <Users size={20} />
                        )
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
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <div className="truncate">
                          {isGroup ? (
                            <>
                              <p className="font-semibold text-white truncate">{groupConv.groupName || 'Group Chat'}</p>
                              <p className="text-xs text-muted truncate">{conversation.participants.length} members</p>
                            </>
                          ) : contactProfile?.username ? (
                            <>
                              <p className="font-semibold text-white truncate">@{contactProfile.username}</p>
                              <p className="text-xs text-muted truncate">{truncateAddress(otherParticipant || '')}</p>
                            </>
                          ) : (
                            <p className="font-semibold text-white truncate">
                              {truncateAddress(otherParticipant || '')}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {conversation.lastMessage && (
                            <span className="text-xs text-muted">
                              {formatTimestamp(conversation.lastMessage.timestamp)}
                            </span>
                          )}
                          {conversation.unreadCount > 0 && !isActive && (
                            <span className="min-w-[20px] h-5 px-1.5 bg-primary-500 text-white text-xs font-bold rounded-full flex items-center justify-center">
                              {conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}
                            </span>
                          )}
                          {hoveredConversation === conversation.id && (
                            <button
                              onClick={(e) => handleDeleteConversation(e, conversation.id)}
                              className="p-1 hover:bg-danger-500/20 rounded transition"
                              title="Delete conversation"
                            >
                              <Trash2 size={14} className="text-danger-500" />
                            </button>
                          )}
                        </div>
                      </div>
                      {conversation.lastMessage ? (
                        <p className="text-sm text-secondary truncate">
                          {(() => {
                            const content = conversation.lastMessage.content;
                            // Handle non-string content (like JSON objects for voice/file messages)
                            if (typeof content !== 'string') {
                              return '📎 Attachment';
                            }
                            // Check if it's a JSON voice/file message
                            if (content.startsWith('{"type":"voice"')) {
                              return '🎤 Voice message';
                            }
                            if (content.startsWith('{"type":') || content.startsWith('{"url":')) {
                              return '📎 Attachment';
                            }
                            // Check if content looks like encrypted (base64 with no spaces)
                            // const looksEncrypted = /^[A-Za-z0-9+/=]+$/.test(content) &&
                            //   content.length > 20 &&
                            //   !content.includes(' ');
                            // if (looksEncrypted) {
                            //   return '🔒 Encrypted message';
                            // }
                            // Regular text message
                            const displayContent = content.substring(0, 40);
                            return displayContent + (content.length > 40 ? '...' : '');
                          })()}
                        </p>
                      ) : (
                        <p className="text-sm text-muted italic">No messages yet</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
          </>
        )}
      </div>

      {/* User Profile Modal */}
      {selectedProfileAddress && (
        <UserProfileModal
          isOpen={showProfileModal}
          onClose={() => {
            setShowProfileModal(false);
            setSelectedProfileAddress(null);
          }}
          walletAddress={selectedProfileAddress}
          onStartChat={async () => {
            if (!currentUser || !selectedProfileAddress) return;
            
            const address = selectedProfileAddress.toLowerCase();
            const myAddress = currentUser.walletAddress.toLowerCase();
            
            // Check for existing conversation
            let existingConv = conversations.find(conv =>
              conv.type === 'direct' &&
              conv.participants.map(p => p.toLowerCase()).includes(address) && 
              conv.participants.map(p => p.toLowerCase()).includes(myAddress)
            );
            
            if (existingConv) {
              setActiveConversation(existingConv.id);
              return;
            }
            
            // Create new conversation via API
            const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
            let conversationId: string;
            
            try {
              const response = await fetch(`${API_URL}/api/conversations/direct`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user1: myAddress, user2: address }),
              });
              
              if (response.ok) {
                const data = await response.json();
                if (data.success && data.conversation) {
                  conversationId = data.conversation.id;
                } else {
                  conversationId = generateConversationId(myAddress, address);
                }
              } else {
                conversationId = generateConversationId(myAddress, address);
              }
            } catch (error) {
              conversationId = generateConversationId(myAddress, address);
            }
            
            // Create the conversation object
            const newConversation: Conversation = {
              id: conversationId,
              type: 'direct',
              participants: [myAddress, address],
              unreadCount: 0,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            };
            
            // Save to database and store
            await db.conversations.put(newConversation);
            addConversation(newConversation);
            setActiveConversation(conversationId);
          }}
          onAddContact={async () => {
            if (selectedProfileAddress) {
              const added = await addToContacts(selectedProfileAddress);
              if (added) {
                toast.success('Contact added!');
              } else {
                toast.error('Contact already exists');
              }
            }
          }}
          isContact={selectedProfileAddress ? isContact(selectedProfileAddress) : false}
        />
      )}

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-midnight rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-white">New Chat</h3>
              <button
                onClick={resetNewChatModal}
                className="p-2 hover:bg-dark-200 rounded-lg transition"
              >
                <X size={20} className="text-secondary" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex mb-4 bg-dark-200 rounded-xl p-1">
              <button
                onClick={() => setChatMode('direct')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${chatMode === 'direct'
                  ? 'bg-primary-500 text-white'
                  : 'text-secondary hover:text-white'
                  }`}
              >
                <MessageSquare size={16} />
                Direct
              </button>
              <button
                onClick={() => setChatMode('group')}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${chatMode === 'group'
                  ? 'bg-primary-500 text-white'
                  : 'text-secondary hover:text-white'
                  }`}
              >
                <Users size={16} />
                Group
              </button>
            </div>

            {chatMode === 'direct' ? (
              /* Direct Chat */
              <>
                <p className="text-secondary mb-2">
                  Enter a wallet address or @name to start chatting.
                </p>

                <div className="text-xs text-muted mb-4 space-y-1">
                  <p>Examples:</p>
                  <p className="font-mono text-cyan-500">david@blockstar</p>
                  <p className="font-mono text-cyan-500">david</p>
                  <p className="font-mono text-cyan-500">0x1234...abcd</p>
                </div>

                <input
                  type="text"
                  placeholder="@name or 0x..."
                  value={newChatAddress}
                  onChange={(e) => setNewChatAddress(e.target.value)}
                  className="w-full px-4 py-3 bg-dark-200 border border-midnight rounded-xl text-white placeholder-muted focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition mb-4"
                  onKeyDown={(e) => e.key === 'Enter' && handleStartNewChat()}
                />

                <div className="flex gap-3">
                  <button
                    onClick={resetNewChatModal}
                    className="flex-1 px-4 py-3 border border-midnight text-secondary rounded-xl hover:bg-dark-200 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleStartNewChat}
                    className="flex-1 px-4 py-3 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition shadow-glow"
                  >
                    Start Chat
                  </button>
                </div>
              </>
            ) : (
              /* Group Chat */
              <>
                <p className="text-secondary mb-4">
                  Create a group chat with multiple members.
                </p>

                {/* Group Name */}
                <div className="mb-4">
                  <label className="block text-sm text-secondary mb-2">Group Name</label>
                  <input
                    type="text"
                    placeholder="Enter group name..."
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    className="w-full px-4 py-3 bg-dark-200 border border-midnight rounded-xl text-white placeholder-muted focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition"
                  />
                </div>

                {/* Group Avatar */}
                <div className="mb-4">
                  <label className="block text-sm text-secondary mb-2">Group Avatar (optional)</label>
                  <div className="flex items-center gap-3">
                    <div className="w-14 h-14 rounded-full bg-gradient-to-br from-primary-500/50 to-cyan-500/50 flex items-center justify-center text-white text-lg font-bold overflow-hidden flex-shrink-0">
                      {groupAvatar ? (
                        <img src={groupAvatar} alt="Group" className="w-full h-full object-cover" />
                      ) : (
                        <Users size={24} />
                      )}
                    </div>
                    <input
                      type="text"
                      placeholder="Enter image URL..."
                      value={groupAvatar}
                      onChange={(e) => setGroupAvatar(e.target.value)}
                      className="flex-1 px-4 py-3 bg-dark-200 border border-midnight rounded-xl text-white placeholder-muted focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition text-sm"
                    />
                  </div>
                </div>

                {/* Add Members */}
                <div className="mb-4">
                  <label className="block text-sm text-secondary mb-2">Add Members</label>
                  
                  {/* Toggle between Search and Contacts */}
                  <div className="flex gap-2 mb-3">
                    <button
                      onClick={() => setGroupAddMode('search')}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition ${
                        groupAddMode === 'search'
                          ? 'bg-primary-500 text-white'
                          : 'bg-dark-200 text-secondary hover:text-white'
                      }`}
                    >
                      <Search size={14} />
                      Search
                    </button>
                    <button
                      onClick={() => setGroupAddMode('contacts')}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm transition ${
                        groupAddMode === 'contacts'
                          ? 'bg-primary-500 text-white'
                          : 'bg-dark-200 text-secondary hover:text-white'
                      }`}
                    >
                      <BookUser size={14} />
                      Contacts ({availableContacts.filter(c => !groupMembers.includes(c.walletAddress.toLowerCase())).length})
                    </button>
                  </div>
                  
                  {groupAddMode === 'search' ? (
                    <div className="flex gap-2">
                      <input
                        type="text"
                        placeholder="@name or 0x..."
                        value={memberInput}
                        onChange={(e) => setMemberInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleAddMember()}
                        className="flex-1 px-4 py-3 bg-dark-200 border border-midnight rounded-xl text-white placeholder-muted focus:outline-none focus:border-primary-500 focus:ring-1 focus:ring-primary-500/50 transition"
                      />
                      <button
                        onClick={handleAddMember}
                        className="px-4 py-3 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition"
                      >
                        <Plus size={20} />
                      </button>
                    </div>
                  ) : (
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {availableContacts.filter(c => !groupMembers.includes(c.walletAddress.toLowerCase())).length === 0 ? (
                        <p className="text-center text-muted text-sm py-3">No contacts available to add</p>
                      ) : (
                        availableContacts
                          .filter(c => !groupMembers.includes(c.walletAddress.toLowerCase()))
                          .map((contact) => (
                            <button
                              key={contact.walletAddress}
                              onClick={() => addContactToGroup(contact)}
                              className="w-full flex items-center gap-3 px-3 py-2 bg-dark-200 hover:bg-midnight rounded-lg transition"
                            >
                              {contact.profile?.avatar ? (
                                <img
                                  src={contact.profile.avatar}
                                  alt=""
                                  className="w-8 h-8 rounded-full object-cover"
                                />
                              ) : (
                                <div
                                  className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                                  style={{ backgroundColor: getAvatarColor(contact.walletAddress) }}
                                >
                                  {getInitials(contact.profile?.username || contact.nickname || contact.walletAddress)}
                                </div>
                              )}
                              <div className="flex-1 text-left min-w-0">
                                <p className="text-sm text-white font-medium truncate">
                                  {contact.profile?.username 
                                    ? `@${contact.profile.username}`
                                    : contact.nickname || truncateAddress(contact.walletAddress)}
                                </p>
                                {(contact.profile?.username || contact.nickname) && (
                                  <p className="text-xs text-muted truncate">{truncateAddress(contact.walletAddress)}</p>
                                )}
                              </div>
                              <Plus size={16} className="text-primary-400 flex-shrink-0" />
                            </button>
                          ))
                      )}
                    </div>
                  )}
                </div>

                {/* Members List */}
                {groupMembers.length > 0 && (
                  <div className="mb-4">
                    <label className="block text-sm text-secondary mb-2">
                      Members ({groupMembers.length})
                    </label>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {groupMembers.map((member) => {
                        const profile = groupMemberProfiles[member];
                        return (
                          <div
                            key={member}
                            className="flex items-center gap-3 px-3 py-2 bg-dark-200 border border-midnight rounded-lg"
                          >
                            {/* Avatar */}
                            {profile?.avatar ? (
                              <img
                                src={profile.avatar}
                                alt=""
                                className="w-8 h-8 rounded-full object-cover flex-shrink-0"
                              />
                            ) : (
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0"
                                style={{ backgroundColor: getAvatarColor(member) }}
                              >
                                {getInitials(profile?.username || member)}
                              </div>
                            )}
                            {/* Name/Address */}
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-white font-medium truncate">
                                {profile?.username ? `@${profile.username}` : truncateAddress(member)}
                              </p>
                              {profile?.username && (
                                <p className="text-xs text-muted truncate">{truncateAddress(member)}</p>
                              )}
                            </div>
                            <button
                              onClick={() => handleRemoveMember(member)}
                              className="p-1 text-red-400 hover:bg-red-500/20 rounded transition flex-shrink-0"
                            >
                              <X size={16} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex gap-3">
                  <button
                    onClick={resetNewChatModal}
                    className="flex-1 px-4 py-3 border border-midnight text-secondary rounded-xl hover:bg-dark-200 transition"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateGroup}
                    disabled={!groupName.trim() || groupMembers.length === 0}
                    className="flex-1 px-4 py-3 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition shadow-glow disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Create Group
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-midnight rounded-2xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Settings</h3>
              <button
                onClick={() => setShowSettingsModal(false)}
                className="p-2 hover:bg-dark-200 rounded-lg transition"
              >
                <X size={20} className="text-secondary" />
              </button>
            </div>

            <div className="space-y-6">
              {/* Profile Section */}
              <div>
                <h4 className="font-semibold text-white mb-3">Profile</h4>
                <div className="p-4 bg-dark-200 border border-midnight rounded-xl">
                  <div className="flex items-center gap-4">
                    <div className="w-20 h-20 rounded-full flex items-center justify-center overflow-hidden flex-shrink-0 border">
                      {stats.loading ? (
                        <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : getProfileAvatar()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white text-lg">{stats?.main_domain || 'Anonymous'}</p>
                      <p className="text-sm text-secondary">{truncateAddress(currentUser?.walletAddress || '')}</p>
                      {stats?.main_domain && (
                        <span className="inline-flex items-center mt-2 px-2 py-0.5 rounded-full text-xs font-medium bg-primary-500/20 text-primary-400 border border-primary-500/30">
                          NFT Domain
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Bio */}
                  {stats?.bio && (
                    <div className="mt-4 pt-4 border-t border-midnight">
                      <p className="text-sm text-secondary">{stats.bio}</p>
                    </div>
                  )}

                  {/* Social Links */}
                  <div className="grid grid-cols-1 gap-4 mt-5">
                    {stats.data.map((account, index) => {
                      const { display, icon } = resolveAccountDisplay(account);

                      return (
                        <a
                          key={index}
                          href={account?.value.startsWith("http") ? account?.value : `https://${account.value}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-3 p-2 rounded-lg bg-gray-800 hover:bg-gray-700 transition-colors group"
                        >
                          {icon}
                          <div className="flex-1 min-w-0">
                            <p className="text-gray-200 font-medium truncate">
                              {display}
                            </p>
                            {!icon && (
                              <p className="text-gray-500 text-xs truncate">
                                {account.key}
                              </p>
                            )}
                          </div>
                          <ExternalLinkIcon
                            size={14}
                            className="text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity"
                          />
                        </a>
                      );
                    })}
                  </div>

                  {/* Edit Profile Link */}
                  {currentUser?.username && (
                    <a
                      href={`https://domains.blockstar.site/reslover/${currentUser.username.split('@')[0]}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 flex items-center justify-center gap-2 text-sm text-primary-400 hover:text-primary-300 transition"
                    >
                      <ExternalLink size={14} />
                      Edit Profile on BlockStar Domains
                    </a>
                  )}
                </div>
              </div>

              {/* Security Section */}
              <div>
                <h4 className="font-semibold text-white mb-3">Security</h4>
                <div className="flex items-center justify-between p-4 bg-success-500/10 border border-success-500/30 rounded-xl">
                  <div className="flex items-center gap-3">
                    <Lock size={18} className="text-success-500" />
                    <span className="text-sm text-success-400">End-to-End Encryption</span>
                  </div>
                  <span className="text-xs text-success-500 font-semibold px-2 py-1 bg-success-500/20 rounded">ACTIVE</span>
                </div>
              </div>

              {/* About Section */}
              <div>
                <h4 className="font-semibold text-white mb-3">About</h4>
                <div className="p-4 bg-dark-200 border border-midnight rounded-xl space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-secondary">Version</span>
                    <span className="text-white">1.0.0</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-secondary">Network</span>
                    <span className="text-primary-400">BlockStar Mainnet</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-secondary">Chain ID</span>
                    <span className="text-white font-mono">5512</span>
                  </div>
                  <p className="text-xs text-muted pt-2 border-t border-midnight mt-2">
                    BlockStar Cypher - Decentralized Web3 Messaging
                  </p>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowSettingsModal(false)}
              className="mt-6 w-full px-4 py-3 bg-primary-500 text-white rounded-xl hover:bg-primary-600 transition shadow-glow"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Mesh QR Connect Modal */}
      <MeshQRConnect
        isOpen={showMeshQRConnect}
        onClose={() => setShowMeshQRConnect(false)}
        walletAddress={currentUser?.walletAddress || ''}
        publicKey={encryptionService.getPublicKey() || ''}
        username={currentUser?.username}
      />
    </>
  );
}
