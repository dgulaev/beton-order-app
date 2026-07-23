'use client';

import { useEffect } from 'react';
import { MapPin, Package, Clock, Phone, Navigation } from 'lucide-react';
import { DriverTrip } from '../driverClient';
import RouteButton from './RouteButton';
import { CARD_BORDER, volumeCardSoftStyle, volumeCardStyle, volumeModalStyle } from '@/app/adminCifra/cardStyles';

interface Props {
  trip: DriverTrip;
  onClose: () => void;
}

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  'Загрузка':   { label: 'Загрузка на БСУ', color: '#FACC15', bg: '#FACC1520' },
  'В пути':     { label: 'В пути',           color: '#3B82F6', bg: '#3B82F620' },
  'На объекте': { label: 'На объекте',        color: '#10B981', bg: '#10B98120' },
  'Разгружен':  { label: 'Разгружен',         color: '#94A3B8', bg: '#33415520' },
  'Возврат':    { label: 'Возврат',           color: '#94A3B8', bg: '#33415520' },
  'Проблема':   { label: 'Проблема',          color: '#EF4444', bg: '#EF444420' },
};

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatMinutesOnSite(trip: DriverTrip): string | null {
  if (!trip.onSiteAt) return null;
  const end = trip.unloadedAt ? new Date(trip.unloadedAt) : new Date();
  const minutes = Math.round((end.getTime() - new Date(trip.onSiteAt).getTime()) / 60000);
  if (minutes < 0) return null;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}ч ${m}м` : `${m} мин`;
}

function Row({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      padding: '12px 0', borderBottom: '1px solid rgba(255,255,255,0.05)',
    }}>
      <span style={{ fontSize: '13px', color: '#64748B', flexShrink: 0, paddingRight: '12px' }}>{label}</span>
      <span style={{ fontSize: '13px', color: valueColor || '#CBD5E1', fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  );
}

export default function DriverTripDetailModal({ trip, onClose }: Props) {
  const ss = STATUS_STYLE[trip.status] || { label: trip.status, color: '#64748B', bg: '#1E293720' };
  const onSiteDuration = formatMinutesOnSite(trip);
  const downtime = trip.downtimeMinutes;

  // Блокируем скролл body пока шторка открыта
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
    <>
      {/* Затемнение */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.6)',
          zIndex: 10000,
          touchAction: 'none',
        }}
        onTouchMove={e => e.preventDefault()}
      />

      {/* Шторка снизу */}
      <div
        style={volumeModalStyle({
          position: 'fixed', bottom: 0, left: 0, right: 0,
          zIndex: 10001,
          borderRadius: '20px 20px 0 0',
          paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))',
          maxHeight: '88dvh',
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
        })}
        onClick={e => e.stopPropagation()}
        onTouchMove={e => e.stopPropagation()}
      >
        {/* Ручка */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '12px 0 4px' }}>
          <div style={{ width: '36px', height: '4px', borderRadius: '9999px', background: '#334155' }} />
        </div>

        {/* Шапка */}
        <div style={{ padding: '12px 20px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>
              Заявка #{trip.orderId}
            </div>
            <span style={{
              display: 'inline-block',
              padding: '4px 12px', borderRadius: '9999px',
              fontSize: '13px', fontWeight: 700,
              background: ss.bg, color: ss.color,
            }}>
              {ss.label}
            </span>
          </div>
          <button
            onClick={onClose}
            style={volumeCardSoftStyle({
              width: 32, height: 32, borderRadius: 9999,
              cursor: 'pointer',
              color: '#64748B', fontSize: '18px', display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              padding: 0,
            })}
          >
            ✕
          </button>
        </div>

        {/* Основные данные */}
        <div style={{ padding: '0 20px 20px' }}>

          {/* Ключевые показатели */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
            <div style={volumeCardStyle({ borderRadius: 14, padding: '14px', border: CARD_BORDER })}>
              <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '4px' }}>Объём</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#10B981', lineHeight: 1 }}>
                {trip.volume}<span style={{ fontSize: '13px', color: '#64748B', fontWeight: 400 }}> м³</span>
              </div>
            </div>
            <div style={volumeCardStyle({ borderRadius: 14, padding: '14px', border: CARD_BORDER })}>
              <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '4px' }}>Марка</div>
              <div style={{ fontSize: '22px', fontWeight: 700, color: '#60A5FA', lineHeight: 1 }}>
                {trip.order?.grade || '—'}
              </div>
            </div>
          </div>

          {/* Строки с деталями */}
          <div style={volumeCardSoftStyle({ borderRadius: 14, padding: '0 16px', marginBottom: '12px' })}>
            <Row label="Время рейса" value={trip.time || trip.order?.deliveryTime || '—'} />
            <Row label="Дата"
              value={trip.order?.deliveryDate
                ? new Date(trip.order.deliveryDate).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
                : '—'} />
            {trip.order?.clientName && (
              <Row label="Клиент" value={trip.order.clientName} />
            )}
            {trip.order?.address && (
              <Row label="Адрес" value={trip.order.address} />
            )}
            {trip.order?.comment && (
              <Row label="Комментарий" value={trip.order.comment} valueColor="#FDE68A" />
            )}
          </div>

          {/* Время на объекте */}
          <div style={volumeCardSoftStyle({ borderRadius: 14, padding: '0 16px', marginBottom: '12px' })}>
            <Row label="Начало загрузки" value={formatTime(trip.loadingStartedAt)} />
            <Row label="Прибытие на объект" value={formatTime(trip.onSiteAt)} />
            <Row label="Окончание разгрузки" value={formatTime(trip.unloadedAt)} />
            {onSiteDuration && (
              <Row label="Время на объекте" value={onSiteDuration} />
            )}
            <Row
              label="Простой"
              value={downtime !== null && downtime !== undefined ? `${downtime} мин` : '—'}
              valueColor={Number(downtime) > 0 ? '#F97316' : '#10B981'}
            />
          </div>

          {/* Маршрут */}
          {trip.order?.address && (
            <div style={{ marginBottom: '12px' }}>
              <RouteButton address={trip.order.address} />
            </div>
          )}

          {/* Телефон клиента */}
          {trip.order?.phone && (
            <a
              href={`tel:${trip.order.phone.replace(/\D/g, '').replace(/^8/, '+7')}`}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                padding: '13px', borderRadius: '14px',
                border: '1px solid rgba(16,185,129,0.3)',
                background: 'transparent', color: '#10B981',
                fontSize: '15px', fontWeight: 700, textDecoration: 'none',
              }}
            >
              <Phone size={16} /> Позвонить клиенту
            </a>
          )}
        </div>
      </div>
    </>
  );
}
