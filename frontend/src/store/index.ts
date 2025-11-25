import { create } from 'zustand';
import { User, Conversation, Message, Call } from '@/types';

interface AppState {
  // User state
  currentUser: User | null;
  isAuthenticated: boolean;
  
  // Conversations
  conversations: Conversation[];
  activeConversationId: string | null;
  
  // Messages
  messages: Map<string, Message[]>;
  
  // Calls
  activeCall: Call | null;
  incomingCall: Call | null;
  
  // UI state
  isSidebarOpen: boolean;
  isCallModalOpen: boolean;
  
  // Actions
  setCurrentUser: (user: User | null) => void;
  setAuthenticated: (isAuthenticated: boolean) => void;
  
  setConversations: (conversations: Conversation[]) => void;
  addConversation: (conversation: Conversation) => void;
  updateConversation: (id: string, updates: Partial<Conversation>) => void;
  setActiveConversation: (id: string | null) => void;
  
  setMessages: (conversationId: string, messages: Message[]) => void;
  addMessage: (message: Message) => void;
  updateMessage: (id: string, updates: Partial<Message>) => void;
  
  setActiveCall: (call: Call | null) => void;
  setIncomingCall: (call: Call | null) => void;
  
  toggleSidebar: () => void;
  setCallModalOpen: (isOpen: boolean) => void;
  
  reset: () => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Initial state
  currentUser: null,
  isAuthenticated: false,
  conversations: [],
  activeConversationId: null,
  messages: new Map(),
  activeCall: null,
  incomingCall: null,
  isSidebarOpen: true,
  isCallModalOpen: false,

  // User actions
  setCurrentUser: (user) => set({ currentUser: user }),
  setAuthenticated: (isAuthenticated) => set({ isAuthenticated }),

  // Conversation actions
  setConversations: (conversations) => set({ conversations }),
  
  addConversation: (conversation) =>
    set((state) => {
      // Check if conversation already exists
      const exists = state.conversations.some(c => c.id === conversation.id);
      if (exists) {
        return state; // Don't add duplicate
      }
      return {
        conversations: [conversation, ...state.conversations],
      };
    }),
  
  updateConversation: (id, updates) =>
    set((state) => ({
      conversations: state.conversations.map((conv) =>
        conv.id === id ? { ...conv, ...updates } : conv
      ),
    })),
  
  setActiveConversation: (id) => set({ activeConversationId: id }),

  // Message actions
  setMessages: (conversationId, messages) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      newMessages.set(conversationId, messages);
      return { messages: newMessages };
    }),
  
  addMessage: (message) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      const conversationMessages = newMessages.get(message.conversationId) || [];
      
      // Check if message already exists (prevent duplicates)
      const exists = conversationMessages.some(m => m.id === message.id);
      if (exists) {
        return state; // Don't add duplicate
      }
      
      newMessages.set(message.conversationId, [...conversationMessages, message]);
      
      // Update conversation's last message
      const conversations = state.conversations.map((conv) =>
        conv.id === message.conversationId
          ? { ...conv, lastMessage: message, updatedAt: Date.now() }
          : conv
      );
      
      return { messages: newMessages, conversations };
    }),
  
  updateMessage: (id, updates) =>
    set((state) => {
      const newMessages = new Map(state.messages);
      
      newMessages.forEach((messages, conversationId) => {
        const updatedMessages = messages.map((msg) =>
          msg.id === id ? { ...msg, ...updates } : msg
        );
        newMessages.set(conversationId, updatedMessages);
      });
      
      return { messages: newMessages };
    }),

  // Call actions
  setActiveCall: (call) => set({ activeCall: call }),
  setIncomingCall: (call) => set({ incomingCall: call }),

  // UI actions
  toggleSidebar: () => set((state) => ({ isSidebarOpen: !state.isSidebarOpen })),
  setCallModalOpen: (isOpen) => set({ isCallModalOpen: isOpen }),

  // Reset state
  reset: () =>
    set({
      currentUser: null,
      isAuthenticated: false,
      conversations: [],
      activeConversationId: null,
      messages: new Map(),
      activeCall: null,
      incomingCall: null,
      isSidebarOpen: true,
      isCallModalOpen: false,
    }),
}));
