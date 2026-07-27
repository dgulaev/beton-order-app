'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ExternalLink, RefreshCw, Send } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';

function friendlyAvitoChatError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('402') || m.includes('подписк') || m.includes('api мессенджера')) {
    return (
      'Авито требует подписку «API мессенджера» (для Товаров обычно тариф «Максимальный»), ' +
      'чтобы читать и отвечать в чатах из Цифры. Список чатов виден, история и ответ — после подписки. ' +
      'Пока можно открыть переписку кнопкой «В Авито».'
    );
  }
  if (m.includes('403') || m.includes('invalid access token')) {
    return (
      'Нет доступа к Messenger API. Проверь у приложения scopes messenger:read / messenger:write.'
    );
  }
  return raw;
}

type ChatRow = {
  id: string;
  buyer_name: string | null;
  last_text: string | null;
  last_direction: string | null;
  last_created: number | null;
  chat_url: string;
};

type Msg = {
  id: string;
  created: number | null;
  text: string;
  direction: string;
};

type Props = {
  listingId: number;
  listingTitle: string | null;
};

export function ListingChat({ listingId, listingTitle }: Props) {
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [loadingChats, setLoadingChats] = useState(true);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [narrow, setNarrow] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const apply = () => setNarrow(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    setActiveChatId(null);
    setMessages([]);
    setError(null);
  }, [listingId]);

  const loadChats = useCallback(async () => {
    setLoadingChats(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/adminCifra/marketplace/listings/${listingId}/chats`,
        { headers: adminCifraAuthHeaders() },
      );
      const json = await res.json();
      if (!json.success) {
        setError(friendlyAvitoChatError(json.error || 'Не удалось загрузить чаты'));
        setChats([]);
        return;
      }
      const next = (json.chats || []) as ChatRow[];
      setChats(next);
      setActiveChatId((prev) => {
        if (prev && next.some((c) => c.id === prev)) return prev;
        return next[0]?.id ?? null;
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка');
    } finally {
      setLoadingChats(false);
    }
  }, [listingId]);

  const loadMessages = useCallback(
    async (chatId: string) => {
      setLoadingMsgs(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/adminCifra/marketplace/chats/${encodeURIComponent(chatId)}/messages?mark_read=1`,
          { headers: adminCifraAuthHeaders() },
        );
        const json = await res.json();
        if (!json.success) {
          setError(friendlyAvitoChatError(json.error || 'Не удалось загрузить сообщения'));
          setMessages([]);
          return;
        }
        setMessages(json.messages || []);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Ошибка');
      } finally {
        setLoadingMsgs(false);
      }
    },
    [],
  );

  useEffect(() => {
    void loadChats();
  }, [listingId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeChatId) void loadMessages(activeChatId);
  }, [activeChatId, loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!activeChatId || !text.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/adminCifra/marketplace/chats/${encodeURIComponent(activeChatId)}/messages`,
        {
          method: 'POST',
          headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ text }),
        },
      );
      const json = await res.json();
      if (!json.success) {
        setError(friendlyAvitoChatError(json.error || 'Не отправилось'));
        return;
      }
      setText('');
      await loadMessages(activeChatId);
      await loadChats();
    } finally {
      setSending(false);
    }
  };

  const active = chats.find((c) => c.id === activeChatId);

  return (
    <div
      style={{
        marginTop: 16,
        border: '1px solid #334155',
        borderRadius: 12,
        overflow: 'hidden',
        background: '#0B1220',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid #1E293B',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ color: '#E2E8F0', fontWeight: 700, fontSize: 14 }}>
          Чаты по объявлению
          {listingTitle ? (
            <span style={{ color: '#94A3B8', fontWeight: 500 }}> · {listingTitle}</span>
          ) : null}
        </div>
        <button type="button" onClick={() => void loadChats()} style={iconBtn}>
          <RefreshCw size={14} /> Обновить
        </button>
      </div>

      {error && (
        <div
          style={{
            padding: '10px 12px',
            color: '#FDE68A',
            fontSize: 13,
            lineHeight: 1.45,
            background: '#422006',
            borderBottom: '1px solid #78350F',
          }}
        >
          {error}
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: narrow ? '1fr' : 'minmax(200px, 280px) minmax(0, 1fr)',
          minHeight: narrow ? undefined : 360,
        }}
      >
        <div
          style={{
            borderRight: narrow ? 'none' : '1px solid #1E293B',
            borderBottom: narrow ? '1px solid #1E293B' : 'none',
            maxHeight: narrow ? 180 : 480,
            overflowY: 'auto',
          }}
        >
          {loadingChats ? (
            <p style={{ color: '#64748B', padding: 12, fontSize: 13 }}>Загрузка чатов…</p>
          ) : chats.length === 0 ? (
            <p style={{ color: '#64748B', padding: 12, fontSize: 13 }}>
              Чатов по этому объявлению пока нет.
            </p>
          ) : (
            chats.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveChatId(c.id)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '10px 12px',
                  border: 'none',
                  borderBottom: '1px solid #1E293B',
                  background: c.id === activeChatId ? '#1E3A5F' : 'transparent',
                  color: '#E2E8F0',
                  cursor: 'pointer',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {c.buyer_name || 'Покупатель'}
                </div>
                <div
                  style={{
                    color: '#94A3B8',
                    fontSize: 12,
                    marginTop: 2,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {c.last_text || '—'}
                </div>
              </button>
            ))
          )}
        </div>

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            minHeight: narrow ? 280 : 360,
            minWidth: 0,
          }}
        >
          {active && (
            <div
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid #1E293B',
                display: 'flex',
                justifyContent: 'space-between',
                gap: 8,
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  color: '#CBD5E1',
                  fontSize: 13,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {active.buyer_name || 'Покупатель'}
              </span>
              <a
                href={active.chat_url}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: '#93C5FD',
                  fontSize: 12,
                  display: 'inline-flex',
                  gap: 4,
                  flexShrink: 0,
                }}
              >
                <ExternalLink size={12} /> В Авито
              </a>
            </div>
          )}

          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: 12,
              maxHeight: narrow ? 240 : 360,
              minWidth: 0,
            }}
          >
            {!activeChatId ? (
              <p style={{ color: '#64748B', fontSize: 13 }}>Выберите чат слева</p>
            ) : loadingMsgs ? (
              <p style={{ color: '#64748B', fontSize: 13 }}>Загрузка сообщений…</p>
            ) : messages.length === 0 ? (
              <p style={{ color: '#64748B', fontSize: 13 }}>Сообщений нет</p>
            ) : (
              messages.map((m) => {
                const out = m.direction === 'out';
                return (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      justifyContent: out ? 'flex-end' : 'flex-start',
                      marginBottom: 8,
                    }}
                  >
                    <div
                      style={{
                        maxWidth: '80%',
                        padding: '8px 10px',
                        borderRadius: 12,
                        background: out ? '#1D4ED8' : '#1E293B',
                        color: '#F8FAFC',
                        fontSize: 13,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                      }}
                    >
                      {m.text || '—'}
                      {m.created != null && (
                        <div style={{ fontSize: 10, opacity: 0.7, marginTop: 4 }}>
                          {new Date(m.created * 1000).toLocaleString('ru-RU', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
            <div ref={bottomRef} />
          </div>

          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: 10,
              borderTop: '1px solid #1E293B',
            }}
          >
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={!activeChatId || sending}
              placeholder={
                activeChatId
                  ? 'Ответ покупателю…'
                  : 'Сначала выберите чат'
              }
              style={{
                flex: 1,
                padding: '10px 12px',
                borderRadius: 10,
                border: '1px solid #334155',
                background: '#0F172A',
                color: '#F8FAFC',
              }}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={!activeChatId || sending || !text.trim()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 14px',
                borderRadius: 10,
                border: 'none',
                background: '#2563EB',
                color: '#fff',
                cursor: 'pointer',
                opacity: !activeChatId || sending || !text.trim() ? 0.5 : 1,
              }}
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const iconBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '6px 10px',
  borderRadius: 8,
  border: '1px solid #334155',
  background: '#0F172A',
  color: '#E2E8F0',
  cursor: 'pointer',
  fontSize: 12,
};
