'use client';

import { useEffect } from 'react';
import { DriverTrip } from '../driverClient';
import RouteButton from './RouteButton';

interface Props {
  trip: DriverTrip;
  onClose: () => void;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatMinutesOnSite(trip: DriverTrip): string | null {
  if (!trip.onSiteAt) return null;
  const end = trip.unloadedAt ? new Date(trip.unloadedAt) : new Date();
  const minutes = Math.round((end.getTime() - new Date(trip.onSiteAt).getTime()) / 60000);
  if (minutes < 0) return null;
  return `${minutes} мин`;
}

export default function DriverTripDetailModal({ trip, onClose }: Props) {
  const onSiteDuration = formatMinutesOnSite(trip);
  const downtime = trip.downtimeMinutes;

  // Блокируем скролл body пока модалка открыта (iOS Safari игнорирует overflow:hidden на body)
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    return () => {
      document.body.style.overflow = prev;
      document.body.style.position = '';
      document.body.style.width = '';
    };
  }, []);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        zIndex: 100000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        touchAction: 'none',
      }}
      onClick={onClose}
      onTouchMove={(e) => e.target === e.currentTarget && e.preventDefault()}
    >
      <div
        style={{
          background: '#1E2937',
          width: '100%',
          maxWidth: '560px',
          boxSizing: 'border-box',
          borderRadius: '0 0 20px 20px',
          paddingTop: 'max(24px, env(safe-area-inset-top, 24px))',
          paddingLeft: '20px',
          paddingRight: '20px',
          paddingBottom: '32px',
          maxHeight: '88dvh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y',
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '20px', color: '#fff' }}>Рейс — заявка #{trip.orderId}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '30px', color: '#94A3B8', lineHeight: 1 }}>
            ×
          </button>
        </div>

        <div style={{ background: '#25334A', borderRadius: '16px', padding: '18px', marginBottom: '16px', color: '#fff' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 12px', fontSize: '15px' }}>
            <div style={{ color: '#94A3B8' }}>Объём миксера</div>
            <div style={{ fontWeight: '700', color: '#10B981' }}>{trip.volume} м³</div>

            <div style={{ color: '#94A3B8' }}>Марка бетона</div>
            <div style={{ fontWeight: '600', color: '#60A5FA' }}>{trip.order?.grade || '—'}</div>

            <div style={{ color: '#94A3B8' }}>Дата доставки</div>
            <div style={{ fontWeight: '600' }}>{trip.order?.deliveryDate || '—'}</div>

            <div style={{ color: '#94A3B8' }}>Время доставки</div>
            <div style={{ fontWeight: '600' }}>{trip.time || trip.order?.deliveryTime || '—'}</div>

            <div style={{ color: '#94A3B8' }}>Адрес</div>
            <div style={{ fontWeight: '600', lineHeight: 1.35 }}>{trip.order?.address || '—'}</div>

            <div style={{ color: '#94A3B8' }}>Статус рейса</div>
            <div style={{ fontWeight: '600' }}>{trip.status}</div>
          </div>

          {trip.order?.address && (
            <div style={{ marginTop: '16px' }}>
              <RouteButton address={trip.order.address} />
            </div>
          )}
        </div>

        <div style={{ background: '#25334A', borderRadius: '16px', padding: '18px', color: '#fff' }}>
          <h3 style={{ margin: '0 0 14px', fontSize: '16px', color: '#94A3B8' }}>Время на объекте</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 12px', fontSize: '15px' }}>
            <div style={{ color: '#94A3B8' }}>Прибытие на объект</div>
            <div style={{ fontWeight: '600' }}>{formatDateTime(trip.onSiteAt)}</div>

            <div style={{ color: '#94A3B8' }}>Окончание разгрузки</div>
            <div style={{ fontWeight: '600' }}>{formatDateTime(trip.unloadedAt)}</div>

            <div style={{ color: '#94A3B8' }}>Время на объекте</div>
            <div style={{ fontWeight: '600' }}>{onSiteDuration || '—'}</div>

            <div style={{ color: '#94A3B8' }}>Простой</div>
            <div style={{ fontWeight: '700', color: Number(downtime) > 0 ? '#F97316' : '#10B981' }}>
              {downtime !== null && downtime !== undefined ? `${downtime} мин` : '—'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
