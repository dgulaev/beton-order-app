'use client';

import React, { useState, useEffect, useRef } from 'react';
import { X, MapPin, Navigation, ChevronDown, Clock } from 'lucide-react';
import { Order } from '../../adminCifra/hooks/useCalendarOrders';
import { useYandexRouteHref } from '@/lib/yandexRoute';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { OrderHistoryTimeline } from '@/lib/orderHistoryDisplay';

interface MobileOrderDetailModalProps {
  order: Order | null;
  onClose: () => void;
  mixerAssignments: any[];
  setMixerAssignments: React.Dispatch<React.SetStateAction<any[]>>;
  allOrders: Order[];
  setAllOrders: React.Dispatch<React.SetStateAction<Order[]>>;
  allMixers: any[];
  currentUser?: { id: number; name?: string; role: string };
  handleStatusChange: (mixerId: number, newStatus: string) => void;
  deleteMixer: (mixerId: number, index: number) => void;
  history: any[];
  addToHistory: (action: string) => Promise<void>;
  getStatusConfig: (status: string) => any;
  setHistory: React.Dispatch<React.SetStateAction<any[]>>;
  setSelectedOrder: React.Dispatch<React.SetStateAction<Order | null>>;
}

const STATUS_OPTIONS = [
  { value: 'new',        label: 'Новая',     color: '#F59E0B' },
  { value: 'processing', label: 'В работе',  color: '#3B82F6' },
  { value: 'completed',  label: 'Выполнена', color: '#10B981' },
  { value: 'cancelled',  label: 'Отменена',  color: '#EF4444' },
];
function statusCfg(s: string) {
  return STATUS_OPTIONS.find(x => x.value === s) ?? { value: s, label: s, color: '#64748B', final: false };
}

function InfoRow({ label, value, accent }: { label: string; value: React.ReactNode; accent?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', padding: '10px 0', borderBottom: '1px solid #334155' }}>
      <span style={{ color: '#475569', fontSize: '13px', flexShrink: 0 }}>{label}</span>
      <span style={{ color: accent || '#CBD5E1', fontSize: '14px', fontWeight: 600, textAlign: 'right', lineHeight: 1.35 }}>{value || '—'}</span>
    </div>
  );
}

export default function MobileDashboardOrderModal(props: MobileOrderDetailModalProps) {
  const {
    order,
    onClose,
    mixerAssignments,
    setAllOrders,
    currentUser,
    history: initialHistory,
    setHistory,
  } = props;

  const [localOrder, setLocalOrder] = useState(order);
  const [history, setLocalHistory] = useState(initialHistory || []);
  const [questionableSaving, setQuestionableSaving] = useState(false);
  const questionableSavingRef = useRef(false);
  const { href: yandexRouteHref, ready: yandexRouteReady } = useYandexRouteHref(order?.address);

  const role = (currentUser?.role || '').toLowerCase().trim();
  const canManageQuestionable = ['admin', 'manager', 'dispatcher', 'logist'].includes(role);

  useBodyScrollLock(!!order);

  useEffect(() => {
    if (!order?.id) return;
    fetch(`/api/adminCifra/order-history?orderId=${order.id}&_t=${Date.now()}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => { setLocalHistory(data); if (setHistory) setHistory(data); })
      .catch(console.error);
  }, [order?.id, setHistory]);

  useEffect(() => { setLocalOrder(order); }, [order]);

  if (!order || !localOrder) return null;

  const currentMixers = mixerAssignments
    .filter(m => String(m.orderId ?? m.order_id) === String(order.id))
    .sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));

  const assignedVolume = currentMixers.reduce((s, m) => s + Number(m.volume || 0), 0);
  const orderVolume = Number(order.volume || 0);
  const totalDowntimeMin = currentMixers.reduce((s, m) => s + Number(m.downtimeMinutes || 0), 0);

  const sc = statusCfg(localOrder.status);
  const isFinal = localOrder.status === 'completed' || localOrder.status === 'cancelled';

  const formatOnSite = (mixer: any): string | null => {
    if (!mixer.onSiteAt) return null;
    const end = mixer.unloadedAt ? new Date(mixer.unloadedAt) : new Date();
    const m = Math.round((end.getTime() - new Date(mixer.onSiteAt).getTime()) / 60000);
    return m < 0 ? null : `${m} мин`;
  };

  const reloadHistory = async () => {
    const histRes = await fetch(`/api/adminCifra/order-history?orderId=${order.id}&_t=${Date.now()}`);
    if (histRes.ok) {
      const d = await histRes.json();
      setLocalHistory(d);
      if (setHistory) setHistory(d);
    }
  };

  const handleOrderStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value;
    if (newStatus === localOrder.status) return;
    const oldStatus = localOrder.status;
    const oldQuestionable = !!(localOrder as any).is_questionable;
    const clearQuestionable = newStatus === 'processing' && oldStatus !== 'processing';

    setLocalOrder(prev => prev
      ? ({ ...prev, status: newStatus, ...(clearQuestionable ? { is_questionable: false } : {}) } as any)
      : prev
    );
    setAllOrders(prev => prev.map(o =>
      o.id === order.id
        ? ({ ...o, status: newStatus, ...(clearQuestionable ? { is_questionable: false } : {}) } as any)
        : o
    ));
    try {
      const res = await fetch('/api/adminCifra/orders/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: order.id, status: newStatus, userName: currentUser?.name || 'Пользователь', userRole: currentUser?.role || 'unknown' }),
      });
      const data = await res.json();
      if (!data.success) {
        setLocalOrder(prev => prev
          ? ({ ...prev, status: oldStatus, is_questionable: oldQuestionable } as any)
          : prev
        );
        setAllOrders(prev => prev.map(o =>
          o.id === order.id
            ? ({ ...o, status: oldStatus, is_questionable: oldQuestionable } as any)
            : o
        ));
        alert('Ошибка: ' + (data.message || ''));
        return;
      }
      await reloadHistory();
    } catch {
      setLocalOrder(prev => prev
        ? ({ ...prev, status: oldStatus, is_questionable: oldQuestionable } as any)
        : prev
      );
      setAllOrders(prev => prev.map(o =>
        o.id === order.id
          ? ({ ...o, status: oldStatus, is_questionable: oldQuestionable } as any)
          : o
      ));
      alert('Ошибка соединения');
    }
  };

  const toggleQuestionable = async (newValue: boolean) => {
    if (questionableSavingRef.current || !order?.id) return;
    questionableSavingRef.current = true;
    setQuestionableSaving(true);
    const prevValue = !!(localOrder as any).is_questionable;

    setLocalOrder(prev => prev ? ({ ...prev, is_questionable: newValue } as any) : prev);
    setAllOrders(prev => prev.map(o =>
      o.id === order.id ? ({ ...o, is_questionable: newValue } as any) : o
    ));

    try {
      const res = await fetch('/api/adminCifra/orders/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: order.id,
          is_questionable: newValue,
          userName: currentUser?.name || 'Пользователь',
          userRole: currentUser?.role || 'unknown',
        }),
      });
      if (!res.ok) {
        setLocalOrder(prev => prev ? ({ ...prev, is_questionable: prevValue } as any) : prev);
        setAllOrders(prev => prev.map(o =>
          o.id === order.id ? ({ ...o, is_questionable: prevValue } as any) : o
        ));
      } else {
        await reloadHistory();
      }
    } catch {
      setLocalOrder(prev => prev ? ({ ...prev, is_questionable: prevValue } as any) : prev);
      setAllOrders(prev => prev.map(o =>
        o.id === order.id ? ({ ...o, is_questionable: prevValue } as any) : o
      ));
    } finally {
      questionableSavingRef.current = false;
      setQuestionableSaving(false);
    }
  };

  const getFullAddress = (a: string) => (!a ? 'Брянск' : /брянск/i.test(a) ? a : `Брянск, ${a}`);
  const googleMapsHref = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent('Брянск, туп. Орловский, 6А')}&destination=${encodeURIComponent(getFullAddress(order.address || ''))}&travelmode=driving`;

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 100000, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as any }}
      onClick={onClose}
    >
      <div
        style={{ background: '#0D1520', minHeight: '100vh', maxWidth: '560px', margin: '0 auto', paddingBottom: '40px' }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── ШАПКА ─────────────────────────────────── */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: '#25334A',
          borderBottom: '1px solid #334155',
          padding: '12px 14px',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0, paddingRight: '4px' }}>
            <span style={{ fontSize: '17px', fontWeight: 700, color: '#E2E8F0', whiteSpace: 'nowrap' }}>
              Заявка #{order.id}
            </span>

            {isFinal ? (
              <span style={{ padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700, background: `${sc.color}20`, color: sc.color, whiteSpace: 'nowrap' }}>
                {sc.label}
              </span>
            ) : (
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <select
                  value={localOrder.status || 'new'}
                  onChange={handleOrderStatusChange}
                  style={{ appearance: 'none', padding: '4px 22px 4px 10px', borderRadius: '9999px', border: `1px solid ${sc.color}50`, background: `${sc.color}20`, color: sc.color, fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                >
                  {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
                <ChevronDown size={10} color={sc.color} style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              </div>
            )}

            {/* Компактный бейдж — не наезжает на крестик */}
            {canManageQuestionable && (
              <label
                title="Под вопросом"
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: '26px', height: '26px', borderRadius: '9999px', flexShrink: 0,
                  border: '1px solid rgba(239,68,68,0.45)',
                  background: (localOrder as any).is_questionable ? '#EF4444' : 'transparent',
                  color: (localOrder as any).is_questionable ? '#fff' : '#F87171',
                  fontSize: '13px', fontWeight: 800, lineHeight: 1,
                  cursor: questionableSaving ? 'wait' : 'pointer',
                  opacity: questionableSaving ? 0.7 : 1,
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={!!(localOrder as any).is_questionable}
                  disabled={questionableSaving}
                  onChange={e => toggleQuestionable(e.target.checked)}
                  style={{ position: 'absolute', opacity: 0, width: 0, height: 0 }}
                />
                ?
              </label>
            )}
          </div>

          <button onClick={onClose} style={{ background: '#334155', border: 'none', borderRadius: '9999px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <X size={16} color="#64748B" />
          </button>
        </div>

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* ── ИНФО О ЗАКАЗЕ ─────────────────────── */}
          <div style={{ background: '#25334A', borderRadius: '16px', padding: '16px' }}>
            <InfoRow label="Клиент" value={order.organization_name || order.full_name} />
            <InfoRow label="Телефон" value={order.phone} />
            <InfoRow label="Марка бетона" value={order.grade} accent="#60A5FA" />
            <InfoRow label="Объём" value={`${order.volume} м³`} accent="#10B981" />
            <InfoRow label="Дата и время" value={`${order.delivery_date} · ${order.delivery_time}`} />
            <InfoRow label="Адрес" value={order.address} />
            {order.comment && (
              <div style={{ marginTop: '12px', background: '#334155', borderRadius: '10px', padding: '12px', color: '#94A3B8', fontSize: '13px', lineHeight: 1.5 }}>
                <span style={{ color: '#475569', display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Комментарий</span>
                <div style={{ maxHeight: '120px', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                  {order.comment}
                </div>
              </div>
            )}
          </div>

          {/* ── ПРОГРЕСС ОБЪЁМА ───────────────────── */}
          {currentMixers.length > 0 && (
            <div style={{ background: '#25334A', borderRadius: '16px', padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ color: '#475569', fontSize: '13px' }}>Назначено</span>
                <span style={{ color: assignedVolume >= orderVolume ? '#10B981' : '#FACC15', fontWeight: 700, fontSize: '14px' }}>
                  {assignedVolume.toFixed(1)} / {orderVolume} м³
                </span>
              </div>
              <div style={{ background: '#334155', borderRadius: '9999px', height: '6px', overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: '9999px', width: `${Math.min(100, (assignedVolume / orderVolume) * 100)}%`, background: assignedVolume >= orderVolume ? '#10B981' : '#FACC15', transition: 'width 0.3s' }} />
              </div>
              {totalDowntimeMin > 0 && (
                <div style={{ marginTop: '8px', color: '#F97316', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <Clock size={12} /> Общий простой: {totalDowntimeMin} мин
                </div>
              )}
            </div>
          )}

          {/* ── МИКСЕРЫ ───────────────────────────── */}
          <div style={{ background: '#25334A', borderRadius: '16px', padding: '16px' }}>
            <div style={{ color: '#475569', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
              Миксеры ({currentMixers.length})
            </div>
            {currentMixers.length === 0 ? (
              <div style={{ color: '#334155', fontSize: '14px', textAlign: 'center', padding: '24px 0' }}>Миксеры не назначены</div>
            ) : <div style={{ maxHeight: '260px', overflowY: 'auto' }}>{currentMixers.map(mixer => {
              const onSite = formatOnSite(mixer);
              const hasDowntime = Number(mixer.downtimeMinutes) > 0;
              const st = mixer.status || 'Загрузка';
              const statusColor =
                st === 'Загрузка' ? '#FACC15' :
                st === 'В пути' ? '#3B82F6' :
                st === 'На объекте' ? '#10B981' :
                st === 'Разгружен' ? '#34D399' :
                st === 'Проблема' ? '#EF4444' :
                st === 'Возврат' ? '#94A3B8' : '#64748B';
              return (
                <div key={mixer.id} style={{ background: '#334155', borderRadius: '12px', padding: '12px 14px', marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', borderLeft: `3px solid ${statusColor}` }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14px', color: '#E2E8F0' }}>{mixer.mixerName || mixer.number || 'Миксер'}</div>
                    <div style={{ color: '#475569', fontSize: '12px', marginTop: '2px' }}>{mixer.time}</div>
                    {onSite && (
                      <div style={{ marginTop: '6px', display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 8px', borderRadius: '9999px', background: hasDowntime ? '#F9731615' : '#33415515', color: hasDowntime ? '#F97316' : '#64748B', fontSize: '12px' }}>
                        <Clock size={10} /> {onSite}{st === 'Разгружен' && hasDowntime ? ` (простой ${mixer.downtimeMinutes} мин)` : ''}
                      </div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: '16px', color: '#E2E8F0' }}>{Number(mixer.volume).toFixed(1)} м³</div>
                    <div style={{
                      marginTop: '4px', fontSize: '11px', fontWeight: 700, color: statusColor,
                      display: 'inline-flex', alignItems: 'center', gap: '4px',
                      padding: '2px 8px', borderRadius: '9999px',
                      background: `${statusColor}18`, border: `1px solid ${statusColor}40`,
                    }}>
                      {st}
                    </div>
                  </div>
                </div>
              );
            })}</div>}
          </div>

          {/* ── КАРТЫ ─────────────────────────────── */}
          <div style={{ display: 'flex', gap: '10px' }}>
            <a
              href={yandexRouteHref}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!yandexRouteReady}
              onClick={e => { if (!yandexRouteReady) e.preventDefault(); }}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                padding: '13px',
                background: 'transparent',
                color: yandexRouteReady ? '#3B82F6' : '#334155',
                border: `1px solid ${yandexRouteReady ? '#3B82F650' : '#334155'}`,
                borderRadius: '12px',
                fontSize: '14px', fontWeight: 600,
                textDecoration: 'none',
                cursor: yandexRouteReady ? 'pointer' : 'wait',
              }}
            >
              <MapPin size={15} />
              {yandexRouteReady ? 'Яндекс' : '...'}
            </a>
            <a
              href={googleMapsHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                padding: '13px',
                background: 'transparent',
                color: '#10B981',
                border: '1px solid #10B98150',
                borderRadius: '12px',
                fontSize: '14px', fontWeight: 600,
                textDecoration: 'none',
              }}
            >
              <Navigation size={15} />
              Google
            </a>
          </div>

          {/* ── ИСТОРИЯ (тот же таймлайн, что на десктопе) ── */}
          <div style={{ background: '#25334A', borderRadius: '16px', padding: '16px' }}>
            <div style={{ color: '#475569', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
              История изменений
            </div>
            <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
              <OrderHistoryTimeline entries={history} emptyText="История пока пуста" />
            </div>
          </div>

          {/* ── ЗАКРЫТЬ ───────────────────────────── */}
          <button
            onClick={onClose}
            style={{
              width: '100%', padding: '14px',
              background: 'transparent', color: '#475569',
              border: '1px solid #334155', borderRadius: '12px',
              fontWeight: 600, fontSize: '15px', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
            }}
          >
            <X size={16} /> Закрыть
          </button>

        </div>
      </div>
    </div>
  );
}
