import { useEffect, useRef, useState } from 'react';

// TypeScript类型定义
interface Source {
  filename: string;
  page: number;
  preview: string;
}

interface Event {
  type: 'thinking' | 'sources' | 'text' | 'error' | 'done';
  content?: string;
  sources?: Source[];
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  events?: Event[];
}

const API = 'http://127.0.0.1:8000';

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [currentEvents, setCurrentEvents] = useState<Event[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, currentEvents]);

  const uploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API}/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setFiles((prev) => [...prev, data.filename]);
        alert(`✅ 上传成功！${data.filename}，切分为${data.chunks}个片段`);
      }
    } catch (err) {
      alert('上传失败');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || loading) return;

    const query = input;
    setInput('');
    setLoading(true);
    setCurrentEvents([]);

    const userMessage: Message = { role: 'user', content: query };
    setMessages((prev) => [...prev, userMessage]);

    const history = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    try {
      const response = await fetch(`${API}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: query, history }),
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let textContent = '';
      let currentSources: Source[] = [];
      const events: Event[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6);

          try {
            const event: Event = JSON.parse(raw);
            events.push(event);

            if (event.type === 'thinking') {
              setCurrentEvents((prev) => [...prev, event]);
            } else if (event.type === 'sources') {
              currentSources = event.sources || [];
              setCurrentEvents((prev) => [...prev, event]);
            } else if (event.type === 'text') {
              textContent += event.content || '';
              setCurrentEvents((prev) => {
                const last = prev[prev.length - 1];
                if (last?.type === 'text') {
                  return [
                    ...prev.slice(0, -1),
                    { type: 'text', content: textContent },
                  ];
                }
                return [...prev, { type: 'text', content: textContent }];
              });
            } else if (event.type === 'done') {
              setMessages((prev) => [
                ...prev,
                {
                  role: 'assistant',
                  content: textContent,
                  sources: currentSources,
                },
              ]);
              setCurrentEvents([]);
            }
          } catch {}
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'sans-serif' }}>
      {/* 左侧：文件列表 */}
      <div
        style={{
          width: 240,
          background: '#f8f9fa',
          borderRight: '1px solid #e5e7eb',
          padding: 20,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15 }}>📁 知识库文档</h3>

        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{
            padding: '8px 12px',
            background: '#4F46E5',
            color: '#fff',
            border: 'none',
            borderRadius: 8,
            cursor: uploading ? 'not-allowed' : 'pointer',
            fontSize: 13,
          }}
        >
          {uploading ? '上传中...' : '+ 上传文档'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.txt"
          style={{ display: 'none' }}
          onChange={uploadFile}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {files.length === 0 && (
            <p style={{ color: '#999', fontSize: 12 }}>
              暂无文档，请上传PDF或TXT文件
            </p>
          )}
          {files.map((f, i) => (
            <div
              key={i}
              style={{
                padding: '6px 10px',
                background: '#fff',
                borderRadius: 6,
                fontSize: 12,
                border: '1px solid #e5e7eb',
                wordBreak: 'break-all',
              }}
            >
              📄 {f}
            </div>
          ))}
        </div>
      </div>

      {/* 右侧：对话区 */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 标题 */}
        <div
          style={{
            padding: '16px 24px',
            borderBottom: '1px solid #e5e7eb',
            fontWeight: 600,
            fontSize: 16,
          }}
        >
          🤖 AI 知识库助手
        </div>

        {/* 消息区 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '20px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {messages.length === 0 && currentEvents.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                color: '#999',
                marginTop: 80,
                fontSize: 14,
              }}
            >
              上传文档后，开始提问吧
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i}>
              {msg.role === 'user' ? (
                <div style={{ textAlign: 'right' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      background: '#4F46E5',
                      color: '#fff',
                      padding: '10px 16px',
                      borderRadius: 12,
                      maxWidth: '70%',
                      textAlign: 'left',
                    }}
                  >
                    {msg.content}
                  </span>
                </div>
              ) : (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  {/* 引用来源 */}
                  {msg.sources && msg.sources.length > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        gap: 6,
                        flexWrap: 'wrap',
                      }}
                    >
                      {msg.sources.map((s, j) => (
                        <div
                          key={j}
                          title={s.preview}
                          style={{
                            fontSize: 11,
                            padding: '3px 8px',
                            background: '#eff6ff',
                            border: '1px solid #bfdbfe',
                            borderRadius: 4,
                            color: '#1d4ed8',
                            cursor: 'default',
                          }}
                        >
                          📄 {s.filename} P{s.page}
                        </div>
                      ))}
                    </div>
                  )}
                  {/* 回答内容 */}
                  <div
                    style={{
                      background: '#fff',
                      border: '1px solid #e5e7eb',
                      borderRadius: 12,
                      padding: '12px 16px',
                      maxWidth: '80%',
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.7,
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* 实时事件流 */}
          {currentEvents.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                maxWidth: '80%',
              }}
            >
              {currentEvents.map((event, i) => {
                if (event.type === 'thinking') {
                  return (
                    <div
                      key={i}
                      style={{
                        background: '#f0f4ff',
                        border: '1px solid #c7d2fe',
                        borderRadius: 8,
                        padding: '6px 12px',
                        fontSize: 13,
                        color: '#4338ca',
                      }}
                    >
                      🤔 {event.content}
                    </div>
                  );
                }
                if (event.type === 'sources') {
                  return (
                    <div
                      key={i}
                      style={{
                        background: '#fff7ed',
                        border: '1px solid #fed7aa',
                        borderRadius: 8,
                        padding: '6px 12px',
                        fontSize: 13,
                        color: '#c2410c',
                      }}
                    >
                      🔍 检索到{event.sources?.length}个相关片段：
                      {event.sources?.map((s, j) => (
                        <span key={j} style={{ marginLeft: 6 }}>
                          📄{s.filename} P{s.page}
                        </span>
                      ))}
                    </div>
                  );
                }
                if (event.type === 'text') {
                  return (
                    <div
                      key={i}
                      style={{
                        background: '#fff',
                        border: '1px solid #e5e7eb',
                        borderRadius: 12,
                        padding: '12px 16px',
                        whiteSpace: 'pre-wrap',
                        lineHeight: 1.7,
                      }}
                    >
                      {event.content}▌
                    </div>
                  );
                }
                return null;
              })}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* 输入框 */}
        <div
          style={{
            padding: '16px 24px',
            borderTop: '1px solid #e5e7eb',
            display: 'flex',
            gap: 8,
          }}
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder={files.length > 0 ? '基于文档提问...' : '请先上传文档'}
            disabled={files.length === 0 || loading}
            style={{
              flex: 1,
              padding: '10px 14px',
              borderRadius: 8,
              border: '1px solid #ddd',
              fontSize: 14,
              outline: 'none',
            }}
          />
          <button
            onClick={sendMessage}
            disabled={loading || files.length === 0}
            style={{
              padding: '10px 24px',
              background: '#4F46E5',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              cursor: loading || files.length === 0 ? 'not-allowed' : 'pointer',
              opacity: loading || files.length === 0 ? 0.6 : 1,
              fontSize: 14,
            }}
          >
            {loading ? '思考中...' : '发送'}
          </button>
        </div>
      </div>
    </div>
  );
}
