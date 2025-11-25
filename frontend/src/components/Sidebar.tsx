import React, { useEffect, useState } from 'react';
import { useAppStore } from '@/store';
import { db } from '@/lib/database';
import { Conversation } from '@/types';
import { Search, Plus, Settings, LogOut, X, MessageSquarePlus } from 'lucide-react';
import { truncateAddress, formatTimestamp, getInitials, getAvatarColor, generateConversationId } from '@/utils/helpers';
import { blockchainService } from '@/lib/blockchain';
import toast from 'react-hot-toast';

export default function Sidebar() {
  const { currentUser, conversations, setActiveConversation, activeConversationId, setConversations, addConversation } = useAppStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [filteredConversations, setFilteredConversations] = useState<Conversation[]>([]);
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatAddress, setNewChatAddress] = useState('');

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (searchQuery) {
      setFilteredConversations(
        conversations.filter((conv) =>
          conv.participants.some((p) =>
            p.toLowerCase().includes(searchQuery.toLowerCase())
          )
        )
      );
    } else {
      setFilteredConversations(conversations);
    }
  }, [searchQuery, conversations]);

  const loadConversations = async () => {
    try {
      // Use db directly, not dbHelpers.db
      const allConversations = await db.conversations.toArray();
      const sorted = allConversations.sort((a, b) => b.updatedAt - a.updatedAt);
      setConversations(sorted);
    } catch (error) {
      console.error('Error loading conversations:', error);
    }
  };

  const handleStartNewChat = async () => {
    if (!newChatAddress.trim()) {
      toast.error('Please enter a wallet address');
      return;
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(newChatAddress)) {
      toast.error('Invalid wallet address format');
      return;
    }

    if (newChatAddress.toLowerCase() === currentUser?.walletAddress.toLowerCase()) {
      toast.error("You can't chat with yourself");
      return;
    }

    try {
      const address = newChatAddress.toLowerCase();
      const myAddress = currentUser!.walletAddress.toLowerCase();
      
      // Check if conversation already exists
      const existingConv = conversations.find(conv => 
        conv.participants.includes(address) && conv.participants.includes(myAddress)
      );

      if (existingConv) {
        setActiveConversation(existingConv.id);
        setShowNewChatModal(false);
        setNewChatAddress('');
        toast.success('Opened existing conversation');
        return;
      }

      // Create new conversation
      const conversationId = generateConversationId(myAddress, address);
      const newConversation: Conversation = {
        id: conversationId,
        type: 'direct',
        participants: [myAddress, address],
        unreadCount: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      // Save to database (use put to handle if already exists)
      await db.conversations.put(newConversation);
      
      // Add to store
      addConversation(newConversation);
      
      // Set as active
      setActiveConversation(conversationId);
      
      setShowNewChatModal(false);
      setNewChatAddress('');
      toast.success('New conversation created!');
    } catch (error) {
      console.error('Error creating conversation:', error);
      toast.error('Failed to create conversation');
    }
  };

  const handleLogout = () => {
    blockchainService.disconnect();
    useAppStore.getState().reset();
    window.location.reload();
  };

  return (
    <>
      <div className="w-80 bg-white border-r border-gray-200 flex flex-col h-screen">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-gray-900">Messages</h2>
            <div className="flex gap-2">
              {/* New Chat Button */}
              <button
                onClick={() => setShowNewChatModal(true)}
                className="p-2 bg-primary-500 hover:bg-primary-600 text-white rounded-full transition"
                title="New Chat"
              >
                <Plus size={20} />
              </button>
              <button className="p-2 hover:bg-gray-100 rounded-full transition">
                <Settings size={20} className="text-gray-600" />
              </button>
              <button
                onClick={handleLogout}
                className="p-2 hover:bg-gray-100 rounded-full transition"
                title="Logout"
              >
                <LogOut size={20} className="text-gray-600" />
              </button>
            </div>
          </div>

          {/* User Info */}
          {currentUser && (
            <div className="flex items-center gap-3 mb-4 p-3 bg-primary-50 rounded-lg">
              <div className={`w-10 h-10 rounded-full ${getAvatarColor(currentUser.walletAddress)} flex items-center justify-center text-white font-semibold`}>
                {getInitials(currentUser.username || currentUser.walletAddress)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900">{currentUser.username || 'Anonymous'}</p>
                <p className="text-xs text-gray-500 truncate">{truncateAddress(currentUser.walletAddress)}</p>
              </div>
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Conversations List */}
        <div className="flex-1 overflow-y-auto">
          {filteredConversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-400 px-4">
              <MessageSquarePlus size={48} className="mb-4 text-gray-300" />
              <p className="text-center font-medium">No conversations yet</p>
              <p className="text-sm text-center mt-1 mb-4">Start a new chat to begin messaging</p>
              <button
                onClick={() => setShowNewChatModal(true)}
                className="px-4 py-2 bg-primary-500 hover:bg-primary-600 text-white rounded-lg transition flex items-center gap-2"
              >
                <Plus size={18} />
                New Chat
              </button>
            </div>
          ) : (
            filteredConversations.map((conversation) => {
              const otherParticipant = conversation.participants.find(
                (p) => p !== currentUser?.walletAddress
              );
              const isActive = conversation.id === activeConversationId;

              return (
                <div
                  key={conversation.id}
                  onClick={() => setActiveConversation(conversation.id)}
                  className={`p-4 border-b border-gray-100 cursor-pointer transition ${
                    isActive ? 'bg-primary-50 border-l-4 border-l-primary-500' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-12 h-12 rounded-full ${getAvatarColor(otherParticipant || '')} flex items-center justify-center text-white font-semibold flex-shrink-0`}>
                      {getInitials(otherParticipant || '')}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <p className="font-semibold text-gray-900 truncate">
                          {truncateAddress(otherParticipant || '')}
                        </p>
                        {conversation.lastMessage && (
                          <span className="text-xs text-gray-500">
                            {formatTimestamp(conversation.lastMessage.timestamp)}
                          </span>
                        )}
                      </div>
                      {conversation.lastMessage ? (
                        <p className="text-sm text-gray-600 truncate">
                          {conversation.lastMessage.content.substring(0, 40)}
                          {conversation.lastMessage.content.length > 40 ? '...' : ''}
                        </p>
                      ) : (
                        <p className="text-sm text-gray-400 italic">No messages yet</p>
                      )}
                      {conversation.unreadCount > 0 && (
                        <span className="inline-block mt-1 px-2 py-0.5 bg-primary-500 text-white text-xs rounded-full">
                          {conversation.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* New Chat Modal */}
      {showNewChatModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-bold text-gray-900">New Chat</h3>
              <button
                onClick={() => setShowNewChatModal(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition"
              >
                <X size={20} className="text-gray-500" />
              </button>
            </div>

            <p className="text-gray-600 mb-4">
              Enter the wallet address of the person you want to chat with.
            </p>

            <input
              type="text"
              placeholder="0x..."
              value={newChatAddress}
              onChange={(e) => setNewChatAddress(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent mb-4"
            />

            <div className="flex gap-3">
              <button
                onClick={() => setShowNewChatModal(false)}
                className="flex-1 px-4 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleStartNewChat}
                className="flex-1 px-4 py-3 bg-primary-500 text-white rounded-lg hover:bg-primary-600 transition"
              >
                Start Chat
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
