import React, { useEffect, useState, useRef } from 'react';
import { useAppStore } from '@/store';
import { db, dbHelpers } from '@/lib/database';
import { webSocketService } from '@/lib/websocket';
import { webRTCService } from '@/lib/webrtc';
import { encryptionService } from '@/lib/encryption';
import { Message } from '@/types';
import { Send, Phone, Video, MoreVertical, Menu, Paperclip, Mic, Lock, Unlock, Search, X, Bell, BellOff } from 'lucide-react';
import { generateMessageId, generateConversationId, formatMessageTime, truncateAddress, getInitials, getAvatarColor, getAvatarUrl } from '@/utils/helpers';
import toast from 'react-hot-toast';

// Store for decrypted message content (in-memory cache)
const decryptedContentCache = new Map<string, string>();

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
  const [isEncrypted, setIsEncrypted] = useState(true);
  const [showChatMenu, setShowChatMenu] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isMuted, setIsMuted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const activeConversation = conversations.find((c) => c.id === activeConversationId);
  const conversationMessages = activeConversationId ? messages.get(activeConversationId) || [] : [];

  // Filter messages based on search query
  const filteredMessages = searchQuery
    ? conversationMessages.filter(msg =>
      msg.content.toLowerCase().includes(searchQuery.toLowerCase())
    )
    : conversationMessages;
  const otherParticipant = activeConversation?.participants.find(
    (p) => p.toLowerCase() !== currentUser?.walletAddress.toLowerCase()
  )?.toLowerCase();

  // Get user status (normalize address)
  const getStatus = (address: string) => {
    const status = userStatuses.get(address.toLowerCase());
    return status || 'offline';
  };

  // Fetch user status from API when conversation changes
  useEffect(() => {
    if (otherParticipant) {
      const fetchStatus = async () => {
        try {
          const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
          const response = await fetch(`${API_URL}/api/users/${otherParticipant.toLowerCase()}/status`);
          if (response.ok) {
            const data = await response.json();
            // Only set online if isOnline is true
            const status = data.isOnline ? 'online' : 'offline';
            setUserStatuses((prev) => {
              const newMap = new Map(prev);
              newMap.set(otherParticipant.toLowerCase(), status);
              return newMap;
            });
          }
        } catch (error) {
          // On error, assume offline
          setUserStatuses((prev) => {
            const newMap = new Map(prev);
            newMap.set(otherParticipant.toLowerCase(), 'offline');
            return newMap;
          });
        }
      };
      fetchStatus();

      // Refresh status every 30 seconds
      const interval = setInterval(fetchStatus, 30000);
      return () => clearInterval(interval);
    }
  }, [otherParticipant]);

  useEffect(() => {
    if (activeConversationId) {
      loadMessages();
    }
  }, [activeConversationId]);

  useEffect(() => {
    scrollToBottom();
  }, [conversationMessages]);

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowChatMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Load mute status from localStorage
  useEffect(() => {
    if (activeConversationId) {
      const mutedConvos = JSON.parse(localStorage.getItem('mutedConversations') || '[]');
      setIsMuted(mutedConvos.includes(activeConversationId));
      // Reset search when conversation changes
      setSearchMode(false);
      setSearchQuery('');
    }
  }, [activeConversationId]);

  // Listen for user status updates
  useEffect(() => {
    const unsubscribe = webSocketService.onStatus((data) => {
      const address = data.address.toLowerCase();
      setUserStatuses((prev) => {
        const newMap = new Map(prev);
        newMap.set(address, data.status);
        return newMap;
      });
    });

    return () => unsubscribe();
  }, []);

  // Listen for incoming messages and decrypt them
  useEffect(() => {
    const unsubscribe = webSocketService.onMessage(async (message) => {
      try {
        // Skip if we already have this message cached (already processed)
        if (decryptedContentCache.has(message.id)) {
          return;
        }

        // Skip messages sent by us (we already added them locally)
        if (message.senderId.toLowerCase() === currentUser?.walletAddress.toLowerCase()) {
          return;
        }

        console.log('Received message:', message);

        // Decrypt the message using sender's public key
        const { decrypted } = await encryptionService.decryptFromSender(
          message.content,
          message.senderId
        );

        // Store decrypted content in cache
        decryptedContentCache.set(message.id, decrypted);

        // Normalize addresses
        const senderId = message.senderId.toLowerCase();
        const recipientId = (typeof message.recipientId === 'string'
          ? message.recipientId
          : message.recipientId[0]).toLowerCase();

        // Generate consistent conversation ID
        const conversationId = generateConversationId(senderId, recipientId);

        // Create decrypted message for display
        const decryptedMessage = {
          ...message,
          content: decrypted,
          conversationId, // Use consistent conversation ID
          senderId,
          recipientId,
        };

        // Save message to DB (this will also create conversation if needed)
        await dbHelpers.saveMessage(decryptedMessage);

        // Check if conversation exists in store, if not add it
        const { conversations, addConversation } = useAppStore.getState();
        const convExists = conversations.some(c => c.id === conversationId);

        if (!convExists) {
          const newConv = {
            id: conversationId,
            type: 'direct' as const,
            participants: [senderId, recipientId],
            lastMessage: decryptedMessage,
            unreadCount: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          addConversation(newConv);
        }

        // Add message to store
        addMessage(decryptedMessage);

        // Mark as delivered
        webSocketService.markDelivered(message.id);

        // Show notification if not in active conversation
        if (conversationId !== activeConversationId) {
          toast(`New message from ${truncateAddress(senderId)}`);
        }
      } catch (error) {
        console.error('Error processing incoming message:', error);
      }
    });

    return () => unsubscribe();
  }, [activeConversationId, addMessage, currentUser?.walletAddress]);

  const loadMessages = async () => {
    if (!activeConversationId) return;

    try {
      const msgs = await dbHelpers.getConversationMessages(activeConversationId);

      // Decrypt all messages for display
      const decryptedMsgs = await Promise.all(
        msgs.map(async (msg) => {
          // Check cache first
          if (decryptedContentCache.has(msg.id)) {
            return { ...msg, content: decryptedContentCache.get(msg.id)! };
          }

          // If sent by current user, content should be plaintext
          if (msg.senderId === currentUser?.walletAddress) {
            return msg;
          }

          // Decrypt received messages
          const { decrypted } = await encryptionService.decryptFromSender(
            msg.content,
            msg.senderId
          );
          decryptedContentCache.set(msg.id, decrypted);
          return { ...msg, content: decrypted };
        })
      );

      setMessages(activeConversationId, decryptedMsgs);
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
      if (index > -1) {
        mutedConvos.splice(index, 1);
      }
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
        // Clear messages from database
        await db.messages.where('conversationId').equals(activeConversationId).delete();

        // Clear from store
        setMessages(activeConversationId, []);

        toast.success('Chat cleared!');
      } catch (error) {
        console.error('Error clearing chat:', error);
        toast.error('Failed to clear chat');
      }
    }
    setShowChatMenu(false);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 10MB');
      return;
    }

    if (!currentUser || !otherParticipant || !activeConversationId) {
      toast.error('Please select a conversation first');
      return;
    }

    setIsSending(true);
    const loadingToast = toast.loading(`Uploading ${file.name}...`);

    try {
      const API_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';

      // Upload file to server
      const formData = new FormData();
      formData.append('file', file);

      const response = await fetch(`${API_URL}/api/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        throw new Error('Upload failed');
      }

      const data = await response.json();

      // Create file message
      const senderId = currentUser.walletAddress.toLowerCase();
      const recipientId = otherParticipant.toLowerCase();

      // Determine message type based on file
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

      const message: Message = {
        id: generateMessageId(),
        conversationId: activeConversationId,
        senderId,
        recipientId,
        content: fileInfo,
        timestamp: Date.now(),
        delivered: false,
        read: false,
        type: messageType,
      };

      // Save locally
      await dbHelpers.saveMessage(message);
      addMessage(message);

      // Send via WebSocket
      webSocketService.sendMessage(message);

      toast.dismiss(loadingToast);
      toast.success('File sent!');
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.dismiss(loadingToast);
      toast.error('Failed to upload file');
    } finally {
      setIsSending(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!messageText.trim() || !currentUser || !otherParticipant || !activeConversationId) {
      console.log('Send blocked:', { messageText: !!messageText.trim(), currentUser: !!currentUser, otherParticipant: !!otherParticipant, activeConversationId });
      return;
    }

    setIsSending(true);
    const plainText = messageText.trim();

    try {
      // Normalize addresses to lowercase
      const senderId = currentUser.walletAddress.toLowerCase();
      const recipientId = otherParticipant.toLowerCase();

      // Encrypt message for recipient
      const { encrypted, error } = await encryptionService.encryptForRecipient(
        plainText,
        recipientId
      );

      if (error) {
        console.warn('Encryption warning:', error);
        // Continue with unencrypted if encryption fails
      }

      const message: Message = {
        id: generateMessageId(),
        conversationId: activeConversationId, // Use existing conversation ID
        senderId,
        recipientId,
        content: encrypted || plainText, // Use encrypted or fallback to plain
        timestamp: Date.now(),
        delivered: false,
        read: false,
        type: 'text',
      };

      console.log('Sending message:', { id: message.id, to: recipientId });

      // Cache the plaintext for local display
      decryptedContentCache.set(message.id, plainText);

      // Save locally with plaintext for our own display
      const localMessage = { ...message, content: plainText };
      await dbHelpers.saveMessage(localMessage);
      addMessage(localMessage);

      // Send encrypted via WebSocket
      webSocketService.sendMessage(message);

      setMessageText('');
    } catch (error) {
      console.error('Error sending message:', error);
      toast.error('Failed to send message');
    } finally {
      setIsSending(false);
    }
  };

  const handleStartCall = async (type: 'audio' | 'video') => {
    if (!otherParticipant || !currentUser) return;

    try {
      // Initialize local media stream
      toast.loading(`Starting ${type} call...`, { id: 'call-init' });

      const stream = await webRTCService.initializeLocalStream(type === 'audio');

      // Check if microphone is muted at system level
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0 && audioTracks[0].muted) {
        toast.dismiss('call-init');
        toast.error('🎤 Your microphone is muted in system settings! Please unmute it and try again.', { duration: 5000 });
        webRTCService.stopLocalStream();
        return;
      }

      const callId = `${currentUser.walletAddress.toLowerCase()}-${otherParticipant}-${Date.now()}`;
      let offerSent = false;

      // Create peer connection
      webRTCService.createCall(
        callId,
        type === 'audio',
        (signal) => {
          // SimplePeer sends both SDP offer and ICE candidates via onSignal
          // SDP offer has type: 'offer', ICE candidates have 'candidate' property
          if (signal.type === 'offer' && !offerSent) {
            console.log('Sending offer to recipient with callId:', callId);
            webSocketService.initiateCall(otherParticipant, type, signal, callId);
            offerSent = true;
          } else if (signal.candidate) {
            // This is an ICE candidate
            console.log('Sending ICE candidate to recipient');
            webSocketService.sendIceCandidate(otherParticipant, signal);
          }
        },
        (candidate) => {
          // This callback might not be used with SimplePeer's trickle
          console.log('Sending ICE candidate (onIceCandidate)');
          webSocketService.sendIceCandidate(otherParticipant, candidate);
        }
      );

      const call = {
        id: callId,
        callerId: currentUser.walletAddress.toLowerCase(),
        recipientId: otherParticipant,
        type,
        status: 'ringing' as const,
        startTime: Date.now(),
      };

      setActiveCall(call);
      setCallModalOpen(true);
      toast.dismiss('call-init');
      toast.success(`Calling...`);
    } catch (error: any) {
      toast.dismiss('call-init');
      console.error('Error starting call:', error);
      toast.error(error.message || 'Failed to start call. Check camera/microphone permissions.');
    }
  };

  if (!activeConversation) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="text-center text-gray-400">
          <p className="text-lg mb-2">Select a conversation to start messaging</p>
          <p className="text-sm">or start a new chat from the sidebar</p>
        </div>
      </div>
    );
  }

  const otherStatus = otherParticipant ? getStatus(otherParticipant) : 'offline';

  return (
    <div className="flex-1 flex flex-col h-screen">
      {/* Chat Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={toggleSidebar}
              className="lg:hidden p-2 hover:bg-gray-100 rounded-full"
            >
              <Menu size={20} />
            </button>
            <div className="relative">
              <img
                src={getAvatarUrl(activeConversation.username || otherParticipant || 'User', activeConversation.backgroundcolor)}
                className="w-12 h-12 rounded-full flex-shrink-0 object-cover"
              />
              {/* Online indicator */}
              <span
                className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${otherStatus === 'online' ? 'bg-green-500' :
                  otherStatus === 'away' ? 'bg-yellow-500' : 'bg-gray-400'
                  }`}
              />
            </div>
            <div className="space-y-1">
              <h3 className="font-semibold text-gray-900 ">
                {activeConversation.username}
              </h3>
              <div className="text-xs text-gray-500">{truncateAddress(otherParticipant || '')}</div>
              <div className="flex items-center gap-2">
                <p className={`text-xs ${otherStatus === 'online' ? 'text-green-500' :
                  otherStatus === 'away' ? 'text-yellow-500' : 'text-gray-400'
                  }`}>
                  {otherStatus === 'online' ? 'Online' :
                    otherStatus === 'away' ? 'Away' : 'Offline'}
                </p>
                <span className="text-xs text-gray-300">•</span>
                <span className="text-xs text-green-600 flex items-center gap-1">
                  <Lock size={10} />
                  E2E Encrypted
                </span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => handleStartCall('audio')}
              className="p-3 hover:bg-gray-100 rounded-full transition"
              title="Voice Call"
            >
              <Phone size={20} className="text-gray-600" />
            </button>
            <button
              onClick={() => handleStartCall('video')}
              className="p-3 hover:bg-gray-100 rounded-full transition"
              title="Video Call"
            >
              <Video size={20} className="text-gray-600" />
            </button>

            {/* Chat Menu Dropdown */}
            <div className="relative" ref={menuRef}>
              <button
                onClick={() => setShowChatMenu(!showChatMenu)}
                className="p-3 hover:bg-gray-100 rounded-full transition"
                title="More Options"
              >
                <MoreVertical size={20} className="text-gray-600" />
              </button>

              {showChatMenu && (
                <div className="absolute right-0 mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                  <button
                    onClick={handleToggleSearch}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                  >
                    <Search size={16} />
                    {searchMode ? 'Close Search' : 'Search in Chat'}
                  </button>
                  <button
                    onClick={handleToggleMute}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                  >
                    {isMuted ? (
                      <>
                        <Bell size={16} />
                        Unmute Notifications
                      </>
                    ) : (
                      <>
                        <BellOff size={16} />
                        Mute Notifications
                      </>
                    )}
                  </button>
                  <div className="border-t border-gray-200 my-1"></div>
                  <button
                    onClick={handleClearChat}
                    className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
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
        <div className="bg-white border-b border-gray-200 p-4">
          <div className="relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
              autoFocus
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X size={18} />
              </button>
            )}
          </div>
          {searchQuery && (
            <p className="text-xs text-gray-500 mt-2">
              Found {filteredMessages.length} message{filteredMessages.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
      )}

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-gray-50">
        {/* Encryption notice */}
        <div className="flex justify-center mb-4">
          <div className="bg-yellow-50 text-yellow-800 text-xs px-3 py-1 rounded-full flex items-center gap-1">
            <Lock size={12} />
            Messages are end-to-end encrypted
          </div>
        </div>

        {filteredMessages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-400">
            <p>{searchQuery ? 'No messages found matching your search.' : 'No messages yet. Start the conversation!'}</p>
          </div>
        ) : (
          filteredMessages.map((message, index) => {
            const isSender = message.senderId.toLowerCase() === currentUser?.walletAddress.toLowerCase();
            const showAvatar = index === 0 || filteredMessages[index - 1].senderId !== message.senderId;

            // Parse file info for file messages
            let fileInfo: { url: string; filename: string; mimetype: string; size: number } | null = null;
            if (message.type && message.type !== 'text') {
              try {
                fileInfo = JSON.parse(message.content);
              } catch {
                // Not a file message or invalid JSON
              }
            }

            const renderMessageContent = () => {
              // Image message
              if (message.type === 'image' && fileInfo) {
                return (
                  <div className="max-w-xs">
                    <img
                      src={fileInfo.url}
                      alt={fileInfo.filename}
                      className="rounded-lg max-w-full cursor-pointer hover:opacity-90"
                      onClick={() => window.open(fileInfo!.url, '_blank')}
                    />
                    <p className="text-xs mt-1 opacity-70">{fileInfo.filename}</p>
                  </div>
                );
              }

              // Video message
              if (message.type === 'video' && fileInfo) {
                return (
                  <div className="max-w-xs">
                    <video
                      src={fileInfo.url}
                      controls
                      className="rounded-lg max-w-full"
                    />
                    <p className="text-xs mt-1 opacity-70">{fileInfo.filename}</p>
                  </div>
                );
              }

              // Audio message
              if (message.type === 'audio' && fileInfo) {
                return (
                  <div className="min-w-[200px]">
                    <audio
                      src={fileInfo.url}
                      controls
                      className="w-full"
                    />
                    <p className="text-xs mt-1 opacity-70">{fileInfo.filename}</p>
                  </div>
                );
              }

              // Generic file message
              if (message.type === 'file' && fileInfo) {
                const formatSize = (bytes: number) => {
                  if (bytes < 1024) return bytes + ' B';
                  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
                  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
                };

                return (
                  <a
                    href={fileInfo.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 hover:opacity-80"
                  >
                    <div className={`p-2 rounded-lg ${isSender ? 'bg-primary-400' : 'bg-gray-100'}`}>
                      <Paperclip size={20} />
                    </div>
                    <div>
                      <p className="font-medium text-sm">{fileInfo.filename}</p>
                      <p className="text-xs opacity-70">{formatSize(fileInfo.size)}</p>
                    </div>
                  </a>
                );
              }

              // Text message (default)
              return <p className="break-words">{message.content}</p>;
            };

            return (
              <div
                key={message.id}
                className={`flex items-end gap-2 ${isSender ? 'flex-row-reverse' : 'flex-row'}`}
              >
                {showAvatar && !isSender && (
                  <div className={`w-8 h-8 rounded-full ${getAvatarColor(message.senderId)} flex items-center justify-center text-white text-xs font-semibold flex-shrink-0`}>
                    {getInitials(message.senderId)}
                  </div>
                )}
                {!showAvatar && !isSender && <div className="w-8" />}

                <div
                  className={`max-w-md px-4 py-2 rounded-2xl ${isSender
                    ? 'bg-primary-500 text-white'
                    : 'bg-white text-gray-900 border border-gray-200'
                    }`}
                >
                  {renderMessageContent()}
                  <div className={`flex items-center gap-1 mt-1 ${isSender ? 'justify-end' : 'justify-start'}`}>
                    <span className={`text-xs ${isSender ? 'text-primary-100' : 'text-gray-500'}`}>
                      {formatMessageTime(message.timestamp)}
                    </span>
                    {isSender && message.delivered && (
                      <span className="text-xs text-primary-100">✓</span>
                    )}
                    {isSender && message.read && (
                      <span className="text-xs text-primary-100">✓✓</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Input */}
      <div className="bg-white border-t border-gray-200 p-4">
        {/* Hidden file input */}
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
            className="p-2 hover:bg-gray-100 rounded-full transition"
            title="Attach file"
          >
            <Paperclip size={20} className="text-gray-500" />
          </button>
          <input
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            placeholder="Type a message..."
            disabled={isSending}
            className="flex-1 px-4 py-3 border border-gray-300 rounded-full focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
          <button
            type="button"
            className="p-2 hover:bg-gray-100 rounded-full transition"
            title="Voice message"
          >
            <Mic size={20} className="text-gray-500" />
          </button>
          <button
            type="submit"
            disabled={!messageText.trim() || isSending}
            className="p-3 bg-primary-500 text-white rounded-full hover:bg-primary-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={20} />
          </button>
        </form>
      </div>
    </div>
  );
}
