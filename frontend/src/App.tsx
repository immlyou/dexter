import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import wsClient from './services/websocket';
import apiClient from './services/api';
import { watchQuery } from './services/query-stream';
import type { AgentEvent } from './types';

// Create a client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

type EventDisplay = AgentEvent & {
  id: string;
};

// Event display component
function EventItem({ event }: { event: EventDisplay }) {
  const getEventColor = (type: string) => {
    switch (type) {
      case 'thinking': return '#2196F3';
      case 'tool_start': return '#9C27B0';
      case 'tool_progress': return '#FF9800';
      case 'tool_end': return '#4CAF50';
      case 'tool_error': return '#F44336';
      case 'tool_limit': return '#FF5722';
      case 'answer_start': return '#00BCD4';
      case 'done': return '#4CAF50';
      default: return '#757575';
    }
  };

  const getEventIcon = (type: string) => {
    switch (type) {
      case 'thinking': return '🤔';
      case 'tool_start': return '🔧';
      case 'tool_progress': return '⏳';
      case 'tool_end': return '✅';
      case 'tool_error': return '❌';
      case 'tool_limit': return '⚠️';
      case 'answer_start': return '💬';
      case 'done': return '🎉';
      default: return '📝';
    }
  };

  const renderEventContent = () => {
    switch (event.type) {
      case 'thinking':
        return <span>{event.message}</span>;
      case 'tool_start':
        return <span>開始執行工具: <strong>{event.tool}</strong></span>;
      case 'tool_progress':
        return <span>{event.tool}: {event.message}</span>;
      case 'tool_end':
        return <span>完成: <strong>{event.tool}</strong> ({event.duration}ms)</span>;
      case 'tool_error':
        return <span>錯誤: <strong>{event.tool}</strong> - {event.error}</span>;
      case 'tool_limit':
        return <span>工具限制: <strong>{event.tool}</strong></span>;
      case 'answer_start':
        return <span>開始回答...</span>;
      case 'done':
        return <span>✨ 完成！迭代次數: {event.iterations}, 總時間: {event.totalTime}ms</span>;
      default:
        return <span>{JSON.stringify(event)}</span>;
    }
  };

  return (
    <div style={{
      padding: '10px 15px',
      borderBottom: '1px solid #e0e0e0',
      fontSize: '13px',
      display: 'flex',
      alignItems: 'flex-start',
      gap: '10px',
    }}>
      <span style={{ fontSize: '16px', flexShrink: 0 }}>
        {getEventIcon(event.type)}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{
          fontWeight: 'bold',
          color: getEventColor(event.type),
          marginBottom: '3px',
        }}>
          {event.type.toUpperCase().replace('_', ' ')}
        </div>
        <div style={{ color: '#555' }}>
          {renderEventContent()}
        </div>
      </div>
    </div>
  );
}

function MainApp() {
  const [sessionId, setSessionId] = useState<string>('');
  const [query, setQuery] = useState('');
  const [answer, setAnswer] = useState('');
  const [queryError, setQueryError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [events, setEvents] = useState<EventDisplay[]>([]);
  const [currentQueryId, setCurrentQueryId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'plain' | 'markdown'>('plain');
  const eventsEndRef = useRef<HTMLDivElement>(null);
  const stopQueryRef = useRef<(() => void) | undefined>(undefined);
  const requestVersionRef = useRef(0);

  useEffect(() => () => {
    requestVersionRef.current++;
    stopQueryRef.current?.();
  }, []);

  // Auto-scroll to latest event
  useEffect(() => {
    eventsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  const handleLogout = async () => {
    requestVersionRef.current++;
    stopQueryRef.current?.();
    wsClient.disconnect();
    await apiClient.logout();
  };

  const downloadReport = () => {
    if (!answer) return;

    const reportContent = `# Dexter 研究報告

## 查詢問題
${query}

## 執行時間
${new Date().toLocaleString('zh-TW')}

## 執行過程
${events.map(e => {
  switch (e.type) {
    case 'thinking': return `🤔 思考: ${e.message}`;
    case 'tool_start': return `🔧 開始工具: ${e.tool}`;
    case 'tool_end': return `✅ 完成工具: ${e.tool} (${e.duration}ms)`;
    case 'tool_error': return `❌ 工具錯誤: ${e.tool} - ${e.error}`;
    case 'done': return `🎉 完成! 迭代: ${e.iterations}, 時間: ${e.totalTime}ms`;
    default: return `${e.type}`;
  }
}).join('\n')}

## AI 分析結果
${answer}

---
生成於: Dexter Financial Research AI
Session ID: ${sessionId}
Query ID: ${currentQueryId}
`;

    const blob = new Blob([reportContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dexter-report-${Date.now()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyReport = () => {
    if (!answer) return;

    navigator.clipboard.writeText(answer).then(() => {
      alert('✅ 報告已複製到剪貼簿！');
    }).catch(() => {
      alert('❌ 複製失敗');
    });
  };

  const createSession = async () => {
    try {
      const session = await apiClient.createSession({
        name: 'Research Session',
        model: 'claude-sonnet-4-5',
        provider: 'anthropic',
      });
      setSessionId(session.sessionId);
      alert('Session 創建成功！');
    } catch (error: any) {
      const errorMsg = error?.response?.data?.error?.message || error.message || '未知錯誤';
      alert('錯誤: ' + errorMsg);
    }
  };

  const submitQuery = async () => {
    if (!sessionId) {
      alert('請先創建 Session');
      return;
    }

    stopQueryRef.current?.();
    const requestVersion = ++requestVersionRef.current;
    setIsLoading(true);
    setAnswer('');
    setQueryError('');
    setEvents([]);

    try {
      const result = await apiClient.createQuery({
        sessionId,
        query,
      });

      if (requestVersion !== requestVersionRef.current) return;
      const queryId = result.queryId;
      setCurrentQueryId(queryId);

      stopQueryRef.current = watchQuery(queryId, {
        onEvent: (event) => {
          setEvents((prev) => [...prev, { ...event, id: crypto.randomUUID() }]);
        },
        onComplete: (finalAnswer) => {
          setAnswer(finalAnswer);
          setIsLoading(false);
        },
        onError: (message) => {
          setQueryError(message);
          setIsLoading(false);
        },
      });
    } catch (error: any) {
      if (requestVersion !== requestVersionRef.current) return;
      const errorMsg = error?.response?.data?.error?.message || error.message || '未知錯誤';
      setQueryError(errorMsg);
      setIsLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '40px 20px',
    }}>
      <div style={{
        maxWidth: '800px',
        margin: '0 auto',
        background: 'white',
        borderRadius: '12px',
        padding: '30px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '30px',
          borderBottom: '2px solid #f0f0f0',
          paddingBottom: '20px',
        }}>
          <div>
            <h1 style={{ margin: '0 0 5px 0', color: '#333' }}>
              🤖 Dexter
            </h1>
            <p style={{ margin: 0, color: '#666' }}>Financial Research AI</p>
          </div>
          <button
            onClick={handleLogout}
            style={{
              padding: '8px 16px',
              background: '#f44336',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            登出
          </button>
        </div>

        {/* Session Section */}
        <div style={{ marginBottom: '30px' }}>
          <h3 style={{ marginTop: 0 }}>1. 創建研究 Session</h3>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button
              onClick={createSession}
              disabled={!!sessionId}
              style={{
                padding: '10px 20px',
                background: sessionId ? '#ccc' : '#667eea',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: sessionId ? 'not-allowed' : 'pointer',
                fontSize: '14px',
              }}
            >
              創建 Session
            </button>
            {sessionId && (
              <span style={{ color: '#4caf50', fontSize: '14px' }}>
                ✅ Session ID: {sessionId.substring(0, 8)}...
              </span>
            )}
          </div>
        </div>

        {/* Query Section */}
        <div style={{ marginBottom: '30px' }}>
          <h3 style={{ marginTop: 0 }}>2. 提交財務問題</h3>
          <textarea
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例如：What is Apple's revenue growth over the past 5 years?"
            disabled={!sessionId || isLoading}
            style={{
              width: '100%',
              minHeight: '100px',
              padding: '12px',
              border: '1px solid #ddd',
              borderRadius: '6px',
              fontSize: '14px',
              resize: 'vertical',
              marginBottom: '10px',
            }}
          />
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button
              onClick={submitQuery}
              disabled={!sessionId || !query || isLoading}
              style={{
                padding: '10px 20px',
                background: (!sessionId || !query || isLoading) ? '#ccc' : '#4caf50',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: (!sessionId || !query || isLoading) ? 'not-allowed' : 'pointer',
                fontSize: '14px',
              }}
            >
              {isLoading ? '查詢中...' : '提交查詢'}
            </button>
            <button
              onClick={() => {
                console.log('Test button clicked');
                setAnswer('# 測試報告\n\n這是一個測試答案，用來驗證顯示功能是否正常。\n\n## 測試內容\n\n- 項目 1\n- 項目 2\n- 項目 3\n\n**粗體文字** 和 *斜體文字*');
                console.log('Test answer set');
              }}
              style={{
                padding: '10px 20px',
                background: '#FF9800',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              🧪 測試顯示
            </button>
            {isLoading && (
              <span style={{ color: '#666', fontSize: '14px', lineHeight: '40px' }}>
                處理中...
              </span>
            )}
            {answer && (
              <span style={{ color: '#4caf50', fontSize: '14px', lineHeight: '40px' }}>
                ✅ 已完成 (長度: {answer.length})
              </span>
            )}
          </div>
        </div>

        {queryError && (
          <div role="alert" style={{ color: '#b71c1c', marginBottom: '20px' }}>
            錯誤: {queryError}
          </div>
        )}

        {/* Events Section */}
        {events.length > 0 && (
          <div style={{ marginBottom: '20px' }}>
            <h3 style={{ marginTop: 0 }}>3. 執行過程 (即時)</h3>
            <div style={{
              maxHeight: '300px',
              overflowY: 'auto',
              border: '1px solid #e0e0e0',
              borderRadius: '6px',
              background: '#f8f9fa',
            }}>
              {events.map((event) => (
                <EventItem key={event.id} event={event} />
              ))}
              <div ref={eventsEndRef} />
            </div>
          </div>
        )}

        {/* Debug Info */}
        {isLoading && (
          <div style={{
            marginBottom: '20px',
            padding: '10px',
            background: '#fff3cd',
            borderRadius: '6px',
            fontSize: '14px'
          }}>
            ⏳ 正在處理查詢...
          </div>
        )}

        {/* Answer Section */}
        {answer && (
          <div style={{ marginBottom: '20px' }}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '15px'
            }}>
              <div>
                <h3 style={{ margin: 0 }}>4. AI 最終回答</h3>
                <div style={{ marginTop: '8px', display: 'flex', gap: '10px' }}>
                  <button
                    onClick={() => setViewMode('plain')}
                    style={{
                      padding: '6px 12px',
                      background: viewMode === 'plain' ? '#667eea' : '#e0e0e0',
                      color: viewMode === 'plain' ? 'white' : '#666',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    純文字
                  </button>
                  <button
                    onClick={() => setViewMode('markdown')}
                    style={{
                      padding: '6px 12px',
                      background: viewMode === 'markdown' ? '#667eea' : '#e0e0e0',
                      color: viewMode === 'markdown' ? 'white' : '#666',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      fontSize: '13px',
                    }}
                  >
                    📄 格式化預覽
                  </button>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={copyReport}
                  style={{
                    padding: '8px 16px',
                    background: '#2196F3',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  📋 複製報告
                </button>
                <button
                  onClick={downloadReport}
                  style={{
                    padding: '8px 16px',
                    background: '#4caf50',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    fontSize: '14px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                  }}
                >
                  💾 下載報告
                </button>
              </div>
            </div>
            <div style={{
              padding: '20px',
              background: '#e8f5e9',
              border: '2px solid #4caf50',
              borderRadius: '6px',
              lineHeight: '1.6',
              maxHeight: '600px',
              overflowY: 'auto',
            }}>
              {viewMode === 'plain' ? (
                <div style={{ whiteSpace: 'pre-wrap' }}>{answer}</div>
              ) : (
                <div className="markdown-preview" style={{
                  color: '#333',
                  fontSize: '15px',
                }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {answer}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Info */}
        <div style={{
          marginTop: '30px',
          padding: '15px',
          background: '#e3f2fd',
          border: '1px solid #2196F3',
          borderRadius: '6px',
          fontSize: '14px',
        }}>
          <p style={{ margin: '0 0 5px 0' }}>
            <strong>ℹ️ 功能說明：</strong>
          </p>
          <ul style={{ margin: '5px 0 0 20px', paddingLeft: 0 }}>
            <li>Agent 使用 Claude Sonnet 4.5 模型</li>
            <li>支援即時 WebSocket 事件流</li>
            <li>可以執行工具（搜尋、分析、計算）</li>
            <li>自動顯示執行過程和最終答案</li>
          </ul>
        </div>

        {/* Status */}
        <div style={{
          marginTop: '20px',
          padding: '10px',
          background: '#e8f5e9',
          borderRadius: '6px',
          fontSize: '12px',
          color: '#666',
        }}>
          <p style={{ margin: 0 }}>
            後端 API: http://localhost:8000 ✅ |
            WebSocket: ws://localhost:8000/stream ✅
          </p>
        </div>
      </div>
    </div>
  );
}

function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [isRegister, setIsRegister] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      if (isRegister) {
        await apiClient.register({ email, password, name });
      } else {
        await apiClient.login({ email, password });
      }
      window.location.reload();
    } catch (error: any) {
      const errorMsg = error?.response?.data?.error?.message || error.message || '未知錯誤';
      alert('錯誤: ' + errorMsg);
    }
  };

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    }}>
      <div style={{
        background: 'white',
        padding: '40px',
        borderRadius: '12px',
        boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
        width: '400px',
      }}>
        <h1 style={{ margin: '0 0 10px 0', color: '#333' }}>🤖 Dexter</h1>
        <p style={{ color: '#666', marginBottom: '30px' }}>Financial Research AI</p>

        <form onSubmit={handleSubmit}>
          {isRegister && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', marginBottom: '5px', color: '#555' }}>姓名</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required={isRegister}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: '1px solid #ddd',
                  borderRadius: '6px',
                  fontSize: '16px',
                }}
              />
            </div>
          )}

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '5px', color: '#555' }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '16px',
              }}
            />
          </div>

          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'block', marginBottom: '5px', color: '#555' }}>密碼</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              style={{
                width: '100%',
                padding: '10px',
                border: '1px solid #ddd',
                borderRadius: '6px',
                fontSize: '16px',
              }}
            />
            <small style={{ color: '#999' }}>至少 8 個字符</small>
          </div>

          <button
            type="submit"
            style={{
              width: '100%',
              padding: '12px',
              background: '#667eea',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '16px',
              fontWeight: 'bold',
              cursor: 'pointer',
              marginBottom: '15px',
            }}
          >
            {isRegister ? '註冊' : '登入'}
          </button>

          <button
            type="button"
            onClick={() => setIsRegister(!isRegister)}
            style={{
              width: '100%',
              padding: '10px',
              background: 'transparent',
              color: '#667eea',
              border: '1px solid #667eea',
              borderRadius: '6px',
              fontSize: '14px',
              cursor: 'pointer',
            }}
          >
            {isRegister ? '已有帳號？登入' : '需要帳號？註冊'}
          </button>
        </form>
      </div>
    </div>
  );
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    setIsLoggedIn(!!token);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      {isLoggedIn ? <MainApp /> : <LoginPage />}
    </QueryClientProvider>
  );
}

export default App;
