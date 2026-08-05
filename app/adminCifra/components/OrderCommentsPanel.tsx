'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';
import { CARD_BORDER, modalFieldStyle, volumeCardSoftStyle } from '../cardStyles';

export type CommentReader = {
  user_id: number;
  user_name: string;
  read_at: string;
};

export type OrderComment = {
  id: number;
  order_id: number;
  user_id: number | null;
  user_name: string;
  user_role: string | null;
  body: string;
  created_at: string;
  is_read?: boolean;
  /** Кто открыл вкладку / прочитал (включая автора) */
  read_by?: CommentReader[];
};

function mergeReader(list: CommentReader[] | undefined, reader: CommentReader): CommentReader[] {
  const prev = list || [];
  if (prev.some((r) => Number(r.user_id) === Number(reader.user_id))) return prev;
  return [...prev, reader];
}

/** Имена прочитавших, кроме автора комментария */
function readerNamesExcludingAuthor(c: OrderComment): string[] {
  const authorId = Number(c.user_id);
  return (c.read_by || [])
    .filter((r) => Number(r.user_id) !== authorId)
    .map((r) => r.user_name.trim())
    .filter(Boolean);
}

const ROLE_LABELS: Record<string, string> = {
  admin: 'Админ',
  manager: 'Менеджер',
  dispatcher: 'Диспетчер',
  operator: 'Оператор',
  laborant: 'Лаборант',
  mehanik: 'Механик',
  logist: 'Логист',
};

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

interface Props {
  orderId: number;
  userName: string;
  userRole: string;
  /** Вызывается после mark-read / нового комментария — для обновления бейджей снаружи */
  onUnreadChange?: (unreadCount: number) => void;
  /** Высота ленты — через clamp, чтобы 1080 и 4K выглядели ровно */
  listMaxHeight?: string;
  /**
   * Вкладка сейчас видима. Если false (панель спрятана через visibility) —
   * не помечаем комментарии прочитанными, пока пользователь не откроет вкладку.
   */
  active?: boolean;
}

export default function OrderCommentsPanel({
  orderId,
  userName,
  userRole,
  onUnreadChange,
  listMaxHeight = 'clamp(180px, calc(180px + (100vh - 1080px) * 0.35), 480px)',
  active = true,
}: Props) {
  const [comments, setComments] = useState<OrderComment[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  /** id комментария, у которого раскрыт список прочитавших */
  const [expandedReadersId, setExpandedReadersId] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const markReadInFlightRef = useRef(false);
  const markReadPendingRef = useRef(false);
  const currentUserIdRef = useRef<number | null>(null);
  // Стабильные колбэки — иначе inline onUnreadChange у родителя
  // пересоздаёт эффекты и даёт лишние запросы.
  const onUnreadChangeRef = useRef(onUnreadChange);
  onUnreadChangeRef.current = onUnreadChange;
  const activeRef = useRef(active);
  activeRef.current = active;
  const commentsRef = useRef<OrderComment[]>([]);
  commentsRef.current = comments;

  useEffect(() => {
    const id = Number(localStorage.getItem('userId') || 0);
    currentUserIdRef.current = Number.isFinite(id) && id > 0 ? id : null;
  }, []);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const markRead = useCallback(async (oid: number) => {
    // Не блокируем по orderId навсегда: иначе после «прочитал → ушёл на Логистику →
    // пришёл новый коммент → снова Комментарии» markedRef залипал и новые
    // сообщения не помечались прочитанными.
    // Если уже летит запрос — ставим pending: иначе новый коммент, пришедший
    // во время in-flight, мог остаться непрочитанным в БД.
    if (markReadInFlightRef.current) {
      markReadPendingRef.current = true;
      return;
    }
    markReadInFlightRef.current = true;
    try {
      const res = await fetch('/api/adminCifra/order-comments/read', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ order_id: oid }),
      });
      if (!res.ok) {
        console.error('mark comments read: HTTP', res.status);
        return;
      }
      const json = await res.json().catch(() => ({}));
      const reader: CommentReader | null = json.reader
        ? {
            user_id: Number(json.reader.user_id),
            user_name: String(json.reader.user_name || userName || 'Сотрудник'),
            read_at: String(json.reader.read_at || new Date().toISOString()),
          }
        : currentUserIdRef.current
          ? {
              user_id: currentUserIdRef.current,
              user_name: userName || 'Сотрудник',
              read_at: new Date().toISOString(),
            }
          : null;

      setComments((prev) =>
        prev.map((c) => ({
          ...c,
          is_read: true,
          read_by: reader ? mergeReader(c.read_by, reader) : c.read_by,
        }))
      );
      onUnreadChangeRef.current?.(0);
    } catch (e) {
      console.error('mark comments read:', e);
    } finally {
      markReadInFlightRef.current = false;
      if (markReadPendingRef.current) {
        markReadPendingRef.current = false;
        void markRead(oid);
      }
    }
  }, [userName]);

  // Загрузка только при смене orderId — без зависимости от колбэков родителя
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setComments([]);
    setExpandedReadersId(null);

    (async () => {
      try {
        const res = await fetch(`/api/adminCifra/order-comments?orderId=${orderId}`, {
          headers: adminCifraAuthHeaders(),
          cache: 'no-store',
        });
        if (!res.ok || cancelled) return;
        const json = await res.json();
        const list: OrderComment[] = Array.isArray(json.data) ? json.data : [];
        if (cancelled) return;
        setComments(list);
        const unread = list.filter((c) => !c.is_read).length;
        onUnreadChangeRef.current?.(unread);
        scrollToBottom();
      } catch (e) {
        if (!cancelled) console.error('load comments:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [orderId, scrollToBottom]);

  // Помечаем прочитанным только когда вкладка реально открыта
  useEffect(() => {
    if (!active || loading) return;
    if (comments.length === 0) {
      onUnreadChangeRef.current?.(0);
      return;
    }
    void markRead(orderId);
  }, [active, loading, orderId, comments.length, markRead]);

  // Live: новые комментарии по этой заявке
  useRealtimeBroadcast({
    topic: 'order_comments:all',
    onInsert: (record) => {
      if (!record || Number(record.order_id) !== Number(orderId)) return;
      if (record.is_deleted) return;
      const mine = Number(record.user_id) === currentUserIdRef.current;
      const tabOpen = activeRef.current;
      const authorReader: CommentReader | undefined = mine
        ? {
            user_id: Number(record.user_id),
            user_name: String(record.user_name || 'Сотрудник'),
            read_at: String(record.created_at || new Date().toISOString()),
          }
        : undefined;
      setComments((prev) => {
        if (prev.some((c) => String(c.id) === String(record.id))) return prev;
        const next = [
          ...prev,
          {
            ...record,
            is_read: mine || tabOpen,
            read_by: authorReader ? [authorReader] : [],
          },
        ];
        if (!tabOpen && !mine) {
          const unread = next.filter(
            (c) => !c.is_read && Number(c.user_id) !== currentUserIdRef.current
          ).length;
          queueMicrotask(() => onUnreadChangeRef.current?.(unread));
        }
        return next;
      });
      scrollToBottom();
      if (tabOpen) {
        void markRead(orderId);
      }
    },
  });

  // Live: кто-то прочитал комментарий (нужен триггер order_comment_reads_broadcast)
  const orderIdRef = useRef(orderId);
  orderIdRef.current = orderId;
  const refreshReadersTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useRealtimeBroadcast({
    topic: 'order_comment_reads:all',
    onInsert: (record) => {
      if (!record?.comment_id) return;
      const cid = Number(record.comment_id);
      if (!commentsRef.current.some((c) => Number(c.id) === cid)) return;

      if (refreshReadersTimer.current) clearTimeout(refreshReadersTimer.current);
      refreshReadersTimer.current = setTimeout(async () => {
        try {
          const res = await fetch(
            `/api/adminCifra/order-comments?orderId=${orderIdRef.current}`,
            { headers: adminCifraAuthHeaders(), cache: 'no-store' }
          );
          if (!res.ok) return;
          const json = await res.json();
          const list: OrderComment[] = Array.isArray(json.data) ? json.data : [];
          setComments(list);
        } catch (e) {
          console.error('refresh readers:', e);
        }
      }, 250);
    },
  });

  useEffect(() => () => {
    if (refreshReadersTimer.current) clearTimeout(refreshReadersTimer.current);
  }, []);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const res = await fetch('/api/adminCifra/order-comments', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          order_id: orderId,
          body,
          user_name: userName,
          user_role: userRole,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        alert(json.message || 'Не удалось отправить комментарий');
        return;
      }
      setText('');
      if (json.data) {
        setComments((prev) => {
          if (prev.some((c) => String(c.id) === String(json.data.id))) return prev;
          return [...prev, { ...json.data, is_read: true }];
        });
        scrollToBottom();
      }
    } catch (e) {
      console.error('send comment:', e);
      alert('Ошибка отправки комментария');
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div
        ref={listRef}
        style={volumeCardSoftStyle({
          borderRadius: 16,
          padding: '12px 14px',
          maxHeight: listMaxHeight,
          minHeight: 120,
          overflowY: 'auto',
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
        })}
      >
        {loading && (
          <div style={{ color: '#64748B', fontSize: 13, textAlign: 'center', padding: 16 }}>
            Загрузка…
          </div>
        )}
        {!loading && comments.length === 0 && (
          <div style={{ color: '#64748B', fontSize: 13, textAlign: 'center', padding: 20 }}>
            Пока нет комментариев сотрудников
          </div>
        )}
        {comments.map((c) => {
          const role = c.user_role ? (ROLE_LABELS[c.user_role] || c.user_role) : '';
          const readerNames = readerNamesExcludingAuthor(c);
          const readCount = readerNames.length;
          const expanded = expandedReadersId === Number(c.id);
          return (
            <div
              key={c.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                paddingBottom: 10,
                borderBottom: CARD_BORDER,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: '#fff',
                  flexShrink: 0,
                }}>
                  {(c.user_name || '?').trim().charAt(0).toUpperCase()}
                </span>
                <span style={{ fontWeight: 700, fontSize: 13, color: '#E2E8F0' }}>
                  {c.user_name}
                </span>
                {role && (
                  <span style={{ fontSize: 12, color: '#64748B' }}>{role}</span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#64748B' }}>
                  {formatTime(c.created_at)}
                </span>
              </div>
              <div style={{
                marginLeft: 36,
                fontSize: 14,
                color: '#CBD5E1',
                lineHeight: 1.45,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}>
                {c.body}
              </div>
              <div style={{ marginLeft: 36, marginTop: 2 }}>
                {readCount > 0 ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedReadersId((prev) =>
                          prev === Number(c.id) ? null : Number(c.id)
                        )
                      }
                      style={{
                        background: 'none',
                        border: 'none',
                        padding: 0,
                        margin: 0,
                        color: '#64748B',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                        lineHeight: 1.35,
                      }}
                      title={expanded ? 'Скрыть список' : 'Показать кто прочитал'}
                    >
                      Прочитало {readCount}
                    </button>
                    {expanded && (
                      <div style={{
                        marginTop: 2,
                        fontSize: 11,
                        color: '#94A3B8',
                        lineHeight: 1.35,
                        wordBreak: 'break-word',
                      }}>
                        {readerNames.join(', ')}
                      </div>
                    )}
                  </>
                ) : (
                  <span style={{ fontSize: 11, color: '#475569', lineHeight: 1.35 }}>
                    Прочитало 0
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder="Написать комментарий… (Enter — отправить)"
          rows={2}
          style={modalFieldStyle({
            flex: 1,
            resize: 'none',
            borderRadius: 12,
            padding: '10px 12px',
            fontSize: 14,
            minHeight: 52,
            maxHeight: 120,
          })}
        />
        <button
          type="button"
          onClick={() => void send()}
          disabled={sending || !text.trim()}
          style={volumeCardSoftStyle({
            padding: '12px 18px',
            borderRadius: 12,
            color: '#E2E8F0',
            fontWeight: 700,
            fontSize: 13,
            cursor: sending || !text.trim() ? 'not-allowed' : 'pointer',
            opacity: sending || !text.trim() ? 0.5 : 1,
            whiteSpace: 'nowrap',
            height: 52,
          })}
        >
          {sending ? '…' : 'Отправить'}
        </button>
      </div>
    </div>
  );
}

/** Жёлтый компактный счётчик непрочитанных комментариев */
export function CommentUnreadBadge({ count }: { count: number }) {
  if (!count || count <= 0) return null;
  return (
    <span
      title={`Новых комментариев: ${count}`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 18,
        height: 18,
        padding: '0 5px',
        borderRadius: 999,
        background: '#FACC15',
        color: '#0F172A',
        fontSize: 11,
        fontWeight: 800,
        lineHeight: 1,
        boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
      }}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

/** Стиль вкладок Логистика / Комментарии — активная надпись салатовая */
export function orderModalTabStyle(active: boolean): React.CSSProperties {
  return {
    background: 'transparent',
    border: '1px solid transparent',
    color: active ? '#10B981' : '#94A3B8',
    borderRadius: 10,
    padding: '8px 12px',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  };
}
