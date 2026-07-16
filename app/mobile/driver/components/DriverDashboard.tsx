'use client';

// Дашборд водителя: рейсы на сегодня + история поездок. Новые рейсы
// прилетают через Supabase Realtime (order_mixers), звук + push с деталями
// доставки, статусы "На объекте"/"Разгружен" отправляются на сервер.

import { useEffect, useMemo, useRef, useState } from 'react';
import { LogOut, Clock, MapPin, Package, ChevronRight, Bell, Phone } from 'lucide-react';
import { useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';
import { useWakeRefresh } from '@/hooks/useWakeReload';
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

// Извлекает телефон из текста комментария (клиенты часто пишут доп. контакт
// прямо в комментарии: "...вывоз 12ой +79532799112 Евгений"). Берём первую
// последовательность телефонного вида: 11 цифр с 7/8 в начале или 10 цифр с 9.
// Разделители (пробел/дефис/скобки) допускаются, буквы — нет (не склеивают
// соседние числа вроде "12ой и 10-ми").
function extractPhoneFromText(text?: string | null): string | null {
  if (!text) return null;
  const matches = text.match(/(?:\+?[78][\s\-()]*)?\d(?:[\s\-()]*\d){9,10}/g);
  if (!matches) return null;
  for (const m of matches) {
    const digits = m.replace(/\D/g, '');
    if (digits.length === 11 && (digits[0] === '7' || digits[0] === '8')) return m.trim();
    if (digits.length === 10 && digits[0] === '9') return m.trim();
  }
  return null;
}

// Телефон для кнопки «позвонить»: приоритет — номер из комментария заявки,
// иначе телефон из самой заявки.
function resolveContactPhone(order?: { phone?: string | null; comment?: string | null } | null): string | null {
  if (!order) return null;
  return extractPhoneFromText(order.comment) || order.phone || null;
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

// ==================== OFFLINE QUEUE ====================
const OFFLINE_QUEUE_KEY = 'driver_offline_queue';

interface OfflineAction {
  id: string;
  tripId: number;
  status: 'На объекте' | 'Разгружен';
  timestamp: string; // точное время нажатия кнопки водителем
}

function loadOfflineQueue(): OfflineAction[] {
  try {
    if (typeof window === 'undefined') return [];
    const raw = localStorage.getItem(OFFLINE_QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveOfflineQueue(q: OfflineAction[]) {
  try { localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(q)); } catch {}
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
  // Таймер: секунды elapsed по trip.id для активных рейсов
  const [elapsed, setElapsed] = useState<Record<number, number>>({});
  // Подтверждение смены статуса — кастомный modal вместо window.confirm
  const [confirmPending, setConfirmPending] = useState<{ trip: DriverTrip; newStatus: 'На объекте' | 'Разгружен' } | null>(null);
  // Offline-очередь: действия, которые не удалось отправить без сети
  const [offlineQueue, setOfflineQueue] = useState<OfflineAction[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

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

  // Мягкое восстановление данных при пробуждении вкладки (без перезагрузки) —
  // подтягиваем свежие рейсы. Сокет realtime поднимает layout (useWakeRefresh →
  // hardResetBroadcastSocket).
  useWakeRefresh(() => {
    fetchToday();
    fetchHistory();
  });

  // ==================== OFFLINE QUEUE: ЗАГРУЗКА + СИНХРОНИЗАЦИЯ ====================
  useEffect(() => {
    const saved = loadOfflineQueue();
    if (saved.length > 0) setOfflineQueue(saved);
  }, []);

  const syncOfflineQueue = async (queue: OfflineAction[]) => {
    if (queue.length === 0 || isSyncing) return;
    setIsSyncing(true);
    const remaining: OfflineAction[] = [];

    for (const action of queue) {
      try {
        const res = await driverFetch('/api/driver/trips/status', {
          method: 'POST',
          body: JSON.stringify({ tripId: action.tripId, status: action.status, timestamp: action.timestamp }),
        });
        if (!res.ok) remaining.push(action);
      } catch {
        remaining.push(action); // нет сети — оставляем
      }
    }

    setOfflineQueue(remaining);
    saveOfflineQueue(remaining);
    setIsSyncing(false);

    if (remaining.length < queue.length) {
      // часть синхронизировалась — обновляем рейсы
      await Promise.all([fetchToday(), fetchHistory()]);
    }
  };

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      const q = loadOfflineQueue();
      if (q.length > 0) syncOfflineQueue(q);
    };
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ==================== REALTIME (BROADCAST): РЕЙСЫ ЭТОГО МИКСЕРА ====================
  // Broadcast from Database — триггер order_mixers шлёт realtime.send() в топик
  // `order_mixers:<номер миксера>`. Лёгкий канал, стабильная подписка.
  const { status: realtimeStatus } = useRealtimeBroadcast({
    topic: `order_mixers:${mixer.number}`,
    enabled: initialTripsLoaded,
    onInsert: async (record) => {
      playAlertSound();

      const [freshTrips] = await Promise.all([fetchToday(), fetchHistory()]);
      const matched = freshTrips.find((t) => String(t.id) === String(record?.id));

      const time = matched?.time || formatTime(record?.time);
      const volume = Number(matched?.volume ?? record?.volume ?? 0);
      const address = matched?.order?.address || 'уточняется у диспетчера';

      setBanner({ time, volume, address });
      showPushNotification({ time, volume, address });

      setTimeout(() => setBanner(null), 8000);
    },
    onUpdate: () => {
      fetchToday();
      fetchHistory();
    },
    onDelete: () => {
      fetchToday();
      fetchHistory();
    },
  });

  // ==================== ТАЙМЕР АКТИВНЫХ РЕЙСОВ ====================
  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const updates: Record<number, number> = {};
      for (const trip of todayTrips) {
        let startIso: string | null = null;
        if (trip.status === 'Загрузка' || trip.status === 'В пути') {
          startIso = trip.loadingStartedAt || trip.createdAt;
        } else if (trip.status === 'На объекте') {
          startIso = trip.onSiteAt;
        }
        if (startIso) {
          updates[trip.id] = Math.floor((now - new Date(startIso).getTime()) / 1000);
        }
      }
      setElapsed(updates);
    };
    tick();
    const id = setInterval(tick, 30_000); // обновляем каждые 30 сек
    return () => clearInterval(id);
  }, [todayTrips]);

  // ==================== СМЕНА СТАТУСА (поддержка offline) ====================
  const changeStatus = async (trip: DriverTrip, newStatus: 'На объекте' | 'Разгружен') => {
    // Фиксируем точный момент нажатия — даже если нет сети
    const timestamp = new Date().toISOString();
    setActionLoadingId(trip.id);

    try {
      const res = await driverFetch('/api/driver/trips/status', {
        method: 'POST',
        body: JSON.stringify({ tripId: trip.id, status: newStatus, timestamp }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Сервер вернул ошибку — не оффлайн, сообщаем
        alert(data.message || 'Не удалось изменить статус');
        return;
      }

      await Promise.all([fetchToday(), fetchHistory()]);
    } catch {
      // Нет интернета — сохраняем в offline-очередь с точным timestamp
      const action: OfflineAction = {
        id: `${trip.id}-${newStatus}-${Date.now()}`,
        tripId: trip.id,
        status: newStatus,
        timestamp,
      };
      const newQueue = [...offlineQueue.filter(a => !(a.tripId === trip.id && a.status === newStatus)), action];
      setOfflineQueue(newQueue);
      saveOfflineQueue(newQueue);

      // Оптимистично обновляем UI — водитель видит смену статуса сразу
      setTodayTrips(prev =>
        prev.map(t =>
          t.id === trip.id
            ? {
                ...t,
                status: newStatus,
                onSiteAt: newStatus === 'На объекте' ? timestamp : t.onSiteAt,
                unloadedAt: newStatus === 'Разгружен' ? timestamp : t.unloadedAt,
              }
            : t
        )
      );
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

  // Форматирует секунды в "X мин" или "Xч Yм"
  const formatElapsed = (secs: number) => {
    const m = Math.floor(secs / 60);
    if (m < 60) return `${m} мин`;
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem > 0 ? `${h}ч ${rem}м` : `${h}ч`;
  };

  // Карточка активного рейса (вкладка «Сегодня») — полная информация
  const renderTripCard = (trip: DriverTrip, showAction: boolean) => {
    const style = STATUS_STYLE[trip.status] || STATUS_STYLE['Загрузка'];
    const canGoOnSite = trip.status === 'В пути';
    const canUnload = trip.status === 'На объекте';
    const isBusy = actionLoadingId === trip.id;
    const phone = resolveContactPhone(trip.order);
    const tripElapsed = elapsed[trip.id];
    const showTimer = (trip.status === 'Загрузка' || trip.status === 'В пути' || trip.status === 'На объекте') && tripElapsed !== undefined;

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
            {/* Строка: время + номер заявки + статус */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <Clock size={15} color="#94A3B8" />
              <span style={{ color: '#fff', fontWeight: 600, fontSize: '15px' }}>
                {trip.time || formatTime(trip.order?.deliveryTime)}
              </span>
              <span style={{ color: '#475569', fontSize: '12px' }}>#{trip.orderId}</span>
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

            {/* Клиент */}
            {trip.order?.clientName && (
              <div style={{ color: '#CBD5E1', fontSize: '13px', fontWeight: 500, marginBottom: '6px' }}>
                {trip.order.clientName}
              </div>
            )}

            {/* Объём и марка */}
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

            {/* Таймер для активных статусов */}
            {showTimer && (
              <div style={{
                marginTop: '8px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '4px 10px',
                borderRadius: '9999px',
                background: trip.status === 'На объекте' ? 'rgba(16,185,129,0.1)' : 'rgba(59,130,246,0.1)',
                border: `1px solid ${trip.status === 'На объекте' ? 'rgba(16,185,129,0.3)' : 'rgba(59,130,246,0.3)'}`,
              }}>
                <Clock size={12} color={trip.status === 'На объекте' ? '#10B981' : '#60A5FA'} />
                <span style={{
                  fontSize: '12px',
                  fontWeight: 600,
                  color: trip.status === 'На объекте' ? '#10B981' : '#60A5FA',
                }}>
                  {trip.status === 'Загрузка' ? 'Загрузка' : trip.status === 'В пути' ? 'В пути' : 'На объекте'}
                  {' '}{formatElapsed(tripElapsed!)}
                </span>
              </div>
            )}
          </div>
          <ChevronRight size={18} color="#475569" style={{ flexShrink: 0, marginTop: '2px' }} />
        </div>

        {/* Комментарий диспетчера */}
        {trip.order?.comment && (
          <div style={{
            marginTop: '10px',
            padding: '10px 12px',
            borderRadius: '10px',
            background: 'rgba(250,204,21,0.08)',
            border: '1px solid rgba(250,204,21,0.2)',
            fontSize: '13px',
            color: '#FDE68A',
            lineHeight: 1.4,
          }}>
            💬 {trip.order.comment}
          </div>
        )}

        {/* Телефон контакта — нажатие открывает звонок */}
        {phone && (
          <a
            href={`tel:${phone.replace(/\D/g, '').replace(/^8/, '+7')}`}
            onClick={(e) => e.stopPropagation()}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '10px',
              padding: '10px 14px',
              borderRadius: '10px',
              background: 'rgba(16,185,129,0.12)',
              border: '1px solid rgba(16,185,129,0.3)',
              color: '#10B981',
              fontSize: '14px',
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            <Phone size={15} />
            {phone}
          </a>
        )}

        {showAction && (canGoOnSite || canUnload) && (
          <button
            disabled={isBusy}
            onClick={(e) => {
              e.stopPropagation();
              setConfirmPending({ trip, newStatus: canGoOnSite ? 'На объекте' : 'Разгружен' });
            }}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              marginTop: '12px',
              padding: '14px 16px',
              borderRadius: '14px',
              border: 'none',
              cursor: isBusy ? 'not-allowed' : 'pointer',
              background: isBusy ? '#475569' : canGoOnSite ? '#3B82F6' : '#10B981',
              textAlign: 'left',
            }}
          >
            {isBusy ? (
              <span style={{ color: '#fff', fontWeight: 700, fontSize: '15px' }}>Сохранение...</span>
            ) : canGoOnSite ? (
              <div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: '16px' }}>📍 Прибыл на объект</div>
                <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: '12px', marginTop: '2px' }}>
                  Нажмите когда миксер въехал на территорию
                </div>
              </div>
            ) : (
              <div>
                <div style={{ color: '#fff', fontWeight: 700, fontSize: '16px' }}>✅ Выгрузка окончена</div>
                <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: '12px', marginTop: '2px' }}>
                  Нажмите когда весь бетон выгружен
                </div>
              </div>
            )}
          </button>
        )}
      </div>
    );
  };

  // Упрощённая карточка для истории поездок — только номер заявки, дата, время, объём, простой
  const renderHistoryCard = (trip: DriverTrip) => (
    <div
      key={trip.id}
      style={{
        background: '#1E2937',
        borderRadius: '12px',
        padding: '12px 14px',
        marginBottom: '8px',
        border: '1px solid #263040',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      {/* Номер заявки */}
      <div style={{
        minWidth: '44px',
        textAlign: 'center',
        background: '#0F172A',
        borderRadius: '8px',
        padding: '6px 4px',
      }}>
        <div style={{ color: '#475569', fontSize: '10px' }}>#</div>
        <div style={{ color: '#94A3B8', fontSize: '14px', fontWeight: 700 }}>{trip.orderId}</div>
      </div>

      {/* Дата и время */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#CBD5E1', fontSize: '13px', fontWeight: 600 }}>
          {trip.order?.deliveryDate
            ? new Date(trip.order.deliveryDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
            : '—'}
          {' · '}
          {trip.time || formatTime(trip.order?.deliveryTime)}
        </div>
        <div style={{ color: '#64748B', fontSize: '12px', marginTop: '2px' }}>
          {trip.volume} м³{trip.order?.grade ? ` · ${trip.order.grade}` : ''}
        </div>
      </div>

      {/* Простой (если был) */}
      {Number(trip.downtimeMinutes) > 0 ? (
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div style={{ color: '#F97316', fontSize: '12px', fontWeight: 600 }}>
            ⏱ {trip.downtimeMinutes} мин
          </div>
          <div style={{ color: '#475569', fontSize: '10px' }}>простой</div>
        </div>
      ) : (
        <div style={{ color: '#22C55E', fontSize: '18px', flexShrink: 0 }}>✓</div>
      )}
    </div>
  );

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
            {/* Заголовок «Миксер» + Realtime точка в одну строку */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ color: '#94A3B8', fontSize: '13px' }}>Миксер</span>
              <span
                title={
                  realtimeStatus === 'SUBSCRIBED' ? 'Онлайн' :
                  realtimeStatus === 'CONNECTING' ? 'Подключение...' : 'Нет связи'
                }
                style={{
                  width: '7px', height: '7px', borderRadius: '50%', flexShrink: 0,
                  background: realtimeStatus === 'SUBSCRIBED' ? '#4ADE80'
                    : realtimeStatus === 'CONNECTING' ? '#FACC15' : '#F87171',
                  boxShadow: realtimeStatus === 'SUBSCRIBED' ? '0 0 6px rgba(74,222,128,0.9)'
                    : realtimeStatus === 'CONNECTING' ? '0 0 6px rgba(250,204,21,0.9)' : '0 0 6px rgba(248,113,113,0.9)',
                }}
              />
              {!isOnline && (
                <span style={{ fontSize: '11px', color: '#F97316' }}>· Нет интернета</span>
              )}
            </div>

            <div style={{ color: '#fff', fontSize: '24px', fontWeight: 700 }}>{mixer.number}</div>
            <div style={{ color: '#94A3B8', fontSize: '14px', marginTop: '2px' }}>
              {mixer.driver} · {mixer.volume} м³
            </div>

            {/* Плашка offline-синхронизации */}
            {offlineQueue.length > 0 && (
              <div
                onClick={() => isOnline && syncOfflineQueue(offlineQueue)}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: '5px',
                  marginTop: '6px', cursor: isOnline ? 'pointer' : 'default',
                  padding: '4px 10px', borderRadius: '9999px',
                  background: 'rgba(250,204,21,0.1)', border: '1px solid rgba(250,204,21,0.3)',
                }}
              >
                <span style={{ fontSize: '11px', color: '#FACC15' }}>
                  {isSyncing ? '⏳ Синхронизация...' : `⚠️ ${offlineQueue.length} действ. не отправлено${isOnline ? ' — нажми' : ''}`}
                </span>
              </div>
            )}
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
              <div style={{ color: '#94A3B8', fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                {formatDateLabel(day)}
                <span style={{ color: '#475569', marginLeft: '8px', fontWeight: 400 }}>
                  {trips.length} {trips.length === 1 ? 'рейс' : trips.length < 5 ? 'рейса' : 'рейсов'}
                </span>
              </div>
              {trips.map((trip) => renderHistoryCard(trip))}
            </div>
          ))
        )}
      </div>

      {selectedTrip && <DriverTripDetailModal trip={selectedTrip} onClose={() => setSelectedTrip(null)} />}

      {/* ==================== МОДАЛ ПОДТВЕРЖДЕНИЯ СТАТУСА ==================== */}
      {confirmPending && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 3000,
            background: 'rgba(0,0,0,0.65)',
            display: 'flex',
            alignItems: 'flex-end',
            justifyContent: 'center',
            touchAction: 'none',
          }}
          onClick={() => setConfirmPending(null)}
          onTouchMove={(e) => e.target === e.currentTarget && e.preventDefault()}
        >
          <div
            style={{
              background: '#1E2937',
              borderRadius: '20px 20px 0 0',
              paddingTop: '24px',
              paddingLeft: '20px',
              paddingRight: '20px',
              paddingBottom: 'max(32px, env(safe-area-inset-bottom, 32px))',
              width: '100%',
              maxWidth: '480px',
              boxShadow: '0 -8px 40px rgba(0,0,0,0.4)',
            }}
            onClick={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
          >
            <div style={{ textAlign: 'center', marginBottom: '20px' }}>
              <div style={{ fontSize: '40px', marginBottom: '10px' }}>
                {confirmPending.newStatus === 'На объекте' ? '📍' : '✅'}
              </div>
              <div style={{ color: '#fff', fontSize: '19px', fontWeight: 700, lineHeight: 1.3 }}>
                {confirmPending.newStatus === 'На объекте'
                  ? 'Вы прибыли на объект?'
                  : 'Бетон полностью выгружен?'}
              </div>
              <div style={{ color: '#64748B', fontSize: '13px', marginTop: '8px', lineHeight: 1.5 }}>
                {confirmPending.newStatus === 'На объекте'
                  ? 'Нажмите Подтвердить только когда миксер\nвъехал на территорию объекта'
                  : 'Нажмите Подтвердить только когда весь\nбетон выгружен из миксера'}
              </div>
              <div style={{ color: '#94A3B8', fontSize: '13px', marginTop: '10px', background: '#263040', borderRadius: '8px', padding: '8px 12px' }}>
                Рейс #{confirmPending.trip.orderId} · {confirmPending.trip.volume} м³
                {confirmPending.trip.order?.address && (
                  <div style={{ color: '#475569', fontSize: '12px', marginTop: '2px' }}>
                    {confirmPending.trip.order.address}
                  </div>
                )}
              </div>
            </div>

            <button
              onClick={async () => {
                const { trip, newStatus } = confirmPending;
                setConfirmPending(null);
                await changeStatus(trip, newStatus);
              }}
              style={{
                width: '100%',
                padding: '15px',
                borderRadius: '14px',
                border: 'none',
                fontWeight: 700,
                fontSize: '16px',
                color: '#fff',
                cursor: 'pointer',
                background: confirmPending.newStatus === 'На объекте' ? '#3B82F6' : '#10B981',
                marginBottom: '10px',
              }}
            >
              Подтвердить
            </button>
            <button
              onClick={() => setConfirmPending(null)}
              style={{
                width: '100%',
                padding: '15px',
                borderRadius: '14px',
                border: '1px solid #334155',
                fontWeight: 600,
                fontSize: '16px',
                color: '#94A3B8',
                cursor: 'pointer',
                background: 'transparent',
              }}
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
