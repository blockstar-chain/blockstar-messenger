import { create } from 'zustand';

interface ChatState {
  conversations: any[];
  messages: Record<string, any[]>;
  loadConversations: () => Promise<void>;
  sendMessage: (conversationId: string, content: string) => Promise<void>;
}

export const useChatStore = create<ChatState>((set) => ({
  conversations: [],
  messages: {},
  loadConversations: async () => { set({ conversations: [] }); },
  sendMessage: async (conversationId: string, content: string) => { },
}));
