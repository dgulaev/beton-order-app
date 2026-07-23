'use client';

import { useState, useEffect } from 'react';
import { Globe } from 'lucide-react';
import { CARD_BORDER, volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';

export default function OnlinePage({ isGuest }: { isGuest?: boolean }) {
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const userId = typeof window !== 'undefined' ? localStorage.getItem('userId') : null;

  const loadOnline = async () => {
    if (!userId) return;

    try {
      setLoading(true);
      const res = await fetch(`/api/adminCifra/online?userId=${userId}`);

      if (!res.ok) {
        throw new Error('Нет доступа');
      }

      const data = await res.json();
      setOnlineUsers(data.online || []);
      setError('');
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки');
      setOnlineUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOnline();
    const interval = setInterval(loadOnline, 30000);
    return () => clearInterval(interval);
  }, []);

  if (isGuest) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>
        У вас нет прав для просмотра этой страницы.
      </div>
    );
  }

  return (
    <div style={{
      color: '#fff',
      flex: 1,
      minHeight: 0,
      width: '100%',
      display: 'flex',
      flexDirection: 'column',
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '14px',
        flexShrink: 0,
        gap: '16px',
        flexWrap: 'wrap',
      }}>
        <h1 style={{
          fontSize: '26px',
          fontWeight: 700,
          color: '#fff',
          margin: 0,
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
        }}>
          <Globe size={26} color="#94A3B8" />
          Кто в онлайн сейчас
        </h1>

        <div style={volumeCardSoftStyle({
          padding: '8px 14px',
          borderRadius: 12,
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          fontSize: '14px',
          fontWeight: 600,
          color: '#CBD5E1',
        })}>
          <span style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: '#22C55E',
            boxShadow: '0 0 0 3px rgba(34, 197, 94, 0.25)',
          }} />
          {loading ? 'Обновление…' : `${onlineUsers.length} онлайн`}
        </div>
      </div>

      {error && (
        <div style={volumeCardSoftStyle({
          padding: '12px 16px',
          borderRadius: 12,
          marginBottom: '12px',
          color: '#F87171',
          border: '1px solid rgba(248, 113, 113, 0.35)',
          flexShrink: 0,
        })}>
          {error}
        </div>
      )}

      <div className="scroll-hidden" style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        paddingBottom: '4px',
      }}>
        {loading && onlineUsers.length === 0 ? (
          <div style={volumeCardStyle({
            padding: '48px 24px',
            borderRadius: 18,
            textAlign: 'center',
            color: '#94A3B8',
          })}>
            Загрузка…
          </div>
        ) : onlineUsers.length === 0 ? (
          <div style={volumeCardStyle({
            padding: '48px 24px',
            borderRadius: 18,
            textAlign: 'center',
            color: '#64748B',
          })}>
            Никто не онлайн
          </div>
        ) : (
          onlineUsers.map((session: any, index: number) => {
            const user = session.users || {};
            const lastActive = new Date(session.last_active);
            const minutesAgo = Math.floor((Date.now() - lastActive.getTime()) / 60000);
            const agent = session.user_agent ? String(session.user_agent) : '';

            return (
              <div
                key={`${session.user_id}-${session.id || index}`}
                style={volumeCardStyle({
                  borderRadius: 18,
                  padding: '18px 20px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '20px',
                  border: CARD_BORDER,
                })}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{
                    fontSize: '18px',
                    fontWeight: 700,
                    marginBottom: '6px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {user.full_name || user.organization_name || 'Неизвестно'}
                  </div>
                  <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '4px' }}>
                    {user.role || '—'} • {session.ip || '—'}
                  </div>
                  {agent && (
                    <div style={{
                      color: '#64748B',
                      fontSize: '13px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {agent.length > 70 ? `${agent.substring(0, 70)}…` : agent}
                    </div>
                  )}
                </div>

                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={volumeCardSoftStyle({
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '7px',
                    padding: '6px 12px',
                    borderRadius: 10,
                    color: '#4ADE80',
                    fontWeight: 700,
                    fontSize: '14px',
                    marginBottom: '6px',
                    border: '1px solid rgba(74, 222, 128, 0.28)',
                  })}>
                    <span style={{
                      width: 7,
                      height: 7,
                      borderRadius: '50%',
                      background: '#22C55E',
                      boxShadow: '0 0 0 3px rgba(34, 197, 94, 0.22)',
                    }} />
                    Онлайн
                  </div>
                  <div style={{ color: '#64748B', fontSize: '13px' }}>
                    {minutesAgo} мин. назад
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
