import { create } from 'zustand';
import type { Session, Message } from '../types';

interface SessionState {
  currentSession: Session | null;
  sessions: Session[];
  messages: Message[];
  isProcessing: boolean;
  currentQueryId: string | null;

  setCurrentSession: (session: Session | null) => void;
  addSession: (session: Session) => void;
  addMessage: (message: Message) => void;
  updateMessage: (messageId: string, updates: Partial<Message>) => void;
  setProcessing: (isProcessing: boolean) => void;
  setCurrentQueryId: (queryId: string | null) => void;
  clearMessages: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  currentSession: null,
  sessions: [],
  messages: [],
  isProcessing: false,
  currentQueryId: null,

  setCurrentSession: (session) => set({ currentSession: session }),

  addSession: (session) => set((state) => ({
    sessions: [...state.sessions, session],
  })),

  addMessage: (message) => set((state) => ({
    messages: [...state.messages, message],
  })),

  updateMessage: (messageId, updates) => set((state) => ({
    messages: state.messages.map((msg) =>
      msg.id === messageId ? ({ ...msg, ...updates } as Message) : msg
    ),
  })),

  setProcessing: (isProcessing) => set({ isProcessing }),

  setCurrentQueryId: (queryId) => set({ currentQueryId: queryId }),

  clearMessages: () => set({ messages: [] }),
}));
