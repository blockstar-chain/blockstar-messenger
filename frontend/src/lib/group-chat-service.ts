import { GroupChat, Message, User } from '@/types';
import { webSocketService } from './websocket';
import { encryptionService } from './encryption';
import { db, dbHelpers } from './database';
import { generateMessageId, generateConversationId } from '@/utils/helpers';

/**
 * Group Chat Service
 * Handles group chat creation, management, and messaging
 */

export class GroupChatService {
  /**
   * Create a new group chat
   */
  async createGroup(
    name: string,
    members: string[],
    description?: string,
    avatar?: string
  ): Promise<GroupChat> {
    const currentUser = await this.getCurrentUser();
    
    const groupId = generateConversationId(
      currentUser.walletAddress,
      ...members
    );

    const group: GroupChat = {
      id: groupId,
      type: 'group',
      groupName: name,
      groupDescription: description,
      groupAvatar: avatar,
      participants: [currentUser.walletAddress, ...members],
      admins: [currentUser.walletAddress],
      createdBy: currentUser.walletAddress,
      unreadCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      maxMembers: 256,
    };

    // Save to database
    await db.conversations.put(group);

    // Notify server and members
    webSocketService.emit('group:create', {
      group,
      members,
    });

    return group;
  }

  /**
   * Add members to group
   */
  async addMembers(
    groupId: string,
    newMembers: string[]
  ): Promise<void> {
    const group = await db.conversations.get(groupId) as GroupChat;
    
    if (!group || group.type !== 'group') {
      throw new Error('Group not found');
    }

    // Check if user is admin
    const currentUser = await this.getCurrentUser();
    if (!group.admins.includes(currentUser.walletAddress)) {
      throw new Error('Only admins can add members');
    }

    // Check max members limit
    if (group.participants.length + newMembers.length > (group.maxMembers || 256)) {
      throw new Error('Group member limit reached');
    }

    // Add new members
    const updatedParticipants = [...group.participants, ...newMembers];

    await db.conversations.update(groupId, {
      participants: updatedParticipants,
      updatedAt: Date.now(),
    });

    // Notify server
    webSocketService.emit('group:add-members', {
      groupId,
      members: newMembers,
    });

    // Send system message
    await this.sendSystemMessage(
      groupId,
      `${currentUser.username} added ${newMembers.length} member(s)`
    );
  }

  /**
   * Remove member from group
   */
  async removeMember(
    groupId: string,
    memberAddress: string
  ): Promise<void> {
    const group = await db.conversations.get(groupId) as GroupChat;
    
    if (!group || group.type !== 'group') {
      throw new Error('Group not found');
    }

    const currentUser = await this.getCurrentUser();
    
    // Check permissions
    if (!group.admins.includes(currentUser.walletAddress)) {
      throw new Error('Only admins can remove members');
    }

    // Can't remove creator
    if (memberAddress === group.createdBy) {
      throw new Error('Cannot remove group creator');
    }

    // Remove member
    const updatedParticipants = group.participants.filter(
      (p) => p !== memberAddress
    );
    const updatedAdmins = group.admins.filter((a) => a !== memberAddress);

    await db.conversations.update(groupId, {
      participants: updatedParticipants,
      admins: updatedAdmins,
      updatedAt: Date.now(),
    });

    webSocketService.emit('group:remove-member', {
      groupId,
      memberAddress,
    });

    await this.sendSystemMessage(
      groupId,
      `${currentUser.username} removed a member`
    );
  }

  /**
   * Leave group
   */
  async leaveGroup(groupId: string): Promise<void> {
    const group = await db.conversations.get(groupId) as GroupChat;
    const currentUser = await this.getCurrentUser();

    if (!group || group.type !== 'group') {
      throw new Error('Group not found');
    }

    // If creator is leaving, transfer ownership
    if (group.createdBy === currentUser.walletAddress && group.admins.length > 1) {
      const newCreator = group.admins.find((a) => a !== currentUser.walletAddress);
      await db.conversations.update(groupId, {
        createdBy: newCreator,
      });
    }

    await this.removeMember(groupId, currentUser.walletAddress);

    await this.sendSystemMessage(
      groupId,
      `${currentUser.username} left the group`
    );
  }

  /**
   * Make user admin
   */
  async makeAdmin(groupId: string, userAddress: string): Promise<void> {
    const group = await db.conversations.get(groupId) as GroupChat;
    const currentUser = await this.getCurrentUser();

    if (!group || group.type !== 'group') {
      throw new Error('Group not found');
    }

    // Only creator can make admins
    if (group.createdBy !== currentUser.walletAddress) {
      throw new Error('Only group creator can make admins');
    }

    if (!group.admins.includes(userAddress)) {
      const updatedAdmins = [...group.admins, userAddress];
      
      await db.conversations.update(groupId, {
        admins: updatedAdmins,
        updatedAt: Date.now(),
      });

      webSocketService.emit('group:make-admin', {
        groupId,
        userAddress,
      });
    }
  }

  /**
   * Update group info
   */
  async updateGroupInfo(
    groupId: string,
    updates: {
      groupName?: string;
      groupDescription?: string;
      groupAvatar?: string;
    }
  ): Promise<void> {
    const group = await db.conversations.get(groupId) as GroupChat;
    const currentUser = await this.getCurrentUser();

    if (!group || group.type !== 'group') {
      throw new Error('Group not found');
    }

    if (!group.admins.includes(currentUser.walletAddress)) {
      throw new Error('Only admins can update group info');
    }

    await db.conversations.update(groupId, {
      ...updates,
      updatedAt: Date.now(),
    });

    webSocketService.emit('group:update', {
      groupId,
      updates,
    });
  }

  /**
   * Send message to group
   */
  async sendGroupMessage(
    groupId: string,
    content: string,
    type: Message['type'] = 'text'
  ): Promise<void> {
    const group = await db.conversations.get(groupId) as GroupChat;
    const currentUser = await this.getCurrentUser();

    if (!group || group.type !== 'group') {
      throw new Error('Group not found');
    }

    // Encrypt message for each participant
    const encryptedMessages: Message[] = [];

    for (const participant of group.participants) {
      if (participant === currentUser.walletAddress) continue;

      const participantPublicKey = await this.getPublicKey(participant);
      const encryptedContent = await encryptionService.encryptMessage(
        content,
        participantPublicKey
      );

      const message: Message = {
        id: generateMessageId(),
        conversationId: groupId,
        senderId: currentUser.walletAddress,
        recipientId: group.participants,
        content: encryptedContent,
        timestamp: Date.now(),
        delivered: false,
        read: false,
        type,
      };

      encryptedMessages.push(message);
    }

    // Save messages
    for (const msg of encryptedMessages) {
      await dbHelpers.saveMessage(msg);
    }

    // Send via WebSocket
    webSocketService.emit('group:message', {
      groupId,
      messages: encryptedMessages,
    });
  }

  /**
   * Send system message
   */
  private async sendSystemMessage(
    groupId: string,
    content: string
  ): Promise<void> {
    const message: Message = {
      id: generateMessageId(),
      conversationId: groupId,
      senderId: 'system',
      recipientId: [],
      content,
      timestamp: Date.now(),
      delivered: true,
      read: false,
      type: 'text',
    };

    await dbHelpers.saveMessage(message);
  }

  /**
   * Get group members
   */
  async getGroupMembers(groupId: string): Promise<User[]> {
    const group = await db.conversations.get(groupId) as GroupChat;
    
    if (!group || group.type !== 'group') {
      throw new Error('Group not found');
    }

    const members: User[] = [];
    
    for (const address of group.participants) {
      const user = await dbHelpers.getUser(address);
      if (user) {
        members.push(user);
      }
    }

    return members;
  }

  /**
   * Generate invite link
   */
  async generateInviteLink(groupId: string): Promise<string> {
    const group = await db.conversations.get(groupId) as GroupChat;
    const currentUser = await this.getCurrentUser();

    if (!group || group.type !== 'group') {
      throw new Error('Group not found');
    }

    if (!group.admins.includes(currentUser.walletAddress)) {
      throw new Error('Only admins can generate invite links');
    }

    const inviteCode = btoa(groupId + ':' + Date.now());
    const inviteLink = `${window.location.origin}/join/${inviteCode}`;

    await db.conversations.update(groupId, {
      inviteLink: inviteCode,
    } as any);

    return inviteLink;
  }

  /**
   * Join group via invite link
   */
  async joinViaInvite(inviteCode: string): Promise<GroupChat> {
    const [groupId] = atob(inviteCode).split(':');
    const group = await db.conversations.get(groupId) as GroupChat;

    if (!group || group.type !== 'group') {
      throw new Error('Invalid invite link');
    }

    const currentUser = await this.getCurrentUser();

    if (group.participants.includes(currentUser.walletAddress)) {
      throw new Error('Already a member');
    }

    await this.addMembers(groupId, [currentUser.walletAddress]);

    return group;
  }

  private async getCurrentUser(): Promise<User> {
    // Import store dynamically to avoid circular dependency
    const { useAppStore } = await import('@/store');
    const user = useAppStore.getState().currentUser;
    if (!user) {
      throw new Error('User not authenticated');
    }
    return user;
  }

  private async getPublicKey(address: string): Promise<string> {
    const user = await dbHelpers.getUser(address);
    return user?.publicKey || '';
  }
}

export const groupChatService = new GroupChatService();
