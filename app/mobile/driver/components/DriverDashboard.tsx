'use client';

// Дашборд водителя: рейсы на сегодня + история поездок. Новые рейсы
// прилетают через Supabase Realtime (order_mixers), звук + push с деталями
// доставки, статусы "На объекте"/"Разгружен" отправляются на сервер.

import { useEffect, useMemo, useRef, useState } from 'react';
import { LogOut, Clock, MapPin, Package, ChevronRight, Bell } from 'lucide-react';
import { useRealtime } from '@/hooks/useRealtimeOrders';
import { driverFetch, DriverMixerInfo, DriverTrip } from '../driverClient';
import DriverTripDetailModal from './DriverTripDetailModal';
import RouteButton from './RouteButton';

interface Props {
  mixer: DriverMixerInfo;
  /** Выход + возврат к экрану входа (устройство может передаваться другому человеку). */
  onLogout: () => void;
}

type Tab = 'today' | 'history';

function formatTime(t?: string | null) {
  if (!t) return '—';
  return t.slice(0, 5);
}

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

  if (sameDay(d, today)) return 'Сегодня';
  if (sameDay(d, yesterday)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
}

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  'Загрузка': { label: 'Загрузка на БСУ', color: '#FACC15', bg: '#FACC1520' },
  'В пути': { label: 'В пути', color: '#3B82F6', bg: '#3B82F620' },
  'На объекте': { label: 'На объекте', color: '#10B981', bg: '#10B98120' },
  'Разгружен': { label: 'Разгружен', color: '#94A3B8', bg: '#33415520' },
  'Возврат': { label: 'Возврат', color: '#94A3B8', bg: '#33415520' },
  'Проблема': { label: 'Проблема', color: '#EF4444', bg: '#EF444420' },
};

export default function DriverDashboard({ mixer, onLogout }: Props) {
  const [tab, setTab] = useState<Tab>('today');
  const [todayTrips, setTodayTrips] = useState<DriverTrip[]>([]);
  const [historyTrips, setHistoryTrips] = useState<DriverTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTrip, setSelectedTrip] = useState<DriverTrip | null>(null);
  const [actionLoadingId, setActionLoadingId] = useState<number | null>(null);
  const [banner, setBanner] = useState<{ time: string; volume: number; address: string } | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission | 'unsupported'>('default');

  // ==================== ЗВУК + PUSH-РАЗРЕШЕНИЕ ====================
  useEffect(() => {
    audioRef.current = new Audio('/sounds/new-order2.mp3');
    audioRef.current.volume = 0.95;

    if (typeof window !== 'undefined' && 'Notification' in window) {
      setNotifPermission(Notification.permission);
    } else {
      setNotifPermission('unsupported');
    }
  }, []);

  const requestNotifPermission = async () => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  };

  const playAlertSound = () => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch((err) => console.warn('🔇 Звук не воспроизведён:', err?.message));
  };

  const showPushNotification = (trip: { time: string; volume: number; address: string }) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification('Новый рейс — доставка бетона', {
        body: `${trip.time} · ${trip.volume} м³\n${trip.address}`,
        icon: '/icons/mixer-truck.png',
        tag: 'driver-new-trip',
      });
    } catch (err) {
      console.warn('Push notification error:', err);
    }
  };

  // ==================== ЗАГРУЗКА РЕЙСОВ ====================
  const fetchToday = async (): Promise<DriverTrip[]> => {
    try {
      const res = await driverFetch('/api/driver/trips?scope=today');
      const data = await res.json();
      if (data.success) {
        setTodayTrips(data.trips);
        return data.trips as DriverTrip[];
      }
    } catch (err) {
      console.error('Ошибка загрузки рейсов на сегодня:', err);
    }
    return [];
  };

  const fetchHistory = async () => {
    try {
      const res = await driverFetch('/api/driver/trips?scope=history');
      const data = await res.json();
      if (data.success) setHistoryTrips(data.trips);
    } catch (err) {
      console.error('Ошибка загрузки истории поездок:', err);
    }
  };

  // once=true — подключаем realtime только ПОСЛЕ первой отрисовки рейсов
  // (обычным fetch), а не сразу при маунте: на слабой мобильной сети
  // WebSocket-хендшейк конкурировал с самым первым, самым важным запросом
  // за канал/CPU и усугублял подвисание при заходе в кабинет водителя.
  const [initialTripsLoaded, setInitialTripsLoaded] = useState(false);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchToday(), fetchHistory()]).finally(() => {
      setLoading(false);
      setInitialTripsLoaded(true);
    });
  }, []);

  // ==================== REALTIME: НОВЫЕ И ИЗМЕНЁННЫЕ РЕЙСЫ ЭТОГО МИКСЕРА ====================
  useRealtime({
    table: 'order_mixers',
    event: '*',
    filter: `mixer_name=eq.${mixer.number}`,
    enabled: initialTripsLoaded,
    onInsert: async (record) => {
      playAlertSound();

      const [freshTrips] = await Promise.all([fetchToday(), fetchHistory()]);
      const matched = freshTrips.find((t) => String(t.id) === String(record.id));

      const time = matched?.time || formatTime(record.time);
      const volume = Number(matched?.volume ?? record.volume ?? 0);
      const address = matched?.order?.address || 'уточняется у диспетчера';

      setBanner({ time, volume, address });
      showPushNotification({ time, volume, address });

      setTimeout(() => setBanner(null), 8000);
    },
    onUpdate: () => {
      fetchToday();
      fetchHistory();
    },
  });

  // ==================== СМЕНА СТАТУСА ====================
  const changeStatus = async (trip: DriverTrip, newStatus: 'На объекте' | 'Разгружен') => {
    const confirmMsg =
      newStatus === 'На объекте'
        ? 'Подтвердить прибытие на объект?'
        : 'Подтвердить, что миксер разгружен?';
    if (!window.confirm(confirmMsg)) return;

    setActionLoadingId(trip.id);
    try {
      const res = await driverFetch('/api/driver/trips/status', {
        method: 'POST',
        body: JSON.stringify({ tripId: trip.id, status: newStatus }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        alert(data.message || 'Не удалось изменить статус');
        return;
      }

      await Promise.all([fetchToday(), fetchHistory()]);
    } catch (err) {
      console.error('Ошибка смены статуса:', err);
      alert('Ошибка соединения');
    } finally {
      setActionLoadingId(null);
    }
  };

  // ==================== ГРУППИРОВКА ИСТОРИИ ПО ДНЯМ ====================
  const historyByDay = useMemo(() => {
    const groups = new Map<string, DriverTrip[]>();
    for (const trip of historyTrips) {
      const day = trip.order?.deliveryDate || trip.createdAt.slice(0, 10);
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day)!.push(trip);
    }
    return Array.from(groups.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [historyTrips]);

  const renderTripCard = (trip: DriverTrip, showAction: boolean) => {
    const style = STATUS_STYLE[trip.status] || STATUS_STYLE['Загрузка'];
    const canGoOnSite = trip.status === 'В пути';
    const canUnload = trip.status === 'На объекте';
    const isBusy = actionLoadingId === trip.id;

    return (
      <div
        key={trip.id}
        style={{
          background: '#1E2937',
          borderRadius: '16px',
          padding: '16px',
          marginBottom: '12px',
          border: '1px solid #334155',
        }}
      >
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', cursor: 'pointer' }}
          onClick={() => setSelectedTrip(trip)}
        >
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <Clock size={15} color="#94A3B8" />
              <span style={{ color: '#fff', fontWeight: 600, fontSize: '15px' }}>
                {trip.time || formatTime(trip.order?.deliveryTime)}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  padding: '3px 10px',
                  borderRadius: '9999px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: style.color,
                  background: style.bg,
                }}
              >
                {style.label}
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <Package size={15} color="#94A3B8" />
              <span style={{ color: '#CBD5E1', fontSize: '14px' }}>
                {trip.volume} м³ {trip.order?.grade ? `· ${trip.order.grade}` : ''}
              </span>
            </div>

            {trip.order?.address && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <MapPin size={15} color="#94A3B8" style={{ marginTop: '2px', flexShrink: 0 }} />
                <span style={{ color: '#94A3B8', fontSize: '13.5px', lineHeight: 1.4 }}>{trip.order.address}</span>
              </div>
            )}

            {trip.order?.address && (
              <div style={{ marginTop: '10px' }}>
                <RouteButton address={trip.order.address} compact />
              </div>
            )}

            {trip.status === 'Разгружен' && Number(trip.downtimeMinutes) > 0 && (
              <div style={{ marginTop: '8px', color: '#F97316', fontSize: '13px', fontWeight: 600 }}>
                ⏱ Простой на объекте: {trip.downtimeMinutes} мин
              </div>
            )}
          </div>
          <ChevronRight size={18} color="#475569" style={{ flexShrink: 0, marginTop: '2px' }} />
        </div>

        {showAction && (canGoOnSite || canUnload) && (
          <button
            disabled={isBusy}
            onClick={(e) => {
              e.stopPropagation();
              changeStatus(trip, canGoOnSite ? 'На объекте' : 'Разгружен');
            }}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              marginTop: '14px',
              padding: '13px',
              borderRadius: '12px',
              border: 'none',
              fontWeight: 700,
              fontSize: '15px',
              color: '#fff',
              cursor: isBusy ? 'not-allowed' : 'pointer',
              background: isBusy ? '#475569' : canGoOnSite ? '#3B82F6' : '#10B981',
            }}
          >
            {isBusy ? 'Сохранение...' : canGoOnSite ? '📍 Я на объекте' : '✅ Разгружен'}
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ minHeight: '100vh', background: '#0F172A', paddingBottom: '40px' }}>
      {/* ==================== БАННЕР НОВОГО РЕЙСА ==================== */}
      {banner && (
        <div
          style={{
            position: 'fixed',
            top: '12px',
            left: '12px',
            right: '12px',
            zIndex: 2000,
            background: '#10B981',
            color: '#fff',
            borderRadius: '14px',
            padding: '14px 16px',
            boxShadow: '0 10px 25px rgba(0,0,0,0.4)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}
        >
          <Bell size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div style={{ fontSize: '14px', fontWeight: 600, lineHeight: 1.4 }}>
            Новый рейс: {banner.time} · {banner.volume} м³
            <div style={{ fontSize: '13px', fontWeight: 500, opacity: 0.9, marginTop: '2px' }}>{banner.address}</div>
          </div>
        </div>
      )}

      {/* ==================== ШАПКА ==================== */}
      <div style={{ padding: '20px', paddingBottom: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ color: '#94A3B8', fontSize: '13px' }}>Миксер</div>
            <div style={{ color: '#fff', fontSize: '24px', fontWeight: 700 }}>{mixer.number}</div>
            <div style={{ color: '#94A3B8', fontSize: '14px', marginTop: '2px' }}>
              {mixer.driver} · {mixer.volume} м³
            </div>
          </div>
          <button
            onClick={onLogout}
            aria-label="Выйти"
            title="Выйти / сменить пользователя"
            style={{
              background: '#1E2937',
              border: '1px solid #334155',
              borderRadius: '9999px',
              width: '40px',
              height: '40px',
              minWidth: '40px',
              color: '#94A3B8',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <LogOut size={18} />
          </button>
        </div>

        {notifPermission === 'default' && (
          <button
            onClick={requestNotifPermission}
            style={{
              marginTop: '14px',
              width: '100%',
              boxSizing: 'border-box',
              padding: '12px',
              borderRadius: '12px',
              border: '1px solid #334155',
              background: '#1E2937',
              color: '#60A5FA',
              fontSize: '13.5px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
            }}
          >
            <Bell size={15} /> Включить уведомления о новых рейсах
          </button>
        )}
      </div>

      {/* ==================== ТАБЫ ==================== */}
      <div style={{ display: 'flex', gap: '8px', padding: '0 20px', marginBottom: '16px' }}>
        <button
          onClick={() => setTab('today')}
          style={{
            flex: 1,
            padding: '12px',
            borderRadius: '12px',
            border: 'none',
            fontWeight: 600,
            fontSize: '14.5px',
            background: tab === 'today' ? '#10B981' : '#1E2937',
            color: tab === 'today' ? '#fff' : '#94A3B8',
          }}
        >
          Мои рейсы сегодня
        </button>
        <button
          onClick={() => setTab('history')}
          style={{
            flex: 1,
            padding: '12px',
            borderRadius: '12px',
            border: 'none',
            fontWeight: 600,
            fontSize: '14.5px',
            background: tab === 'history' ? '#10B981' : '#1E2937',
            color: tab === 'history' ? '#fff' : '#94A3B8',
          }}
        >
          История поездок
        </button>
      </div>

      {/* ==================== КОНТЕНТ ==================== */}
      <div style={{ padding: '0 20px' }}>
        {loading ? (
          <div style={{ textAlign: 'center', padding: '60px 0', color: '#94A3B8' }}>Загрузка...</div>
        ) : tab === 'today' ? (
          todayTrips.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748B' }}>
              <Package size={40} style={{ marginBottom: '12px', opacity: 0.5 }} />
              <div>На сегодня рейсов пока нет</div>
            </div>
          ) : (
            todayTrips.map((trip) => renderTripCard(trip, true))
          )
        ) : historyByDay.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#64748B' }}>
            <Clock size={40} style={{ marginBottom: '12px', opacity: 0.5 }} />
            <div>История поездок пуста</div>
          </div>
        ) : (
          historyByDay.map(([day, trips]) => (
            <div key={day} style={{ marginBottom: '20px' }}>
              <div style={{ color: '#94A3B8', fontSize: '13px', fontWeight: 600, marginBottom: '10px' }}>
                {formatDateLabel(day)}
              </div>
              {trips.map((trip) => renderTripCard(trip, false))}
            </div>
          ))
        )}
      </div>

      {selectedTrip && <DriverTripDetailModal trip={selectedTrip} onClose={() => setSelectedTrip(null)} />}
    </div>
  );
}
