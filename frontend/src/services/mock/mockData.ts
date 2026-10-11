// Mock data for development and testing
import type { Session, User, Model, Provider } from '../../types/api';
import type { AgentEvent } from '../../types';

// Mock User
export const mockUser: User = {
  userId: 'usr_mock123',
  email: 'demo@dexter.ai',
  name: 'Demo User',
  plan: 'pro',
  createdAt: new Date().toISOString(),
};

// Mock Sessions
export const mockSessions: Session[] = [
  {
    sessionId: 'ses_001',
    name: 'Tech Stock Analysis',
    model: 'claude-sonnet-4-5',
    provider: 'anthropic',
    config: { maxIterations: 10 },
    queryCount: 5,
    createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 3600000).toISOString(),
  },
  {
    sessionId: 'ses_002',
    name: 'Apple Revenue Analysis',
    model: 'gpt-5.2',
    provider: 'openai',
    config: { maxIterations: 10 },
    queryCount: 3,
    createdAt: new Date(Date.now() - 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 7200000).toISOString(),
  },
  {
    sessionId: 'ses_003',
    name: 'Market Research',
    model: 'claude-sonnet-4-5',
    provider: 'anthropic',
    config: { maxIterations: 10 },
    queryCount: 8,
    createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
    updatedAt: new Date(Date.now() - 1800000).toISOString(),
  },
];

// Mock Models
export const mockProviders: Provider[] = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    models: [
      {
        id: 'claude-sonnet-4-5',
        name: 'Claude Sonnet 4.5',
        provider: 'anthropic',
        capabilities: ['chat', 'tools', 'cache'],
        contextWindow: 200000,
      },
      {
        id: 'claude-opus-4-6',
        name: 'Claude Opus 4.6',
        provider: 'anthropic',
        capabilities: ['chat', 'tools', 'cache'],
        contextWindow: 200000,
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    models: [
      {
        id: 'gpt-5.2',
        name: 'GPT-5.2',
        provider: 'openai',
        capabilities: ['chat', 'tools'],
        contextWindow: 128000,
      },
      {
        id: 'gpt-4.1',
        name: 'GPT-4.1',
        provider: 'openai',
        capabilities: ['chat', 'tools'],
        contextWindow: 32000,
      },
    ],
  },
];

// Mock Agent Events for a query
export const generateMockEvents = (queryText: string): AgentEvent[] => {
  const events: AgentEvent[] = [];

  // Thinking event
  events.push({
    type: 'thinking',
    message: 'Planning research approach for financial analysis...',
    timestamp: new Date().toISOString(),
  });

  // Tool start
  events.push({
    type: 'tool_start',
    tool: 'financial_search',
    args: { query: queryText },
    timestamp: new Date(Date.now() + 500).toISOString(),
  });

  // Tool end
  events.push({
    type: 'tool_end',
    tool: 'financial_search',
    args: { query: queryText },
    result: JSON.stringify({ data: { revenue: [274, 294, 365, 394], years: ['2020', '2021', '2022', '2023'] } }),
    duration: 2500,
    timestamp: new Date(Date.now() + 3000).toISOString(),
  });

  // Another thinking
  events.push({
    type: 'thinking',
    message: 'Analyzing data and preparing comprehensive answer...',
    timestamp: new Date(Date.now() + 3500).toISOString(),
  });

  // Answer start
  events.push({
    type: 'answer_start',
    timestamp: new Date(Date.now() + 4000).toISOString(),
  });

  // Done
  events.push({
    type: 'done',
    answer: `Based on the financial data analysis:\n\n**Revenue Growth Analysis:**\n\nThe company has shown strong revenue growth over the past 4 years:\n- 2020: $274B\n- 2021: $294B (+7.3%)\n- 2022: $365B (+24.1%)\n- 2023: $394B (+7.9%)\n\n**Key Insights:**\n1. Consistent year-over-year growth\n2. Particularly strong growth in 2022 (+24.1%)\n3. Total growth of 43.8% from 2020 to 2023\n\nThis indicates a healthy and expanding business with strong market positioning.`,
    toolCalls: 1,
    iterations: 2,
    totalTime: 4500,
    timestamp: new Date(Date.now() + 4500).toISOString(),
  });

  return events;
};

// Generate mock answer for a query
export const generateMockAnswer = (queryText: string): string => {
  return `Based on your query "${queryText}", here's a comprehensive analysis:\n\n## Key Findings\n\n1. **Data Analysis**: The research shows consistent patterns in the financial metrics.\n\n2. **Market Trends**: Current market conditions indicate positive momentum.\n\n3. **Recommendations**: Consider the following strategic approaches for investment decisions.\n\n*This is mock data for development testing.*`;
};
