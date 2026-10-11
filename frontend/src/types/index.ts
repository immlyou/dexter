// Agent Event Types (基於後端架構分析)
export type AgentEventType =
  | 'thinking'
  | 'tool_start'
  | 'tool_progress'
  | 'tool_end'
  | 'tool_error'
  | 'tool_limit'
  | 'context_cleared'
  | 'answer_start'
  | 'done';

export interface BaseAgentEvent {
  type: AgentEventType;
  timestamp: string;
}

export interface ThinkingEvent extends BaseAgentEvent {
  type: 'thinking';
  message: string;
}

export interface ToolStartEvent extends BaseAgentEvent {
  type: 'tool_start';
  tool: string;
  args: Record<string, unknown>;
}

export interface ToolProgressEvent extends BaseAgentEvent {
  type: 'tool_progress';
  tool: string;
  message: string;
}

export interface ToolEndEvent extends BaseAgentEvent {
  type: 'tool_end';
  tool: string;
  args: Record<string, unknown>;
  result: string;
  duration: number;
}

export interface ToolErrorEvent extends BaseAgentEvent {
  type: 'tool_error';
  tool: string;
  error: string;
}

export interface ToolLimitEvent extends BaseAgentEvent {
  type: 'tool_limit';
  tool: string;
  warning?: string;
}

export interface ContextClearedEvent extends BaseAgentEvent {
  type: 'context_cleared';
  clearedCount: number;
  keptCount: number;
}

export interface AnswerStartEvent extends BaseAgentEvent {
  type: 'answer_start';
}

export interface DoneEvent extends BaseAgentEvent {
  type: 'done';
  answer: string;
  toolCalls: number;
  iterations: number;
  totalTime: number;
}

export type AgentEvent =
  | ThinkingEvent
  | ToolStartEvent
  | ToolProgressEvent
  | ToolEndEvent
  | ToolErrorEvent
  | ToolLimitEvent
  | ContextClearedEvent
  | AnswerStartEvent
  | DoneEvent;

// Message Types
export interface UserMessage {
  id: string;
  type: 'user';
  content: string;
  timestamp: string;
}

export interface AgentMessage {
  id: string;
  type: 'agent';
  content: string;
  events: AgentEvent[];
  status: 'processing' | 'completed' | 'error';
  timestamp: string;
}

export type Message = UserMessage | AgentMessage;

// Session Types
export interface Session {
  id: string;
  model: string;
  provider: string;
  createdAt: string;
  updatedAt: string;
}

// Model Types
export interface ModelProvider {
  id: string;
  name: string;
  models: Model[];
}

export interface Model {
  id: string;
  name: string;
  provider: string;
}

// Query Types
export interface QueryRequest {
  query: string;
}

export interface QueryResponse {
  queryId: string;
  status: 'processing' | 'completed' | 'error' | 'cancelled';
}

// WebSocket Message Types
export interface WSMessage {
  type: 'event' | 'error' | 'complete';
  data: AgentEvent | { error: string } | { answer: string };
}
