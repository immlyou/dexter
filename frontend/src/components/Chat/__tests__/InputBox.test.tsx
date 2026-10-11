import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '../../../test/utils';
import userEvent from '@testing-library/user-event';
import InputBox from '../InputBox';
import { useSessionStore } from '../../../stores/sessionStore';

describe('InputBox', () => {
  beforeEach(() => {
    // Reset store
    useSessionStore.setState({
      // InputBox only submits when a session is selected
      currentSession: {
        sessionId: 'session-1',
        model: 'gpt-4',
        provider: 'openai',
        createdAt: '2026-02-11T00:00:00.000Z',
        updatedAt: '2026-02-11T00:00:00.000Z',
      },
      messages: [],
      isProcessing: false,
    });
    vi.clearAllTimers();
  });

  describe('Rendering', () => {
    it('should render input box with placeholder', () => {
      render(<InputBox />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      expect(textarea).toBeInTheDocument();
    });

    it('should render send button', () => {
      render(<InputBox />);

      const button = screen.getByRole('button', { name: /send/i });
      expect(button).toBeInTheDocument();
    });

    it('should show keyboard shortcut hint', () => {
      render(<InputBox />);

      expect(screen.getByText(/Press Enter to send/i)).toBeInTheDocument();
    });
  });

  describe('Input Behavior', () => {
    it('should allow typing in textarea', async () => {
      const user = userEvent.setup();
      render(<InputBox />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      await user.type(textarea, 'What is AAPL revenue?');

      expect(textarea).toHaveValue('What is AAPL revenue?');
    });

    it('should clear input after submission', async () => {
      const user = userEvent.setup();
      render(<InputBox />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      await user.type(textarea, 'Test query');

      const button = screen.getByRole('button', { name: /send/i });
      await user.click(button);

      expect(textarea).toHaveValue('');
    });
  });

  describe('Send Button', () => {
    it('should be disabled when input is empty', () => {
      render(<InputBox />);

      const button = screen.getByRole('button', { name: /send/i });
      expect(button).toBeDisabled();
    });

    it('should be enabled when input has text', async () => {
      const user = userEvent.setup();
      render(<InputBox />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      const button = screen.getByRole('button', { name: /send/i });

      expect(button).toBeDisabled();

      await user.type(textarea, 'Test');

      expect(button).toBeEnabled();
    });

    it('should be disabled when input is only whitespace', async () => {
      const user = userEvent.setup();
      render(<InputBox />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      await user.type(textarea, '   ');

      const button = screen.getByRole('button', { name: /send/i });
      expect(button).toBeDisabled();
    });

    it('should add message to store when clicked', async () => {
      const user = userEvent.setup();
      render(<InputBox />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      await user.type(textarea, 'Test query');

      const button = screen.getByRole('button', { name: /send/i });
      await user.click(button);

      const messages = useSessionStore.getState().messages;
      expect(messages).toHaveLength(2); // User + Agent message
      expect(messages[0].type).toBe('user');
      expect(messages[0].content).toBe('Test query');
    });

    it('should set processing state after submission', async () => {
      const user = userEvent.setup();
      render(<InputBox />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      await user.type(textarea, 'Test query');

      const button = screen.getByRole('button', { name: /send/i });
      await user.click(button);

      const isProcessing = useSessionStore.getState().isProcessing;
      expect(isProcessing).toBe(true);
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('should submit on Enter key', async () => {
      const user = userEvent.setup();
      render(<InputBox />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      await user.type(textarea, 'Test query{Enter}');

      const messages = useSessionStore.getState().messages;
      expect(messages).toHaveLength(2);
      expect(textarea).toHaveValue('');
    });

    it('should not submit on Shift+Enter', async () => {
      const user = userEvent.setup();
      render(<InputBox />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      await user.type(textarea, 'Line 1{Shift>}{Enter}{/Shift}Line 2');

      const messages = useSessionStore.getState().messages;
      expect(messages).toHaveLength(0);
      expect(textarea).toHaveValue('Line 1\nLine 2');
    });

    it('should not submit empty input on Enter', async () => {
      const user = userEvent.setup();
      render(<InputBox />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      await user.type(textarea, '{Enter}');

      const messages = useSessionStore.getState().messages;
      expect(messages).toHaveLength(0);
    });
  });

  describe('Disabled State', () => {
    it('should disable textarea when disabled prop is true', () => {
      render(<InputBox disabled={true} />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      expect(textarea).toBeDisabled();
    });

    it('should disable button when disabled prop is true', () => {
      render(<InputBox disabled={true} />);

      const button = screen.getByRole('button', { name: /send/i });
      expect(button).toBeDisabled();
    });

    it('should not submit when disabled', async () => {
      const user = userEvent.setup();
      render(<InputBox disabled={true} />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);

      // Try to type (won't work because disabled)
      await user.type(textarea, 'Test');

      const messages = useSessionStore.getState().messages;
      expect(messages).toHaveLength(0);
    });
  });

  describe('Message Creation', () => {
    it('should create user message with correct structure', async () => {
      const user = userEvent.setup();
      render(<InputBox />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      await user.type(textarea, 'Test query');

      const button = screen.getByRole('button', { name: /send/i });
      await user.click(button);

      const messages = useSessionStore.getState().messages;
      const userMessage = messages[0];

      expect(userMessage).toHaveProperty('id');
      expect(userMessage).toHaveProperty('type', 'user');
      expect(userMessage).toHaveProperty('content', 'Test query');
      expect(userMessage).toHaveProperty('timestamp');
    });

    it('should create agent message with processing status', async () => {
      const user = userEvent.setup();
      render(<InputBox />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      await user.type(textarea, 'Test query');

      const button = screen.getByRole('button', { name: /send/i });
      await user.click(button);

      const messages = useSessionStore.getState().messages;
      const agentMessage = messages[1];

      expect(agentMessage).toHaveProperty('id');
      expect(agentMessage).toHaveProperty('type', 'agent');
      expect(agentMessage).toHaveProperty('status', 'processing');
      expect(agentMessage).toHaveProperty('events');
    });

    it('should trim whitespace from query', async () => {
      const user = userEvent.setup();
      render(<InputBox />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      await user.type(textarea, '  Test query  ');

      const button = screen.getByRole('button', { name: /send/i });
      await user.click(button);

      const messages = useSessionStore.getState().messages;
      expect(messages[0].content).toBe('Test query');
    });
  });

  describe('Multiple Submissions', () => {
    it('should handle multiple submissions', async () => {
      const user = userEvent.setup();
      render(<InputBox />);

      const textarea = screen.getByPlaceholderText(/Ask about stocks/i);
      const button = screen.getByRole('button', { name: /send/i });

      // First submission
      await user.type(textarea, 'Query 1');
      await user.click(button);

      // Second submission
      await user.type(textarea, 'Query 2');
      await user.click(button);

      const messages = useSessionStore.getState().messages;
      expect(messages).toHaveLength(4); // 2 user + 2 agent messages
    });
  });
});
