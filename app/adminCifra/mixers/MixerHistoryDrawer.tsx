'use client';

// Боковая панель (drawer) с полной историей рейсов миксера — только для администраторов.
// Водитель видит урезанную версию; здесь — все поля: клиент, адрес, тайминги, простой.

import { useEffect, useState } from 'react';
import { X, Clock, MapPin, Package, Phone, Calendar, BarChart3, ChevronDown, ChevronUp } from 'lucide-react';

interface MixerTrip {
  id: number;
  orderId: number;
  mixerName: string;
  time: string;
  volume: number;
  status: string;
  createdAt: string;
  loadingStartedAt: string | null;
  onSiteAt: string | null;
  unloadedAt: string | null;
  downtimeMinutes: number | null;
  order: {
    id: number;
    deliveryDate: string;
    deliveryTime: string;
    address: string;
    grade: string;
    clientName: string;
    phone: string;
    comment: string | null;
    status: string;
  } | null;
}

interface Stats {
  totalTrips: number;
  completedTrips: number;
  totalVolume: number;
  totalDowntimeMinutes: number;
}

interface Mixer {
  id: number;
  number: string;
  driver: string;
  model: string | null;
  volume: number;
  type: 'own' | 'rented';
}

interface Props {
  mixer: Mixer | null;
  onClose: () => void;
}

type Period = '7d' | '30d' | '90d' | 'all';

const PERIOD_LABELS: Record<Period, string> = {
  '7d': '7 дней',
  '30d': '30 дней',
  '90d': '90 дней',
  'all': 'Всё время',
};

const STATUS_COLOR: Record<string, string> = {
  'Загрузка':   '#FACC15',
  'В пути':     '#3B82F6',
  'На объекте': '#10B981',
  'Разгружен':  '#64748B',
  'Возврат':    '#64748B',
  'Проблема':   '#EF4444',
};

function formatDt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return 'Сегодня';
  if (same(d, yesterday)) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

function tripDurationMin(trip: MixerTrip): number | null {
  const start = trip.loadingStartedAt || trip.createdAt;
  const end = trip.unloadedAt;
  if (!start || !end) return null;
  return Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60_000);
}

function formatMin(min: number): string {
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}ч ${m}м` : `${h}ч`;
}

function getPeriodDates(period: Period): { from: string; to: string } | null {
  if (period === 'all') return null;
  const days = period === '7d' ? 7 : period === '30d' ? 30 : 90;
  const from = new Date();
  from.setDate(from.getDate() - days);
  const to = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { from: fmt(from), to: fmt(to) };
}

export default function MixerHistoryDrawer({ mixer, onClose }: Props) {
  const [trips, setTrips] = useState<MixerTrip[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);
  const [period, setPeriod] = useState<Period>('30d');
  const [expandedId, setExpandedId] = useState<number | null>(null);

  useEffect(() => {
    if (!mixer) return;
    setLoading(true);
    setTrips([]);
    setStats(null);

    const params = new URLSearchParams({ mixer_name: mixer.number });
    const dates = getPeriodDates(period);
    if (dates) {
      params.set('from', dates.from);
      params.set('to', dates.to);
    }

    fetch(`/api/adminCifra/mixer-history?${params}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setTrips(data.trips);
          setStats(data.stats);
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [mixer, period]);

  // Группировка по дням
  const byDay = trips.reduce<Record<string, MixerTrip[]>>((acc, trip) => {
    const day = trip.order?.deliveryDate || trip.createdAt.slice(0, 10);
    if (!acc[day]) acc[day] = [];
    acc[day].push(trip);
    return acc;
  }, {});
  const days = Object.entries(byDay).sort((a, b) => (a[0] < b[0] ? 1 : -1));

  if (!mixer) return null;

  return (
    <>
      {/* Затемнение */}
      <div
        style={{
          position: 'fixed', inset: 0, zIndex: 900,
          background: 'rgba(0,0,0,0.45)',
        }}
        onClick={onClose}
      />

      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 901,
        width: 'min(520px, 100vw)',
        background: '#0F172A',
        borderLeft: '1px solid #1E2937',
        display: 'flex', flexDirection: 'column',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
        overflowY: 'auto',
      }}>
        {/* Заголовок */}
        <div style={{
          padding: '20px 20px 16px',
          borderBottom: '1px solid #1E2937',
          position: 'sticky', top: 0, zIndex: 10,
          background: '#0F172A',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div>
              <div style={{ color: '#fff', fontSize: '20px', fontWeight: 700 }}>
                {mixer.number}
              </div>
              <div style={{ color: '#64748B', fontSize: '13px', marginTop: '2px' }}>
                {mixer.driver}
                {mixer.model ? ` · ${mixer.model}` : ''}
                {' · '}{mixer.volume} м³
                {' · '}
                <span style={{ color: mixer.type === 'own' ? '#4ADE80' : '#94A3B8' }}>
                  {mixer.type === 'own' ? 'Свой' : 'Наёмный'}
                </span>
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'transparent', border: 'none', color: '#64748B',
                cursor: 'pointer', padding: '4px', borderRadius: '8px',
                display: 'flex', alignItems: 'center',
              }}
            >
              <X size={20} />
            </button>
          </div>

          {/* Фильтр периода */}
          <div style={{ display: 'flex', gap: '6px', marginTop: '14px' }}>
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  padding: '5px 12px',
                  borderRadius: '9999px',
                  border: 'none',
                  fontSize: '12px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: period === p ? '#4ADE80' : '#1E2937',
                  color: period === p ? '#0F172A' : '#94A3B8',
                  transition: 'all 0.15s',
                }}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* Статистика */}
        {stats && (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '8px', padding: '16px 20px',
            borderBottom: '1px solid #1E2937',
          }}>
            {[
              { icon: <BarChart3 size={14} />, label: 'Рейсов', value: stats.totalTrips },
              { icon: <Package size={14} />, label: 'Завершено', value: stats.completedTrips },
              { icon: <Package size={14} />, label: 'Кубов', value: `${stats.totalVolume} м³` },
              {
                icon: <Clock size={14} />,
                label: 'Простой',
                value: stats.totalDowntimeMinutes > 0 ? formatMin(stats.totalDowntimeMinutes) : '—',
                warn: stats.totalDowntimeMinutes > 120,
              },
            ].map((item, i) => (
              <div key={i} style={{
                background: '#1E2937', borderRadius: '10px',
                padding: '10px 8px', textAlign: 'center',
              }}>
                <div style={{ color: '#475569', marginBottom: '4px', display: 'flex', justifyContent: 'center' }}>
                  {item.icon}
                </div>
                <div style={{
                  color: (item as any).warn ? '#F97316' : '#fff',
                  fontSize: '16px', fontWeight: 700,
                }}>
                  {item.value}
                </div>
                <div style={{ color: '#475569', fontSize: '10px', marginTop: '2px' }}>
                  {item.label}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Список рейсов */}
        <div style={{ padding: '12px 20px 32px', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#475569' }}>
              Загрузка...
            </div>
          ) : trips.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#475569' }}>
              Рейсов за выбранный период нет
            </div>
          ) : (
            days.map(([day, dayTrips]) => (
              <div key={day} style={{ marginBottom: '20px' }}>
                <div style={{
                  color: '#94A3B8', fontSize: '12px', fontWeight: 600,
                  textTransform: 'uppercase', letterSpacing: '0.05em',
                  marginBottom: '8px',
                }}>
                  {formatDate(day)}
                  <span style={{ color: '#334155', marginLeft: '8px', textTransform: 'none', letterSpacing: 0 }}>
                    {dayTrips.length} {dayTrips.length === 1 ? 'рейс' : dayTrips.length < 5 ? 'рейса' : 'рейсов'}
                  </span>
                </div>

                {dayTrips.map((trip) => {
                  const isExpanded = expandedId === trip.id;
                  const statusColor = STATUS_COLOR[trip.status] || '#64748B';
                  const duration = tripDurationMin(trip);

                  return (
                    <div
                      key={trip.id}
                      style={{
                        background: '#1E2937',
                        borderRadius: '12px',
                        marginBottom: '8px',
                        border: '1px solid #263040',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Строка-заголовок */}
                      <div
                        onClick={() => setExpandedId(isExpanded ? null : trip.id)}
                        style={{
                          display: 'flex', alignItems: 'center',
                          gap: '10px', padding: '12px 14px',
                          cursor: 'pointer',
                        }}
                      >
                        {/* Номер заявки */}
                        <div style={{
                          minWidth: '40px', textAlign: 'center',
                          background: '#0F172A', borderRadius: '6px', padding: '4px',
                        }}>
                          <div style={{ color: '#334155', fontSize: '9px' }}>#</div>
                          <div style={{ color: '#94A3B8', fontSize: '13px', fontWeight: 700 }}>
                            {trip.orderId}
                          </div>
                        </div>

                        {/* Время + клиент */}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            color: '#fff', fontSize: '13px', fontWeight: 600,
                            display: 'flex', alignItems: 'center', gap: '6px',
                          }}>
                            <Clock size={12} color="#475569" />
                            {trip.time || trip.order?.deliveryTime?.slice(0, 5) || '—'}
                            <span style={{ color: '#64748B', fontWeight: 400 }}>·</span>
                            <span style={{ color: '#CBD5E1', fontWeight: 500 }}>
                              {trip.volume} м³
                            </span>
                            {trip.order?.grade && (
                              <span style={{ color: '#64748B', fontWeight: 400 }}>
                                {trip.order.grade}
                              </span>
                            )}
                          </div>
                          {trip.order?.clientName && (
                            <div style={{ color: '#64748B', fontSize: '12px', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {trip.order.clientName}
                            </div>
                          )}
                        </div>

                        {/* Статус + стрелка */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                          <span style={{
                            padding: '3px 8px', borderRadius: '9999px',
                            fontSize: '11px', fontWeight: 600,
                            color: statusColor,
                            background: `${statusColor}18`,
                          }}>
                            {trip.status}
                          </span>
                          {isExpanded
                            ? <ChevronUp size={14} color="#475569" />
                            : <ChevronDown size={14} color="#475569" />
                          }
                        </div>
                      </div>

                      {/* Развёрнутые детали */}
                      {isExpanded && (
                        <div style={{ padding: '0 14px 14px', borderTop: '1px solid #263040' }}>
                          <div style={{ paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>

                            {/* Адрес */}
                            {trip.order?.address && (
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                <MapPin size={13} color="#475569" style={{ marginTop: '2px', flexShrink: 0 }} />
                                <span style={{ color: '#94A3B8', fontSize: '13px', lineHeight: 1.4 }}>
                                  {trip.order.address}
                                </span>
                              </div>
                            )}

                            {/* Телефон клиента */}
                            {trip.order?.phone && (
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <Phone size={13} color="#475569" />
                                <a
                                  href={`tel:${trip.order.phone}`}
                                  style={{ color: '#4ADE80', fontSize: '13px', textDecoration: 'none' }}
                                >
                                  {trip.order.phone}
                                </a>
                              </div>
                            )}

                            {/* Комментарий */}
                            {trip.order?.comment && (
                              <div style={{
                                padding: '8px 10px', borderRadius: '8px',
                                background: 'rgba(250,204,21,0.06)',
                                border: '1px solid rgba(250,204,21,0.15)',
                                color: '#FDE68A', fontSize: '12px', lineHeight: 1.4,
                              }}>
                                💬 {trip.order.comment}
                              </div>
                            )}

                            {/* Тайминги */}
                            <div style={{
                              display: 'grid', gridTemplateColumns: '1fr 1fr',
                              gap: '6px', marginTop: '4px',
                            }}>
                              {[
                                { label: 'Начало загрузки', value: formatDt(trip.loadingStartedAt) },
                                { label: 'Выезд', value: formatDt(trip.createdAt) },
                                { label: 'Прибытие', value: formatDt(trip.onSiteAt) },
                                { label: 'Разгружен', value: formatDt(trip.unloadedAt) },
                              ].map((item, i) => (
                                <div key={i} style={{
                                  background: '#0F172A', borderRadius: '8px',
                                  padding: '8px 10px',
                                }}>
                                  <div style={{ color: '#334155', fontSize: '10px' }}>{item.label}</div>
                                  <div style={{ color: '#CBD5E1', fontSize: '13px', fontWeight: 600, marginTop: '2px' }}>
                                    {item.value}
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Итоги */}
                            <div style={{
                              display: 'flex', gap: '8px', marginTop: '4px',
                            }}>
                              {duration !== null && (
                                <div style={{
                                  flex: 1, background: '#0F172A', borderRadius: '8px',
                                  padding: '8px 10px', textAlign: 'center',
                                }}>
                                  <div style={{ color: '#334155', fontSize: '10px' }}>Длительность</div>
                                  <div style={{ color: '#94A3B8', fontSize: '14px', fontWeight: 600, marginTop: '2px' }}>
                                    {formatMin(duration)}
                                  </div>
                                </div>
                              )}
                              {Number(trip.downtimeMinutes) > 0 && (
                                <div style={{
                                  flex: 1, background: '#0F172A', borderRadius: '8px',
                                  padding: '8px 10px', textAlign: 'center',
                                }}>
                                  <div style={{ color: '#334155', fontSize: '10px' }}>Простой</div>
                                  <div style={{ color: '#F97316', fontSize: '14px', fontWeight: 600, marginTop: '2px' }}>
                                    ⏱ {formatMin(Number(trip.downtimeMinutes))}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
