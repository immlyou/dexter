import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from '../sessionStore';
import type { Session, Message, AgentMessage } from '../../types';

describe('sessionStore', () => {
  beforeEach(() => {
    // Reset store before each test
    const { setCurrentSession, clearMessages } = useSessionStore.getState();
    setCurrentSession(null);
    clearMessages();
    useSessionStore.setState({ sessions: [], isProcessing: false });
  });

  describe('Initial State', () => {
    it('should have correct initial state', () => {
      const state = useSessionStore.getState();
      expect(state.currentSession).toBeNull();
      expect(state.sessions).toEqual([]);
      expect(state.messages).toEqual([]);
      expect(state.isProcessing).toBe(false);
    });
  });

  describe('setCurrentSession', () => {
    it('should set current session', () => {
      const session: Session = {
        id: 'session-1',
        model: 'gpt-4',
        provider: 'openai',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const { setCurrentSession } = useSessionStore.getState();
      setCurrentSession(session);

      const state = useSessionStore.getState();
      expect(state.currentSession).toEqual(session);
    });

    it('should clear current session when set to null', () => {
      const session: Session = {
        id: 'session-1',
        model: 'gpt-4',
        provider: 'openai',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const { setCurrentSession } = useSessionStore.getState();
      setCurrentSession(session);
      setCurrentSession(null);

      const state = useSessionStore.getState();
      expect(state.currentSession).toBeNull();
    });
  });

  describe('addSession', () => {
    it('should add a new session to the list', () => {
      const session: Session = {
        id: 'session-1',
        model: 'gpt-4',
        provider: 'openai',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const { addSession } = useSessionStore.getState();
      addSession(session);

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(1);
      expect(state.sessions[0]).toEqual(session);
    });

    it('should add multiple sessions', () => {
      const session1: Session = {
        id: 'session-1',
        model: 'gpt-4',
        provider: 'openai',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const session2: Session = {
        id: 'session-2',
        model: 'claude-3',
        provider: 'anthropic',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const { addSession } = useSessionStore.getState();
      addSession(session1);
      addSession(session2);

      const state = useSessionStore.getState();
      expect(state.sessions).toHaveLength(2);
      expect(state.sessions).toEqual([session1, session2]);
    });

    it('should maintain immutability', () => {
      const session: Session = {
        id: 'session-1',
        model: 'gpt-4',
        provider: 'openai',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const { addSession } = useSessionStore.getState();
      const stateBefore = useSessionStore.getState();
      const sessionsBefore = stateBefore.sessions;

      addSession(session);

      const stateAfter = useSessionStore.getState();
      expect(stateAfter.sessions).not.toBe(sessionsBefore);
    });
  });

  describe('addMessage', () => {
    it('should add a user message', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'user',
        content: 'What is the revenue of AAPL?',
        timestamp: new Date().toISOString(),
      };

      const { addMessage } = useSessionStore.getState();
      addMessage(message);

      const state = useSessionStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toEqual(message);
    });

    it('should add an agent message', () => {
      const message: AgentMessage = {
        id: 'msg-2',
        type: 'agent',
        content: 'The revenue of Apple Inc. is $394B.',
        events: [],
        status: 'completed',
        timestamp: new Date().toISOString(),
      };

      const { addMessage } = useSessionStore.getState();
      addMessage(message);

      const state = useSessionStore.getState();
      expect(state.messages).toHaveLength(1);
      expect(state.messages[0]).toEqual(message);
    });

    it('should add multiple messages in order', () => {
      const userMsg: Message = {
        id: 'msg-1',
        type: 'user',
        content: 'Query',
        timestamp: new Date().toISOString(),
      };

      const agentMsg: AgentMessage = {
        id: 'msg-2',
        type: 'agent',
        content: 'Response',
        events: [],
        status: 'completed',
        timestamp: new Date().toISOString(),
      };

      const { addMessage } = useSessionStore.getState();
      addMessage(userMsg);
      addMessage(agentMsg);

      const state = useSessionStore.getState();
      expect(state.messages).toHaveLength(2);
      expect(state.messages).toEqual([userMsg, agentMsg]);
    });
  });

  describe('updateMessage', () => {
    it('should update message content', () => {
      const message: AgentMessage = {
        id: 'msg-1',
        type: 'agent',
        content: 'Initial content',
        events: [],
        status: 'processing',
        timestamp: new Date().toISOString(),
      };

      const { addMessage, updateMessage } = useSessionStore.getState();
      addMessage(message);

      updateMessage('msg-1', { content: 'Updated content' });

      const state = useSessionStore.getState();
      const updatedMsg = state.messages[0] as AgentMessage;
      expect(updatedMsg.content).toBe('Updated content');
      expect(updatedMsg.status).toBe('processing'); // unchanged
    });

    it('should update message status', () => {
      const message: AgentMessage = {
        id: 'msg-1',
        type: 'agent',
        content: 'Content',
        events: [],
        status: 'processing',
        timestamp: new Date().toISOString(),
      };

      const { addMessage, updateMessage } = useSessionStore.getState();
      addMessage(message);

      updateMessage('msg-1', { status: 'completed' });

      const state = useSessionStore.getState();
      const updatedMsg = state.messages[0] as AgentMessage;
      expect(updatedMsg.status).toBe('completed');
    });

    it('should not update non-matching message', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'user',
        content: 'Original',
        timestamp: new Date().toISOString(),
      };

      const { addMessage, updateMessage } = useSessionStore.getState();
      addMessage(message);

      updateMessage('msg-999', { content: 'New content' });

      const state = useSessionStore.getState();
      expect(state.messages[0].content).toBe('Original');
    });

    it('should maintain immutability', () => {
      const message: Message = {
        id: 'msg-1',
        type: 'user',
        content: 'Content',
        timestamp: new Date().toISOString(),
      };

      const { addMessage, updateMessage } = useSessionStore.getState();
      addMessage(message);

      const stateBefore = useSessionStore.getState();
      const messagesBefore = stateBefore.messages;

      updateMessage('msg-1', { content: 'Updated' });

      const stateAfter = useSessionStore.getState();
      expect(stateAfter.messages).not.toBe(messagesBefore);
    });
  });

  describe('setProcessing', () => {
    it('should set processing to true', () => {
      const { setProcessing } = useSessionStore.getState();
      setProcessing(true);

      const state = useSessionStore.getState();
      expect(state.isProcessing).toBe(true);
    });

    it('should set processing to false', () => {
      const { setProcessing } = useSessionStore.getState();
      setProcessing(true);
      setProcessing(false);

      const state = useSessionStore.getState();
      expect(state.isProcessing).toBe(false);
    });
  });

  describe('clearMessages', () => {
    it('should clear all messages', () => {
      const message1: Message = {
        id: 'msg-1',
        type: 'user',
        content: 'Query 1',
        timestamp: new Date().toISOString(),
      };

      const message2: Message = {
        id: 'msg-2',
        type: 'user',
        content: 'Query 2',
        timestamp: new Date().toISOString(),
      };

      const { addMessage, clearMessages } = useSessionStore.getState();
      addMessage(message1);
      addMessage(message2);

      expect(useSessionStore.getState().messages).toHaveLength(2);

      clearMessages();

      const state = useSessionStore.getState();
      expect(state.messages).toEqual([]);
    });

    it('should not affect other state properties', () => {
      const session: Session = {
        id: 'session-1',
        model: 'gpt-4',
        provider: 'openai',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const message: Message = {
        id: 'msg-1',
        type: 'user',
        content: 'Query',
        timestamp: new Date().toISOString(),
      };

      const { setCurrentSession, addMessage, setProcessing, clearMessages } =
        useSessionStore.getState();

      setCurrentSession(session);
      addMessage(message);
      setProcessing(true);

      clearMessages();

      const state = useSessionStore.getState();
      expect(state.currentSession).toEqual(session);
      expect(state.isProcessing).toBe(true);
      expect(state.messages).toEqual([]);
    });
  });
});
