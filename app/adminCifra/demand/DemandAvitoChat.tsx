'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ExternalLink, MessageSquare, RefreshCw, Send } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';

function friendlyAvitoChatError(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('402') || m.includes('подписк') || m.includes('api мессенджера')) {
    return (
      'История чата пока недоступна: нужна подписка «API мессенджера» в Авито. ' +
      'Карточка и уведомление уже работают — переписку можно открыть кнопкой «В Авито».'
    );
  }
  if (m.includes('403') || m.includes('invalid access token')) {
    return 'Нет доступа к Messenger API (scopes messenger:read / messenger:write).';
  }
  return raw;
}

type Msg = {
  id: string;
  created: number | null;
  text: string;
  direction: string;
};

type Props = {
  chatId: string;
  chatUrl?: string | null;
  buyerHint?: string | null;
};

const box: CSSProperties = {
  marginTop: 12,
  border: '1px solid #334155',
  borderRadius: 12,
  overflow: 'hidden',
  background: '#0F172A',
};

/**
 * Чат Авито в карточке Спроса.
 * Без подписки API мессенджера сообщения не подгрузятся — UI остаётся как заготовка.
 */
export function DemandAvitoChat({ chatId, chatUrl, buyerHint }: Props) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const href =
    chatUrl || `https://www.avito.ru/profile/messenger/channel/${chatId}`;

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/adminCifra/marketplace/chats/${encodeURIComponent(chatId)}/messages?mark_read=1`,
        { headers: adminCifraAuthHeaders() },
      );
      const json = await res.json();
      if (!json.success) {
        const msg = friendlyAvitoChatError(json.error || 'Не удалось загрузить сообщения');
        setError(msg);
        setUnavailable(true);
        setMessages([]);
        return;
      }
      setUnavailable(false);
      setMessages(json.messages || []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка');
      setUnavailable(true);
    } finally {
      setLoading(false);
    }
  }, [chatId]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async () => {
    if (!text.trim() || unavailable) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/adminCifra/marketplace/chats/${encodeURIComponent(chatId)}/messages`,
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
      await loadMessages();
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={box}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          padding: '10px 12px',
          borderBottom: '1px solid #334155',
          background: '#1E2937',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <MessageSquare size={16} color="#93C5FD" />
          <span style={{ color: '#E2E8F0', fontWeight: 600, fontSize: 13 }}>
            Чат Авито{buyerHint ? ` · ${buyerHint}` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            onClick={() => void loadMessages()}
            title="Обновить"
            style={{
              border: 'none',
              background: 'transparent',
              color: '#94A3B8',
              cursor: 'pointer',
              padding: 4,
              display: 'inline-flex',
            }}
          >
            <RefreshCw size={15} />
          </button>
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            style={{
              color: '#93C5FD',
              fontSize: 12,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              textDecoration: 'none',
            }}
          >
            <ExternalLink size={13} /> В Авито
          </a>
        </div>
      </div>

      <div
        style={{
          minHeight: 120,
          maxHeight: 240,
          overflow: 'auto',
          padding: 12,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {loading && (
          <div style={{ color: '#64748B', fontSize: 13 }}>Загрузка переписки…</div>
        )}
        {!loading && unavailable && (
          <div style={{ color: '#FCD34D', fontSize: 13, lineHeight: 1.45 }}>
            {error ||
              'Чат подготовлен в карточке. История появится после подключения API мессенджера.'}
          </div>
        )}
        {!loading && !unavailable && messages.length === 0 && (
          <div style={{ color: '#64748B', fontSize: 13 }}>Сообщений пока нет</div>
        )}
        {messages.map((m) => {
          const mine = m.direction === 'out';
          return (
            <div
              key={m.id}
              style={{
                alignSelf: mine ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                padding: '8px 10px',
                borderRadius: 10,
                background: mine ? '#065F46' : '#1E2937',
                color: '#F1F5F9',
                fontSize: 13,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {m.text || '—'}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <div
        style={{
          display: 'flex',
          gap: 8,
          padding: 10,
          borderTop: '1px solid #334155',
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
          disabled={unavailable || sending}
          placeholder={
            unavailable
              ? 'Ответ — в Авито, пока нет подписки API'
              : 'Ответить в Авито…'
          }
          style={{
            flex: 1,
            borderRadius: 8,
            border: '1px solid #334155',
            background: '#0B1220',
            color: '#E2E8F0',
            padding: '8px 10px',
            fontSize: 13,
            opacity: unavailable ? 0.7 : 1,
          }}
        />
        <button
          type="button"
          disabled={unavailable || sending || !text.trim()}
          onClick={() => void send()}
          style={{
            border: 'none',
            borderRadius: 8,
            background: unavailable ? '#334155' : '#2563EB',
            color: '#fff',
            padding: '8px 12px',
            cursor: unavailable || sending ? 'not-allowed' : 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          <Send size={14} />
        </button>
      </div>
    </div>
  );
}
