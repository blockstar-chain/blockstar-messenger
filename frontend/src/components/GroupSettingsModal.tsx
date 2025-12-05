import React, { useState, useEffect, useRef } from 'react';
import { X, UserPlus, UserMinus, Shield, Crown, Users, Search, Check, BookUser, Camera, Loader2 } from 'lucide-react';
import { useAppStore } from '@/store';
import { Conversation } from '@/types';
import { truncateAddress, getInitials, getAvatarColor } from '@/utils/helpers';
import { webSocketService } from '@/lib/websocket';
import { resolveProfile, getProfileByWallet, type BlockStarProfile } from '@/lib/profileResolver';
import toast from 'react-hot-toast';

interface GroupSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  conversation: Conversation;
}

interface MemberInfo {
  address: string;
  profile: BlockStarProfile | null;
  isAdmin: boolean;
  isCreator: boolean;
}

interface ContactInfo {
  walletAddress: string;
  nickname?: string;
  profile?: BlockStarProfile | null;
}

const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

export default function GroupSettingsModal({ isOpen, onClose, conversation }: GroupSettingsModalProps) {
  const { currentUser } = useAppStore();
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddMember, setShowAddMember] = useState(false);
  const [newMemberAddress, setNewMemberAddress] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [removingMember, setRemovingMember] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactInfo[]>([]);
  const [showContacts, setShowContacts] = useState(false);

  const groupConv = conversation as any;
  const isCurrentUserAdmin = groupConv.admins?.includes(currentUser?.walletAddress.toLowerCase()) ||
    groupConv.createdBy?.toLowerCase() === currentUser?.walletAddress.toLowerCase();

  // Avatar state
  const [groupAvatar, setGroupAvatar] = useState<string>(groupConv.groupAvatar || groupConv.avatar || '');
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);

  // Handle avatar upload
  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image must be less than 5MB');
      return;
    }

    setUploadingAvatar(true);

    try {
      // Upload file
      const formData = new FormData();
      formData.append('file', file);

      const uploadResponse = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!uploadResponse.ok) {
        throw new Error('Failed to upload image');
      }

      const uploadData = await uploadResponse.json();
      const avatarUrl = uploadData.url || uploadData.fileUrl;

      // Update group avatar via API
      const response = await fetch(`${API_URL}/api/groups/${conversation.id}/avatar`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          avatarUrl,
          adminAddress: currentUser?.walletAddress,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update group avatar');
      }

      // Update local state
      setGroupAvatar(avatarUrl);
      useAppStore.getState().updateConversation(conversation.id, { groupAvatar: avatarUrl, avatar: avatarUrl });

      // Notify other members via WebSocket
      webSocketService.emit('group:avatar:update', {
        groupId: conversation.id,
        avatarUrl,
        updatedBy: currentUser?.walletAddress,
      });

      toast.success('Group avatar updated');
    } catch (error) {
      console.error('Error uploading avatar:', error);
      toast.error('Failed to update group avatar');
    } finally {
      setUploadingAvatar(false);
    }
  };

  // Load contacts for adding members
  useEffect(() => {
    if (!isOpen || !currentUser?.walletAddress) return;

    const loadContacts = async () => {
      try {
        const response = await fetch(`${API_URL}/api/contacts/${currentUser.walletAddress.toLowerCase()}`);
        if (response.ok) {
          const data = await response.json();
          if (data.success && data.contacts) {
            // Filter out contacts who are already members
            const existingMembers = new Set(conversation.participants.map(p => p.toLowerCase()));
            const availableContacts = data.contacts
              .filter((c: any) => !existingMembers.has(c.contact_wallet.toLowerCase()))
              .map((c: any) => ({
                walletAddress: c.contact_wallet,
                nickname: c.nickname,
                profile: getProfileByWallet(c.contact_wallet) || null,
              }));
            
            // Load profiles for contacts without cached profiles
            for (const contact of availableContacts) {
              if (!contact.profile) {
                try {
                  const profileResponse = await fetch(`${API_URL}/api/profile/${contact.walletAddress}`);
                  if (profileResponse.ok) {
                    const profileData = await profileResponse.json();
                    if (profileData.success && profileData.profile?.nftName) {
                      contact.profile = await resolveProfile(profileData.profile.nftName);
                    }
                  }
                } catch {
                  // Continue without profile
                }
              }
            }
            
            setContacts(availableContacts);
          }
        }
      } catch (error) {
        console.error('Error loading contacts:', error);
      }
    };

    loadContacts();
  }, [isOpen, currentUser?.walletAddress, conversation.participants]);

  // Load member profiles
  useEffect(() => {
    if (!isOpen || !conversation) return;

    const loadMembers = async () => {
      setLoading(true);
      const memberInfos: MemberInfo[] = [];

      for (const address of conversation.participants) {
        const normalizedAddress = address.toLowerCase();
        let profile: BlockStarProfile | null = null;

        try {
          // First check wallet cache
          profile = getProfileByWallet(normalizedAddress);
          
          // If not in cache, try to get from backend
          if (!profile) {
            const response = await fetch(`${API_URL}/api/profile/${normalizedAddress}`);
            if (response.ok) {
              const data = await response.json();
              if (data.success && data.profile?.nftName) {
                profile = await resolveProfile(data.profile.nftName);
              }
            }
          }
        } catch (error) {
          console.error('Error loading member profile:', error);
        }

        memberInfos.push({
          address: normalizedAddress,
          profile,
          isAdmin: groupConv.admins?.includes(normalizedAddress) || false,
          isCreator: groupConv.createdBy?.toLowerCase() === normalizedAddress,
        });
      }

      // Sort: creator first, then admins, then others
      memberInfos.sort((a, b) => {
        if (a.isCreator) return -1;
        if (b.isCreator) return 1;
        if (a.isAdmin && !b.isAdmin) return -1;
        if (!a.isAdmin && b.isAdmin) return 1;
        return 0;
      });

      setMembers(memberInfos);
      setLoading(false);
    };

    loadMembers();
  }, [isOpen, conversation]);

  // Search for users to add
  const handleSearch = async (query: string) => {
    setNewMemberAddress(query);

    if (query.length < 2) {
      setSearchResults([]);
      return;
    }

    setSearching(true);
    try {
      const response = await fetch(`${API_URL}/api/users/search?q=${encodeURIComponent(query)}`);
      if (response.ok) {
        const results = await response.json();
        // Filter out users already in the group
        const filtered = results.filter((user: any) =>
          !conversation.participants.some(p => p.toLowerCase() === user.walletAddress.toLowerCase())
        );
        setSearchResults(filtered);
      }
    } catch (error) {
      console.error('Search error:', error);
    } finally {
      setSearching(false);
    }
  };

  // Add member to group
  const handleAddMember = async (address: string) => {
    if (!isCurrentUserAdmin) {
      toast.error('Only admins can add members');
      return;
    }

    const normalizedAddress = address.toLowerCase();

    // Check if already in group
    if (conversation.participants.some(p => p.toLowerCase() === normalizedAddress)) {
      toast.error('User is already in the group');
      return;
    }

    try {
      // Update via API
      const response = await fetch(`${API_URL}/api/groups/${conversation.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberAddress: normalizedAddress,
          adminAddress: currentUser?.walletAddress,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to add member');
      }

      // Try to get profile for the new member
      let profile: BlockStarProfile | null = getProfileByWallet(normalizedAddress);
      if (!profile) {
        try {
          const profileResponse = await fetch(`${API_URL}/api/profile/${normalizedAddress}`);
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

      // Update local state
      const newParticipants = [...conversation.participants, normalizedAddress];
      useAppStore.getState().updateConversation(conversation.id, { participants: newParticipants });

      // Notify via WebSocket
      webSocketService.emit('group:member:add', {
        groupId: conversation.id,
        memberAddress: normalizedAddress,
        addedBy: currentUser?.walletAddress,
        groupName: groupConv.groupName,
      });

      // Add to local members list with profile
      setMembers(prev => [...prev, {
        address: normalizedAddress,
        profile,
        isAdmin: false,
        isCreator: false,
      }]);

      // Remove from contacts list
      setContacts(prev => prev.filter(c => c.walletAddress.toLowerCase() !== normalizedAddress));

      setNewMemberAddress('');
      setSearchResults([]);
      setShowAddMember(false);
      setShowContacts(false);
      toast.success('Member added successfully');
    } catch (error) {
      console.error('Error adding member:', error);
      toast.error('Failed to add member');
    }
  };

  // Remove member from group
  const handleRemoveMember = async (address: string) => {
    const normalizedAddress = address.toLowerCase();
    const isSelfRemoval = normalizedAddress === currentUser?.walletAddress.toLowerCase();
    
    // Check permissions - admins can remove anyone, non-admins can only remove themselves
    if (!isCurrentUserAdmin && !isSelfRemoval) {
      toast.error('Only admins can remove members');
      return;
    }

    // Can't remove the creator (unless they're removing themselves which shouldn't happen via this check)
    if (groupConv.createdBy?.toLowerCase() === normalizedAddress && !isSelfRemoval) {
      toast.error('Cannot remove the group creator');
      return;
    }

    // If leaving, check if you're the only admin
    if (isSelfRemoval) {
      const isAdmin = groupConv.admins?.map((a: string) => a.toLowerCase()).includes(normalizedAddress);
      const adminCount = groupConv.admins?.length || 0;
      if (isAdmin && adminCount <= 1) {
        toast.error('Cannot leave - you are the only admin. Make someone else admin first.');
        return;
      }
    }

    setRemovingMember(normalizedAddress);

    try {
      // Update via API
      const response = await fetch(`${API_URL}/api/groups/${conversation.id}/members/${normalizedAddress}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminAddress: currentUser?.walletAddress,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to remove member');
      }

      // Update local state
      const newParticipants = conversation.participants.filter(
        p => p.toLowerCase() !== normalizedAddress
      );
      const newAdmins = (groupConv.admins || []).filter(
        (a: string) => a.toLowerCase() !== normalizedAddress
      );
      
      useAppStore.getState().updateConversation(conversation.id, { 
        participants: newParticipants,
        admins: newAdmins,
      });

      // Notify via WebSocket
      webSocketService.emit('group:member:remove', {
        groupId: conversation.id,
        memberAddress: normalizedAddress,
        removedBy: currentUser?.walletAddress,
      });

      // Update local members list
      setMembers(prev => prev.filter(m => m.address !== normalizedAddress));

      toast.success('Member removed');
    } catch (error) {
      console.error('Error removing member:', error);
      toast.error('Failed to remove member');
    } finally {
      setRemovingMember(null);
    }
  };

  // Toggle admin status
  const handleToggleAdmin = async (address: string) => {
    if (!isCurrentUserAdmin) {
      toast.error('Only admins can change admin status');
      return;
    }

    const normalizedAddress = address.toLowerCase();
    const isAdmin = groupConv.admins?.includes(normalizedAddress);

    // Can't remove admin from creator
    if (groupConv.createdBy?.toLowerCase() === normalizedAddress && isAdmin) {
      toast.error('Cannot remove admin from group creator');
      return;
    }

    try {
      const response = await fetch(`${API_URL}/api/groups/${conversation.id}/admins`, {
        method: isAdmin ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberAddress: normalizedAddress,
          adminAddress: currentUser?.walletAddress,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update admin status');
      }

      // Update local state
      let newAdmins: string[];
      if (isAdmin) {
        newAdmins = (groupConv.admins || []).filter((a: string) => a.toLowerCase() !== normalizedAddress);
      } else {
        newAdmins = [...(groupConv.admins || []), normalizedAddress];
      }

      useAppStore.getState().updateConversation(conversation.id, { admins: newAdmins });

      // Update local members list
      setMembers(prev => prev.map(m =>
        m.address === normalizedAddress ? { ...m, isAdmin: !isAdmin } : m
      ));

      toast.success(isAdmin ? 'Admin removed' : 'Admin added');
    } catch (error) {
      console.error('Error updating admin:', error);
      toast.error('Failed to update admin status');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-card border border-midnight rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-midnight">
          <div className="flex items-center gap-3">
            {/* Avatar with upload button */}
            <div className="relative group">
              <div className="w-12 h-12 rounded-full bg-gradient-to-br from-purple-500/50 to-pink-500/50 flex items-center justify-center overflow-hidden">
                {groupAvatar ? (
                  <img 
                    src={groupAvatar} 
                    alt={groupConv.groupName || 'Group'} 
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Users size={24} className="text-white" />
                )}
              </div>
              {isCurrentUserAdmin && (
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploadingAvatar}
                  className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  {uploadingAvatar ? (
                    <Loader2 size={20} className="text-white animate-spin" />
                  ) : (
                    <Camera size={20} className="text-white" />
                  )}
                </button>
              )}
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
            </div>
            <div>
              <h3 className="font-semibold text-white">{groupConv.groupName || 'Group Settings'}</h3>
              <p className="text-xs text-secondary">{members.length} members</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-dark-200 rounded-lg transition"
          >
            <X size={20} className="text-secondary" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* Add Member Section (Admin only) */}
          {isCurrentUserAdmin && (
            <div className="mb-4">
              {!showAddMember ? (
                <button
                  onClick={() => setShowAddMember(true)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-primary-500/20 border border-primary-500/30 text-primary-400 rounded-xl hover:bg-primary-500/30 transition"
                >
                  <UserPlus size={18} />
                  Add Member
                </button>
              ) : (
                <div className="space-y-3">
                  {/* Toggle between Search and Contacts */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setShowContacts(false)}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition ${
                        !showContacts
                          ? 'bg-primary-500 text-white'
                          : 'bg-dark-200 text-secondary hover:text-white'
                      }`}
                    >
                      <Search size={16} />
                      Search
                    </button>
                    <button
                      onClick={() => setShowContacts(true)}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg transition ${
                        showContacts
                          ? 'bg-primary-500 text-white'
                          : 'bg-dark-200 text-secondary hover:text-white'
                      }`}
                    >
                      <BookUser size={16} />
                      Contacts ({contacts.length})
                    </button>
                  </div>

                  {showContacts ? (
                    /* Contacts List */
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {contacts.length === 0 ? (
                        <p className="text-center text-secondary text-sm py-4">
                          No available contacts to add
                        </p>
                      ) : (
                        contacts.map((contact) => (
                          <button
                            key={contact.walletAddress}
                            onClick={() => handleAddMember(contact.walletAddress)}
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
                            <div className="flex-1 text-left">
                              <p className="text-sm text-white font-medium">
                                {contact.profile?.username 
                                  ? `@${contact.profile.username}`
                                  : contact.nickname || truncateAddress(contact.walletAddress)}
                              </p>
                              {(contact.profile?.username || contact.nickname) && (
                                <p className="text-xs text-secondary">{truncateAddress(contact.walletAddress)}</p>
                              )}
                            </div>
                            <UserPlus size={16} className="text-primary-400" />
                          </button>
                        ))
                      )}
                    </div>
                  ) : (
                    /* Search Section */
                    <>
                      <div className="relative">
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
                        <input
                          type="text"
                          value={newMemberAddress}
                          onChange={(e) => handleSearch(e.target.value)}
                          placeholder="Search by username or address..."
                          className="w-full pl-10 pr-4 py-3 bg-dark-200 border border-midnight rounded-xl text-white placeholder-muted focus:outline-none focus:border-primary-500"
                          autoFocus
                        />
                      </div>

                      {/* Search Results */}
                      {searchResults.length > 0 && (
                        <div className="max-h-40 overflow-y-auto space-y-1">
                          {searchResults.map((user) => (
                            <button
                              key={user.walletAddress}
                              onClick={() => handleAddMember(user.walletAddress)}
                              className="w-full flex items-center gap-3 px-3 py-2 bg-dark-200 hover:bg-midnight rounded-lg transition"
                            >
                              <div
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold"
                                style={{ backgroundColor: getAvatarColor(user.walletAddress) }}
                              >
                                {getInitials(user.username || user.walletAddress)}
                              </div>
                              <div className="flex-1 text-left">
                                <p className="text-sm text-white font-medium">
                                  {user.username || truncateAddress(user.walletAddress)}
                                </p>
                                {user.username && (
                                  <p className="text-xs text-secondary">{truncateAddress(user.walletAddress)}</p>
                                )}
                              </div>
                              <UserPlus size={16} className="text-primary-400" />
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Add by address directly */}
                      {newMemberAddress.startsWith('0x') && newMemberAddress.length === 42 && (
                        <button
                          onClick={() => handleAddMember(newMemberAddress)}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition"
                        >
                          <UserPlus size={16} />
                          Add {truncateAddress(newMemberAddress)}
                        </button>
                      )}

                      {/* Add by @name directly */}
                      {!newMemberAddress.startsWith('0x') && newMemberAddress.length >= 2 && (
                        <button
                          onClick={async () => {
                            let nameToResolve = newMemberAddress.trim();
                            
                            if (nameToResolve.startsWith('@')) {
                              nameToResolve = nameToResolve.slice(1);
                            }
                            
                            if (nameToResolve.includes('@')) {
                              nameToResolve = nameToResolve.split('@')[0];
                            }
                            
                            toast.loading('Looking up @name...', { id: 'add-by-name' });
                            try {
                              const profile = await resolveProfile(nameToResolve);
                              if (profile && profile.walletAddress) {
                                toast.dismiss('add-by-name');
                                await handleAddMember(profile.walletAddress);
                              } else {
                                toast.error(`Could not find @${nameToResolve}`, { id: 'add-by-name' });
                              }
                            } catch (error) {
                              toast.error('Failed to look up @name', { id: 'add-by-name' });
                            }
                          }}
                          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition"
                        >
                          <UserPlus size={16} />
                          Add @{newMemberAddress.startsWith('@') ? newMemberAddress.slice(1).split('@')[0] : newMemberAddress.split('@')[0]}
                        </button>
                      )}
                    </>
                  )}

                  <button
                    onClick={() => {
                      setShowAddMember(false);
                      setShowContacts(false);
                      setNewMemberAddress('');
                      setSearchResults([]);
                    }}
                    className="w-full px-4 py-2 text-secondary hover:text-white transition text-sm"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Members List */}
          <div>
            <h4 className="text-sm font-medium text-secondary mb-3">Members</h4>
            
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin" />
              </div>
            ) : (
              <div className="space-y-2">
                {members.map((member) => {
                  const isCurrentUser = member.address === currentUser?.walletAddress.toLowerCase();
                  const displayName = member.profile?.username
                    ? `${member.profile.username}@blockstar`
                    : truncateAddress(member.address);

                  return (
                    <div
                      key={member.address}
                      className="flex items-center gap-3 px-3 py-3 bg-dark-200 border border-midnight rounded-xl"
                    >
                      {/* Avatar */}
                      <div className="relative">
                        {member.profile?.avatar ? (
                          <img
                            src={member.profile.avatar}
                            alt=""
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div
                            className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-semibold"
                            style={{ backgroundColor: getAvatarColor(member.address) }}
                          >
                            {getInitials(member.profile?.username || member.address)}
                          </div>
                        )}
                        {member.isCreator && (
                          <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-yellow-500 rounded-full flex items-center justify-center">
                            <Crown size={10} className="text-white" />
                          </div>
                        )}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-white font-medium truncate">
                            {displayName}
                          </p>
                          {isCurrentUser && (
                            <span className="text-xs text-secondary">(You)</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {member.isCreator && (
                            <span className="text-xs text-yellow-500">Creator</span>
                          )}
                          {member.isAdmin && !member.isCreator && (
                            <span className="text-xs text-primary-400">Admin</span>
                          )}
                        </div>
                      </div>

                      {/* Actions (Admin only, can't modify self or creator) */}
                      {isCurrentUserAdmin && !member.isCreator && !isCurrentUser && (
                        <div className="flex items-center gap-1">
                          {/* Toggle Admin */}
                          <button
                            onClick={() => handleToggleAdmin(member.address)}
                            className={`p-2 rounded-lg transition ${
                              member.isAdmin
                                ? 'bg-primary-500/20 text-primary-400 hover:bg-primary-500/30'
                                : 'hover:bg-dark-200 text-secondary hover:text-white'
                            }`}
                            title={member.isAdmin ? 'Remove admin' : 'Make admin'}
                          >
                            <Shield size={16} />
                          </button>

                          {/* Remove Member */}
                          <button
                            onClick={() => handleRemoveMember(member.address)}
                            disabled={removingMember === member.address}
                            className="p-2 hover:bg-danger-500/20 text-secondary hover:text-danger-500 rounded-lg transition disabled:opacity-50"
                            title="Remove from group"
                          >
                            {removingMember === member.address ? (
                              <div className="w-4 h-4 border-2 border-danger-500/30 border-t-danger-500 rounded-full animate-spin" />
                            ) : (
                              <UserMinus size={16} />
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Leave Group (for non-creators) */}
          {!members.find(m => m.address === currentUser?.walletAddress.toLowerCase())?.isCreator && (
            <div className="mt-6 pt-4 border-t border-midnight">
              <button
                onClick={() => handleRemoveMember(currentUser?.walletAddress || '')}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-danger-500/20 border border-danger-500/30 text-danger-500 rounded-xl hover:bg-danger-500/30 transition"
              >
                <UserMinus size={18} />
                Leave Group
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-midnight">
          <button
            onClick={onClose}
            className="w-full px-4 py-3 bg-dark-200 text-white rounded-xl hover:bg-midnight transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
