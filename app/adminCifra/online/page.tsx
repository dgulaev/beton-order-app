'use client';

import { useState, useEffect } from 'react';
import { Globe } from 'lucide-react';

export default function OnlinePage({ isGuest }: { isGuest?: boolean }) {
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const userId = localStorage.getItem('userId');

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
    } catch (err: any) {
      setError(err.message || 'Ошибка загрузки');
      setOnlineUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOnline();
    const interval = setInterval(loadOnline, 30000); // обновление каждые 30 секунд
    return () => clearInterval(interval);
  }, []);

  if (isGuest) {
    return <div style={{ padding: '40px', textAlign: 'center', color: '#94A3B8' }}>У вас нет прав для просмотра этой страницы.</div>;
  }

  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ fontSize: '26px', fontWeight: 700, color: '#fff', marginTop: 0, marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Globe size={26} color="#94A3B8" />
        Кто в онлайн сейчас
      </h1>

      {loading && <div>Загрузка...</div>}
      {error && <div style={{ color: '#ef4444' }}>{error}</div>}

      <div style={{ display: 'grid', gap: '12px' }}>
        {onlineUsers.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748B' }}>
            Никто не онлайн
          </div>
        ) : (
          onlineUsers.map((session: any, index: number) => {
            const user = session.users || {};
            const lastActive = new Date(session.last_active);
            const minutesAgo = Math.floor((Date.now() - lastActive.getTime()) / 60000);

            return (
              <div 
                key={`${session.user_id}-${session.id || index}`}   // ← Исправлено: уникальный ключ
                style={{
                  background: '#1E2937',
                  padding: '20px',
                  borderRadius: '16px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <div>
                  <div style={{ fontSize: '18px', fontWeight: '600' }}>
                    {user.full_name || user.organization_name || 'Неизвестно'}
                  </div>
                  <div style={{ color: '#94A3B8', fontSize: '14px' }}>
                    {user.role} • {session.ip}
                  </div>
                  <div style={{ color: '#64748B', fontSize: '13px' }}>
                    {session.user_agent?.substring(0, 60)}...
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ color: '#22c55e', fontWeight: '600' }}>
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