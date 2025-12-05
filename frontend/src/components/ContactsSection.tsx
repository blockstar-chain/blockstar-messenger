import React, { useEffect, useState, useCallback } from 'react';
import { useAppStore } from '@/store';
import { Search, UserPlus, X, Users, MessageSquare, Trash2, Star, StarOff, Pencil, RefreshCw } from 'lucide-react';
import { truncateAddress, getInitials, getAvatarColor, generateConversationId } from '@/utils/helpers';
import { resolveProfile, resolveProfilesByWallets, getProfileByWallet, cacheProfileByWallet, type BlockStarProfile } from '@/lib/profileResolver';
import { db } from '@/lib/database';
import UserProfileModal from './UserProfileModal';
import toast from 'react-hot-toast';

interface Contact {
  id: string;
  walletAddress: string;
  nickname?: string;
  addedAt: number;
  isFavorite: boolean;
  profile?: BlockStarProfile | null;
}

interface ServerContact {
  id: string;
  owner_wallet: string;
  contact_wallet: string;
  nickname?: string;
  is_favorite: boolean;
  added_at: number;
  updated_at: number;
}

const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

// Cache for current user's wallet to use in helper functions
let currentUserWallet: string | null = null;
// Cache for contacts (for sync helper)
let contactsCache: Set<string> = new Set();

export default function ContactsSection() {
  const { currentUser, setActiveConversation, addConversation, conversations } = useAppStore();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [filteredContacts, setFilteredContacts] = useState<Contact[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [newContactAddress, setNewContactAddress] = useState('');
  const [newContactNickname, setNewContactNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [selectedContact, setSelectedContact] = useState<Contact | null>(null);
  const [showProfileModal, setShowProfileModal] = useState(false);
  
  // Edit contact state
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [editNickname, setEditNickname] = useState('');

  // Update cached wallet address
  useEffect(() => {
    currentUserWallet = currentUser?.walletAddress?.toLowerCase() || null;
  }, [currentUser?.walletAddress]);

  // Update contacts cache when contacts change
  useEffect(() => {
    contactsCache = new Set(contacts.map(c => c.walletAddress.toLowerCase()));
  }, [contacts]);

  // Load contacts from API
  const loadContacts = useCallback(async () => {
    if (!currentUser?.walletAddress) return;
    
    setLoadingContacts(true);
    
    try {
      const response = await fetch(`${API_URL}/api/contacts/${currentUser.walletAddress.toLowerCase()}`);
      
      if (response.ok) {
        const data = await response.json();
        
        if (data.success && data.contacts) {
          // First, collect all wallet addresses
          const walletAddresses = data.contacts.map((c: ServerContact) => c.contact_wallet);
          
          // Batch resolve all profiles at once (more efficient)
          const profilesMap = await resolveProfilesByWallets(walletAddresses);
          
          // Convert server format to client format with resolved profiles
          const contactsWithProfiles = data.contacts.map((serverContact: ServerContact) => {
            const contact: Contact = {
              id: serverContact.id,
              walletAddress: serverContact.contact_wallet,
              nickname: serverContact.nickname,
              addedAt: serverContact.added_at,
              isFavorite: serverContact.is_favorite,
            };
            
            // Get profile from the batch result
            const profile = profilesMap.get(serverContact.contact_wallet.toLowerCase()) || null;
            
            return { ...contact, profile };
          });
          
          // Sort contacts alphabetically by display name (nickname > @username > wallet address)
          const sortedContacts = contactsWithProfiles.sort((a: Contact, b: Contact) => {
            const nameA = (a.nickname || a.profile?.username || a.walletAddress).toLowerCase();
            const nameB = (b.nickname || b.profile?.username || b.walletAddress).toLowerCase();
            return nameA.localeCompare(nameB);
          });
          
          setContacts(sortedContacts);
          setFilteredContacts(sortedContacts);
        }
      }
    } catch (error) {
      console.error('Error loading contacts:', error);
      toast.error('Failed to load contacts');
    } finally {
      setLoadingContacts(false);
    }
  }, [currentUser?.walletAddress]);

  // Load contacts on mount and when user changes
  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  // Filter contacts based on search
  useEffect(() => {
    let result = contacts;
    
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = contacts.filter(
        (contact) =>
          contact.walletAddress.toLowerCase().includes(query) ||
          contact.nickname?.toLowerCase().includes(query) ||
          contact.profile?.username?.toLowerCase().includes(query)
      );
    }
    
    // Always sort alphabetically by display name
    const sorted = [...result].sort((a, b) => {
      const nameA = (a.nickname || a.profile?.username || a.walletAddress).toLowerCase();
      const nameB = (b.nickname || b.profile?.username || b.walletAddress).toLowerCase();
      return nameA.localeCompare(nameB);
    });
    
    setFilteredContacts(sorted);
  }, [searchQuery, contacts]);

  // Add new contact
  const handleAddContact = async () => {
    if (!newContactAddress.trim() || !currentUser) {
      toast.error('Please enter a wallet address or @name');
      return;
    }

    let normalizedAddress = newContactAddress.trim();
    let resolvedProfile: BlockStarProfile | null = null;

    // Check if it's an @name (not starting with 0x)
    if (!normalizedAddress.startsWith('0x')) {
      // It's an @name - need to resolve to wallet address
      toast.loading('Looking up @name...', { id: 'contact-lookup' });
      
      try {
        // Extract the name part (handle "@david", "david@blockstar" or just "david")
        let nameToResolve = normalizedAddress;
        if (nameToResolve.startsWith('@')) {
          nameToResolve = nameToResolve.slice(1);
        }
        if (nameToResolve.includes('@')) {
          nameToResolve = nameToResolve.split('@')[0];
        }

        resolvedProfile = await resolveProfile(nameToResolve);

        if (resolvedProfile && resolvedProfile.walletAddress) {
          normalizedAddress = resolvedProfile.walletAddress.toLowerCase();
          toast.success(`Found: @${resolvedProfile.username}`, { id: 'contact-lookup' });
        } else {
          toast.error(`Could not find @${nameToResolve}`, { id: 'contact-lookup' });
          return;
        }
      } catch (error) {
        toast.error('Failed to look up @name', { id: 'contact-lookup' });
        return;
      }
    } else {
      // Validate wallet address format
      if (!normalizedAddress.match(/^0x[a-fA-F0-9]{40}$/)) {
        toast.error('Invalid wallet address format');
        return;
      }
      normalizedAddress = normalizedAddress.toLowerCase();
    }

    // Check if already exists locally
    if (contacts.some(c => c.walletAddress.toLowerCase() === normalizedAddress)) {
      toast.error('Contact already exists');
      return;
    }

    // Check if it's the user's own address
    if (normalizedAddress === currentUser.walletAddress.toLowerCase()) {
      toast.error("You can't add yourself as a contact");
      return;
    }

    setLoading(true);

    try {
      // Add contact via API
      const response = await fetch(`${API_URL}/api/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerWallet: currentUser.walletAddress,
          contactWallet: normalizedAddress,
          nickname: newContactNickname.trim() || undefined,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add contact');
      }

      const data = await response.json();
      
      if (data.success && data.contact) {
        // Use resolved profile if we have it, otherwise try to fetch
        let profile: BlockStarProfile | null = resolvedProfile;
        if (!profile) {
          try {
            const cachedProfile = getProfileByWallet(normalizedAddress);
            if (cachedProfile) {
              profile = cachedProfile;
            } else {
              const profileResponse = await fetch(`${API_URL}/api/profile/${normalizedAddress}`);
              if (profileResponse.ok) {
                const profileData = await profileResponse.json();
                if (profileData.success && profileData.profile?.nftName) {
                  profile = await resolveProfile(profileData.profile.nftName);
                }
              }
            }
          } catch {
            // Continue without profile
          }
        }

        const newContact: Contact = {
          id: data.contact.id,
          walletAddress: data.contact.contact_wallet,
          nickname: data.contact.nickname,
          addedAt: data.contact.added_at,
          isFavorite: data.contact.is_favorite,
          profile,
        };

        setContacts(prev => [...prev, newContact]);
        setShowAddModal(false);
        setNewContactAddress('');
        setNewContactNickname('');
        toast.success('Contact added!');
      }
    } catch (error: any) {
      toast.error(error.message || 'Failed to add contact');
    } finally {
      setLoading(false);
    }
  };

  // Remove contact
  const handleRemoveContact = async (contact: Contact) => {
    if (!currentUser) return;

    try {
      const response = await fetch(
        `${API_URL}/api/contacts/${currentUser.walletAddress.toLowerCase()}/${contact.walletAddress.toLowerCase()}`,
        { method: 'DELETE' }
      );

      if (!response.ok) {
        throw new Error('Failed to remove contact');
      }

      setContacts(prev => prev.filter(c => c.id !== contact.id));
      toast.success('Contact removed');
    } catch (error) {
      toast.error('Failed to remove contact');
    }
  };

  // Toggle favorite
  const handleToggleFavorite = async (contact: Contact) => {
    if (!currentUser) return;

    const newFavoriteStatus = !contact.isFavorite;

    try {
      const response = await fetch(
        `${API_URL}/api/contacts/${currentUser.walletAddress.toLowerCase()}/${contact.walletAddress.toLowerCase()}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ isFavorite: newFavoriteStatus }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update contact');
      }

      setContacts(prev =>
        prev.map(c =>
          c.id === contact.id ? { ...c, isFavorite: newFavoriteStatus } : c
        )
      );
    } catch (error) {
      toast.error('Failed to update contact');
    }
  };

  // Edit contact nickname
  const handleOpenEdit = (contact: Contact) => {
    setEditingContact(contact);
    setEditNickname(contact.nickname || '');
    setShowEditModal(true);
  };

  const handleSaveEdit = async () => {
    if (!editingContact || !currentUser) return;

    try {
      const response = await fetch(
        `${API_URL}/api/contacts/${currentUser.walletAddress.toLowerCase()}/${editingContact.walletAddress.toLowerCase()}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ nickname: editNickname.trim() || '' }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to update contact');
      }

      setContacts(prev =>
        prev.map(c =>
          c.id === editingContact.id
            ? { ...c, nickname: editNickname.trim() || undefined }
            : c
        )
      );

      setShowEditModal(false);
      setEditingContact(null);
      setEditNickname('');
      toast.success('Contact updated!');
    } catch (error) {
      toast.error('Failed to update contact');
    }
  };

  // Start chat with contact
  const handleStartChat = async (contact: Contact) => {
    if (!currentUser) return;

    const myAddress = currentUser.walletAddress.toLowerCase();
    const contactAddress = contact.walletAddress.toLowerCase();
    
    // IMPORTANT: Call backend to get/create conversation - this also unhides if previously deleted
    const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
    let conversationId: string;
    
    try {
      const response = await fetch(`${API_URL}/api/conversations/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user1: myAddress, user2: contactAddress }),
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.success && data.conversation) {
          conversationId = data.conversation.id;
        } else {
          throw new Error('Invalid server response');
        }
      } else {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      // Fallback to client-generated ID if server fails
      console.warn('Could not reach server for conversation, using local ID:', error);
      conversationId = generateConversationId(myAddress, contactAddress);
    }
    
    // Remove from deleted list if it was there (user is re-opening a deleted chat)
    // Import this at the top of the file
    const { removeFromDeletedConversations } = await import('./Sidebar');
    removeFromDeletedConversations(conversationId, currentUser.walletAddress);

    // Check if conversation already exists in state
    const existingConv = conversations.find(c => c.id === conversationId);
    
    if (existingConv) {
      setActiveConversation(conversationId);
    } else {
      // Create new conversation locally
      const newConv = {
        id: conversationId,
        type: 'direct' as const,
        participants: [myAddress, contactAddress],
        unreadCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await db.conversations.put(newConv);
      addConversation(newConv);
      setActiveConversation(conversationId);
    }
  };

  // Sort contacts: favorites first, then alphabetically
  const sortedContacts = [...filteredContacts].sort((a, b) => {
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;
    const nameA = a.profile?.username || a.nickname || a.walletAddress;
    const nameB = b.profile?.username || b.nickname || b.walletAddress;
    return nameA.localeCompare(nameB);
  });

  return (
    <>
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="p-4 border-b border-midnight">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Users size={20} className="text-primary-400" />
              <h2 className="text-lg font-semibold text-white">Contacts</h2>
              <span className="text-xs text-muted bg-dark-200 px-2 py-0.5 rounded-full">
                {contacts.length}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={loadContacts}
                className="p-2 text-muted hover:text-white hover:bg-dark-200 rounded-lg transition"
                title="Refresh contacts"
                disabled={loadingContacts}
              >
                <RefreshCw size={18} className={loadingContacts ? 'animate-spin' : ''} />
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="p-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition"
                title="Add Contact"
              >
                <UserPlus size={18} />
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              type="text"
              placeholder="Search contacts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-card border border-midnight rounded-xl text-white placeholder-muted focus:outline-none focus:border-primary-500 transition"
            />
          </div>
        </div>

        {/* Contacts List */}
        <div className="flex-1 overflow-y-auto">
          {loadingContacts ? (
            <div className="flex items-center justify-center h-full">
              <div className="w-8 h-8 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
            </div>
          ) : sortedContacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted px-4">
              <Users size={48} className="mb-4 text-dark-100" />
              <p className="text-center font-medium text-secondary">
                {searchQuery ? 'No contacts found' : 'No contacts yet'}
              </p>
              <p className="text-sm text-center mt-1 mb-4">
                {searchQuery ? 'Try a different search' : 'Add contacts to message them easily'}
              </p>
              {!searchQuery && (
                <button
                  onClick={() => setShowAddModal(true)}
                  className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition flex items-center gap-2"
                >
                  <UserPlus size={18} />
                  Add Contact
                </button>
              )}
            </div>
          ) : (
            sortedContacts.map((contact) => (
              <div
                key={contact.id}
                className="p-4 border-b border-midnight hover:bg-card transition cursor-pointer"
                onClick={() => {
                  setSelectedContact(contact);
                  setShowProfileModal(true);
                }}
              >
                <div className="flex items-center gap-3">
                  {/* Avatar */}
                  <div className="relative">
                    <div className="w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-primary-500/50 to-cyan-500/50 flex items-center justify-center">
                      {contact.profile?.avatar ? (
                        <img
                          src={contact.profile.avatar}
                          alt=""
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-white font-semibold">
                          {getInitials(contact.profile?.username || contact.nickname || contact.walletAddress)}
                        </span>
                      )}
                    </div>
                    {contact.isFavorite && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 bg-yellow-500 rounded-full flex items-center justify-center">
                        <Star size={10} className="text-white fill-white" />
                      </div>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white truncate">
                      {contact.profile?.username
                        ? `@${contact.profile.username}`
                        : contact.nickname || truncateAddress(contact.walletAddress)
                      }
                    </p>
                    {(contact.profile?.username || contact.nickname) && (
                      <p className="text-xs text-muted truncate">
                        {truncateAddress(contact.walletAddress)}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => handleToggleFavorite(contact)}
                      className={`p-2 rounded-lg transition ${
                        contact.isFavorite
                          ? 'text-yellow-500 hover:bg-yellow-500/20'
                          : 'text-muted hover:text-white hover:bg-dark-200'
                      }`}
                      title={contact.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      {contact.isFavorite ? (
                        <Star size={16} className="fill-current" />
                      ) : (
                        <StarOff size={16} />
                      )}
                    </button>
                    <button
                      onClick={() => handleOpenEdit(contact)}
                      className="p-2 text-muted hover:text-white hover:bg-dark-200 rounded-lg transition"
                      title="Edit nickname"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => handleStartChat(contact)}
                      className="p-2 text-primary-400 hover:bg-primary-500/20 rounded-lg transition"
                      title="Send message"
                    >
                      <MessageSquare size={16} />
                    </button>
                    <button
                      onClick={() => handleRemoveContact(contact)}
                      className="p-2 text-muted hover:text-danger-500 hover:bg-danger-500/20 rounded-lg transition"
                      title="Remove contact"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Add Contact Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-midnight rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-white">Add Contact</h3>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setNewContactAddress('');
                  setNewContactNickname('');
                }}
                className="p-2 hover:bg-dark-200 rounded-lg transition"
              >
                <X size={20} className="text-secondary" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-secondary mb-2">
                  Wallet Address or @name *
                </label>
                <input
                  type="text"
                  value={newContactAddress}
                  onChange={(e) => setNewContactAddress(e.target.value)}
                  placeholder="@name or 0x..."
                  className="w-full px-4 py-3 bg-dark-200 border border-midnight rounded-xl text-white placeholder-muted focus:outline-none focus:border-primary-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-secondary mb-2">
                  Nickname (optional)
                </label>
                <input
                  type="text"
                  value={newContactNickname}
                  onChange={(e) => setNewContactNickname(e.target.value)}
                  placeholder="Enter a nickname..."
                  className="w-full px-4 py-3 bg-dark-200 border border-midnight rounded-xl text-white placeholder-muted focus:outline-none focus:border-primary-500"
                />
              </div>

              <button
                onClick={handleAddContact}
                disabled={loading || !newContactAddress.trim()}
                className="w-full px-4 py-3 bg-primary-500 hover:bg-primary-600 text-white rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <>
                    <UserPlus size={18} />
                    Add Contact
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Contact Modal */}
      {showEditModal && editingContact && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-card border border-midnight rounded-2xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-semibold text-white">Edit Contact</h3>
              <button
                onClick={() => {
                  setShowEditModal(false);
                  setEditingContact(null);
                  setEditNickname('');
                }}
                className="p-2 hover:bg-dark-200 rounded-lg transition"
              >
                <X size={20} className="text-secondary" />
              </button>
            </div>

            {/* Contact Info */}
            <div className="flex items-center gap-3 mb-6 p-3 bg-dark-200 rounded-xl">
              <div className="w-12 h-12 rounded-full overflow-hidden bg-gradient-to-br from-primary-500/50 to-cyan-500/50 flex items-center justify-center">
                {editingContact.profile?.avatar ? (
                  <img
                    src={editingContact.profile.avatar}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <span className="text-white font-semibold">
                    {getInitials(editingContact.profile?.username || editingContact.walletAddress)}
                  </span>
                )}
              </div>
              <div>
                {editingContact.profile?.username && (
                  <p className="font-semibold text-white">@{editingContact.profile.username}</p>
                )}
                <p className="text-sm text-secondary">{truncateAddress(editingContact.walletAddress)}</p>
              </div>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-secondary mb-2">
                  Nickname
                </label>
                <input
                  type="text"
                  value={editNickname}
                  onChange={(e) => setEditNickname(e.target.value)}
                  placeholder="Enter a nickname..."
                  className="w-full px-4 py-3 bg-dark-200 border border-midnight rounded-xl text-white placeholder-muted focus:outline-none focus:border-primary-500"
                />
                <p className="text-xs text-muted mt-2">
                  A nickname helps you identify this contact. Leave blank to show only their @name or address.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    setShowEditModal(false);
                    setEditingContact(null);
                    setEditNickname('');
                  }}
                  className="flex-1 px-4 py-3 bg-dark-200 hover:bg-midnight text-white rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEdit}
                  className="flex-1 px-4 py-3 bg-primary-500 hover:bg-primary-600 text-white rounded-xl transition"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Profile Modal */}
      {selectedContact && (
        <UserProfileModal
          isOpen={showProfileModal}
          onClose={() => {
            setShowProfileModal(false);
            setSelectedContact(null);
          }}
          walletAddress={selectedContact.walletAddress}
          onStartChat={() => handleStartChat(selectedContact)}
          onRemoveContact={() => handleRemoveContact(selectedContact)}
          isContact={true}
        />
      )}
    </>
  );
}

// Export helper function for adding contacts from other components
export const addToContacts = async (address: string): Promise<boolean> => {
  if (!currentUserWallet) {
    console.error('No current user wallet available');
    return false;
  }
  
  const normalizedAddress = address.toLowerCase();
  
  try {
    const response = await fetch(`${API_URL}/api/contacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ownerWallet: currentUserWallet,
        contactWallet: normalizedAddress,
      }),
    });

    if (!response.ok) {
      return false;
    }

    // Update local cache
    contactsCache.add(normalizedAddress);
    return true;
  } catch (error) {
    console.error('Error adding contact:', error);
    return false;
  }
};

// Synchronous check using cached data (for UI that can't be async)
export const isContact = (address: string): boolean => {
  return contactsCache.has(address.toLowerCase());
};
