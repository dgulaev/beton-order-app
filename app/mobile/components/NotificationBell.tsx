'use client';

import { useEffect, useRef, useState } from 'react';
import { Bell, X, CheckCheck, Package, AlertCircle } from 'lucide-react';
import { useMobileNotifications, MobileNotification } from '@/hooks/useMobileNotifications';
import { volumeCardSoftStyle, volumeModalStyle } from '@/app/adminCifra/cardStyles';

function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  if (diffHours < 24) return `${diffHours} ч назад`;
  if (diffDays === 1) return 'вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

function NotifCard({
  n,
  onDismiss,
}: {
  n: MobileNotification;
  onDismiss: (id: number) => void;
}) {
  const isNewOrder = n.type === 'new_order';
  const accentColor = isNewOrder ? '#10B981' : '#60A5FA';

  return (
    <div
      style={volumeCardSoftStyle({
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: 12,
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        position: 'relative',
      })}
    >
      {/* Закрыть */}
      <button
        onClick={() => onDismiss(n.id)}
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'none',
          border: 'none',
          color: '#64748B',
          cursor: 'pointer',
          padding: '2px',
          display: 'flex',
          alignItems: 'center',
        }}
      >
        <X size={15} />
      </button>

      {/* Иконка + заголовок */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', paddingRight: '22px' }}>
        <div
          style={{
            width: '28px',
            height: '28px',
            borderRadius: '8px',
            background: isNewOrder ? 'rgba(16,185,129,0.15)' : 'rgba(96,165,250,0.15)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isNewOrder ? (
            <Package size={14} color={accentColor} />
          ) : (
            <AlertCircle size={14} color={accentColor} />
          )}
        </div>
        <span style={{ color: '#E2E8F0', fontSize: '13px', fontWeight: 600, lineHeight: 1.35 }}>
          {n.title}
        </span>
      </div>

      {/* Клиент / контекст */}
      {n.body && (
        <div style={{ color: '#94A3B8', fontSize: '12px', paddingLeft: '36px' }}>
          {n.body}
        </div>
      )}

      {/* Было → Стало */}
      {n.old_value && n.new_value && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            paddingLeft: '36px',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              background: 'rgba(239,68,68,0.12)',
              color: '#F87171',
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '6px',
            }}
          >
            {n.old_value}
          </span>
          <span style={{ color: '#475569', fontSize: '11px' }}>→</span>
          <span
            style={{
              background: 'rgba(16,185,129,0.12)',
              color: '#34D399',
              fontSize: '11px',
              padding: '2px 8px',
              borderRadius: '6px',
            }}
          >
            {n.new_value}
          </span>
        </div>
      )}

      {/* Время */}
      <div style={{ color: '#475569', fontSize: '11px', paddingLeft: '36px' }}>
        {formatTime(n.created_at)}
      </div>
    </div>
  );
}

export default function NotificationBell() {
  const { notifications, unreadCount, dismiss, dismissAll, animateBell } =
    useMobileNotifications();
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  // Закрываем шторку при клике вне её
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    setTimeout(() => document.addEventListener('mousedown', handler), 50);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const BTN_STYLE: React.CSSProperties = volumeCardSoftStyle({
    borderRadius: 9999,
    width: 40,
    height: 40,
    minWidth: 40,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    cursor: 'pointer',
    position: 'relative',
    padding: 0,
  });

  return (
    <>
      {/* Кнопка колокольчика */}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          ...BTN_STYLE,
          color: unreadCount > 0 ? '#FACC15' : '#94A3B8',
          animation: animateBell ? 'bell-shake 0.5s ease' : undefined,
        }}
        title="Уведомления"
      >
        <Bell
          size={18}
          style={{
            transition: 'color 0.2s',
          }}
        />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '4px',
              right: '4px',
              background: '#EF4444',
              color: '#fff',
              fontSize: '9px',
              fontWeight: 700,
              borderRadius: '9999px',
              minWidth: '15px',
              height: '15px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '0 3px',
              lineHeight: 1,
              boxShadow: '0 0 0 2px #1E2937',
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Шторка уведомлений */}
      {open && (
        <>
          {/* Полупрозрачный backdrop */}
          <div
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.82)',
              zIndex: 2000,
            }}
            onClick={() => setOpen(false)}
          />

          {/* Сам список */}
          <div
            ref={sheetRef}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              zIndex: 2001,
              display: 'flex',
              flexDirection: 'column',
              pointerEvents: 'none',
            }}
          >
            <div
              style={volumeModalStyle({
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                maxHeight: '70vh',
                display: 'flex',
                flexDirection: 'column',
                pointerEvents: 'all',
                borderRadius: '0 0 20px 20px',
              })}
            >
              {/* Заголовок */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '18px 18px 12px',
                  borderBottom: '1px solid #1E2937',
                  flexShrink: 0,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <Bell size={18} color="#FACC15" />
                  <span style={{ color: '#E2E8F0', fontSize: '16px', fontWeight: 700 }}>
                    Уведомления
                  </span>
                  {unreadCount > 0 && (
                    <span
                      style={{
                        background: '#EF4444',
                        color: '#fff',
                        fontSize: '11px',
                        fontWeight: 700,
                        borderRadius: '9999px',
                        padding: '1px 7px',
                      }}
                    >
                      {unreadCount}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {unreadCount > 0 && (
                    <button
                      onClick={dismissAll}
                      style={{
                        background: 'none',
                        border: '1px solid #334155',
                        borderRadius: '8px',
                        color: '#94A3B8',
                        fontSize: '12px',
                        padding: '5px 10px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                      }}
                    >
                      <CheckCheck size={13} />
                      Закрыть все
                    </button>
                  )}
                  <button
                    onClick={() => setOpen(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#64748B',
                      cursor: 'pointer',
                      padding: '4px',
                      display: 'flex',
                    }}
                  >
                    <X size={20} />
                  </button>
                </div>
              </div>

              {/* Список */}
              <div
                style={{
                  overflowY: 'auto',
                  padding: '12px 14px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                  flex: 1,
                }}
              >
                {notifications.length === 0 ? (
                  <div
                    style={{
                      textAlign: 'center',
                      color: '#475569',
                      padding: '32px 0',
                      fontSize: '14px',
                    }}
                  >
                    <Bell size={32} color="#334155" style={{ marginBottom: '10px' }} />
                    <div>Новых уведомлений нет</div>
                  </div>
                ) : (
                  notifications.map((n) => (
                    <NotifCard key={n.id} n={n} onDismiss={dismiss} />
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes bell-shake {
          0%,100% { transform: rotate(0); }
          20% { transform: rotate(-15deg); }
          40% { transform: rotate(15deg); }
          60% { transform: rotate(-10deg); }
          80% { transform: rotate(10deg); }
        }
      `}</style>
    </>
  );
}
