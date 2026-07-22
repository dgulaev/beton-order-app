'use client';

import { useState, useEffect, useRef } from 'react';
import { Save, Trash2, Share2, Copy, X, User, Phone, Layers, Clock, Calendar, MapPin, MessageSquare, ChevronDown } from 'lucide-react';
import { useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import ModalActionButton from '@/app/adminCifra/components/ModalActionButton';
import { OrderHistoryTimeline } from '@/lib/orderHistoryDisplay';

interface MobileOrderDetailModalProps {
  isOpen: boolean;
  order: any;
  onClose: () => void;
  onUpdate?: (updatedOrder: any) => void;
  onDelete?: (orderId: number) => void;
  onCopyOrder?: (copiedData: any) => void;
  currentRole?: string;
  currentUserName?: string;
  recipes?: any[];
  clients?: any[];
}

const STATUS_OPTIONS = [
  { value: 'new',        label: 'Новая',     color: '#F59E0B' },
  { value: 'processing', label: 'В работе',  color: '#3B82F6' },
  { value: 'completed',  label: 'Выполнена', color: '#10B981' },
  { value: 'cancelled',  label: 'Отменена',  color: '#EF4444' },
];

function statusCfg(status: string) {
  return STATUS_OPTIONS.find(s => s.value === status) ?? { value: status, label: status, color: '#64748B' };
}

function FieldBlock({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
      <div style={{ color: '#475569', marginTop: '1px', flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: '#475569', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>{label}</div>
        {children}
      </div>
    </div>
  );
}

const INPUT: React.CSSProperties = {
  width: '100%',
  padding: '11px 14px',
  background: '#25334A',
  border: '1px solid #334155',
  borderRadius: '10px',
  color: '#E2E8F0',
  fontSize: '15px',
  boxSizing: 'border-box',
};

export default function MobileOrderDetailModal({
  isOpen,
  order,
  onClose,
  onUpdate,
  onDelete,
  onCopyOrder,
  currentRole = 'admin',
  currentUserName = 'Сотрудник',
  recipes = [],
  clients = [],
}: MobileOrderDetailModalProps) {
  const [editedOrder, setEditedOrder] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [orderHistory, setOrderHistory] = useState<any[]>([]);
  const [questionableSaving, setQuestionableSaving] = useState(false);
  const questionableSavingRef = useRef(false);

  // Поиск клиента
  const [clientQuery, setClientQuery] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientDropdownRef = useRef<HTMLDivElement>(null);

  const canManageQuestionable = ['admin', 'manager', 'dispatcher', 'logist'].includes(
    (currentRole || '').toLowerCase().trim()
  );

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (clientDropdownRef.current && !clientDropdownRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useRealtimeBroadcast({
    topic: 'orders:all',
    enabled: isOpen && !!order?.id,
    onUpdate: (record) => {
      if (record && String(record.id) === String(order?.id)) {
        setEditedOrder((prev: any) => ({ ...prev, ...record }));
      }
    },
  });

  useEffect(() => {
    setEditedOrder(order ? { ...order } : null);
  }, [order]);

  useEffect(() => {
    if (!isOpen || !order?.id) {
      setOrderHistory([]);
      return;
    }
    fetch(`/api/adminCifra/order-history?orderId=${order.id}&_t=${Date.now()}`)
      .then(r => (r.ok ? r.json() : []))
      .then(data => setOrderHistory(Array.isArray(data) ? data : []))
      .catch(() => setOrderHistory([]));
  }, [isOpen, order?.id]);

  useBodyScrollLock(isOpen && !!editedOrder);
  if (!isOpen || !editedOrder) return null;

  const sc = statusCfg(editedOrder.status);
  const isFinal = editedOrder.status === 'completed' || editedOrder.status === 'cancelled';
  const canDelete = currentRole === 'admin';

  const set = (field: string, value: any) => {
    setEditedOrder((p: any) => {
      const next = { ...p, [field]: value };
      // «В работе» на сервере автоснимает метку — сразу отражаем в UI
      if (field === 'status' && value === 'processing' && p.status !== 'processing') {
        next.is_questionable = false;
      }
      return next;
    });
  };

  const toggleQuestionable = async (newValue: boolean) => {
    if (questionableSavingRef.current || !editedOrder?.id) return;
    questionableSavingRef.current = true;
    setQuestionableSaving(true);
    const prevValue = !!editedOrder.is_questionable;
    setEditedOrder((p: any) => ({ ...p, is_questionable: newValue }));
    try {
      const res = await fetch('/api/adminCifra/orders/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editedOrder.id,
          is_questionable: newValue,
          userRole: currentRole,
          userName: currentUserName,
        }),
      });
      if (!res.ok) {
        setEditedOrder((p: any) => ({ ...p, is_questionable: prevValue }));
      } else {
        if (onUpdate) onUpdate({ ...editedOrder, is_questionable: newValue });
        const histRes = await fetch(`/api/adminCifra/order-history?orderId=${editedOrder.id}&_t=${Date.now()}`);
        if (histRes.ok) setOrderHistory(await histRes.json());
      }
    } catch {
      setEditedOrder((p: any) => ({ ...p, is_questionable: prevValue }));
    } finally {
      questionableSavingRef.current = false;
      setQuestionableSaving(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/adminCifra/orders/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editedOrder, userRole: currentRole, userName: currentUserName }),
      });
      if (res.ok) {
        // Сервер при «В работе» снимает метку — отдаём родителю актуальное состояние
        const saved = {
          ...editedOrder,
          ...(editedOrder.status === 'processing' ? { is_questionable: false } : {}),
        };
        if (onUpdate) onUpdate(saved);
        onClose();
      } else {
        alert('Ошибка сохранения');
      }
    } catch {
      alert('Ошибка соединения');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyOrder = () => {
    const copiedData = {
      grade: editedOrder.grade,
      volume: editedOrder.volume,
      deliveryDate: editedOrder.delivery_date || editedOrder.deliveryDate,
      deliveryTime: editedOrder.delivery_time || editedOrder.deliveryTime,
      address: editedOrder.address,
      customerType: (editedOrder.customer_type || editedOrder.customerType || '').includes('Юридическое') ? 'legal' : 'physical',
      organizationName: editedOrder.organization_name || '',
      fullName: editedOrder.full_name || '',
      phone: editedOrder.phone || '',
      inn: editedOrder.inn || '',
      comment: editedOrder.comment || '',
    };
    onClose();
    if (onCopyOrder) onCopyOrder(copiedData);
  };

  const handleShare = () => {
    const id = editedOrder.id || '—';
    const text = `Заявка #${id}\nКлиент: ${editedOrder.organization_name || editedOrder.full_name || '—'}\nТелефон: ${editedOrder.phone || '—'}\nОбъём: ${editedOrder.volume} м³ ${editedOrder.grade || ''}\nДата: ${editedOrder.delivery_date || '—'} ${editedOrder.delivery_time || ''}\nАдрес: ${editedOrder.address || '—'}${editedOrder.comment ? `\nКомментарий: ${editedOrder.comment}` : ''}`;
    if (navigator.share) {
      navigator.share({ title: `Заявка #${id}`, text }).catch(() => navigator.clipboard.writeText(text));
    } else {
      navigator.clipboard.writeText(text);
    }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 10000, overflowY: 'auto', WebkitOverflowScrolling: 'touch' as any }}
      onClick={onClose}
    >
      <div
        style={{ background: '#0D1520', minHeight: '100vh', maxWidth: '560px', margin: '0 auto', paddingBottom: '40px' }}
        onClick={e => e.stopPropagation()}
      >

        {/* ── ШАПКА ──────────────────────────────────────── */}
        <div style={{
          position: 'sticky', top: 0, zIndex: 10,
          background: '#25334A',
          borderBottom: '1px solid #334155',
          padding: '12px 14px',
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '8px',
        }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px', minWidth: 0, flex: 1, paddingRight: '4px' }}>
            <span style={{ fontSize: '17px', fontWeight: 700, color: '#E2E8F0', whiteSpace: 'nowrap' }}>
              Заявка #{editedOrder.id}
            </span>

            {/* Статус — select для активных, пилюля для финальных */}
            {isFinal ? (
              <span style={{
                padding: '4px 10px', borderRadius: '9999px', fontSize: '11px', fontWeight: 700,
                background: `${sc.color}20`, color: sc.color, whiteSpace: 'nowrap',
              }}>
                {sc.label}
              </span>
            ) : (
              <div style={{ position: 'relative', flexShrink: 0 }}>
                <select
                  value={editedOrder.status || 'new'}
                  onChange={e => set('status', e.target.value)}
                  style={{
                    appearance: 'none',
                    padding: '4px 22px 4px 10px',
                    borderRadius: '9999px',
                    border: `1px solid ${sc.color}50`,
                    background: `${sc.color}20`,
                    color: sc.color,
                    fontSize: '11px', fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {STATUS_OPTIONS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
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
                  background: editedOrder.is_questionable ? '#EF4444' : 'transparent',
                  color: editedOrder.is_questionable ? '#fff' : '#F87171',
                  fontSize: '13px', fontWeight: 800, lineHeight: 1,
                  cursor: questionableSaving ? 'wait' : 'pointer',
                  opacity: questionableSaving ? 0.7 : 1,
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={!!editedOrder.is_questionable}
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

          {/* ── КЛИЕНТ ──────────────────────────────────── */}
          <div style={{ background: '#25334A', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <FieldBlock icon={<User size={15} />} label="Клиент">
              <div ref={clientDropdownRef} style={{ position: 'relative' }}>
                <input
                  value={clientQuery !== '' ? clientQuery : (editedOrder.organization_name || editedOrder.full_name || '')}
                  placeholder="Поиск по имени, ИНН, телефону…"
                  onChange={e => { setClientQuery(e.target.value); setShowClientDropdown(true); }}
                  onFocus={() => { setClientQuery(''); setShowClientDropdown(true); }}
                  style={INPUT}
                />
                {showClientDropdown && (() => {
                  const q = clientQuery.toLowerCase();
                  const filtered = clients.filter((c: any) => {
                    const name = (c.organization_name || c.full_name || '').toLowerCase();
                    const phone = (c.phone || '').toLowerCase();
                    const inn = (c.inn || '').toLowerCase();
                    return !q || name.includes(q) || phone.includes(q) || inn.includes(q);
                  }).slice(0, 8);
                  if (!filtered.length) return null;
                  return (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                      background: '#1A2537', border: '1px solid #334155', borderRadius: '10px',
                      boxShadow: '0 8px 24px rgba(0,0,0,0.5)', maxHeight: '240px', overflowY: 'auto',
                      marginTop: '4px',
                    }}>
                      {filtered.map((c: any, ci: number) => {
                        const displayName = c.organization_name || c.full_name || '—';
                        const isLegal = !!c.organization_name;
                        return (
                          <div
                            key={`${c.user_id ?? 'x'}-${ci}`}
                            onTouchStart={() => {
                              set('organization_name', c.organization_name || '');
                              set('full_name', c.full_name || '');
                              set('phone', c.phone || editedOrder.phone);
                              set('inn', c.inn || editedOrder.inn);
                              set('user_id', c.user_id);
                              setClientQuery('');
                              setShowClientDropdown(false);
                            }}
                            onMouseDown={() => {
                              set('organization_name', c.organization_name || '');
                              set('full_name', c.full_name || '');
                              set('phone', c.phone || editedOrder.phone);
                              set('inn', c.inn || editedOrder.inn);
                              set('user_id', c.user_id);
                              setClientQuery('');
                              setShowClientDropdown(false);
                            }}
                            style={{
                              padding: '10px 14px', cursor: 'pointer',
                              borderBottom: '1px solid #334155',
                            }}
                          >
                            <div style={{ fontSize: '14px', fontWeight: 600, color: '#E2E8F0' }}>
                              {isLegal ? '🏢 ' : '👤 '}{displayName}
                            </div>
                            <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>
                              {[c.phone, c.inn ? `ИНН ${c.inn}` : null].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </div>
            </FieldBlock>
            <FieldBlock icon={<Phone size={15} />} label="Телефон">
              <input value={editedOrder.phone || ''} onChange={e => set('phone', e.target.value)} style={INPUT} type="tel" />
            </FieldBlock>
          </div>

          {/* ── ПАРАМЕТРЫ ЗАКАЗА ─────────────────────── */}
          <div style={{ background: '#25334A', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <FieldBlock icon={<Layers size={15} />} label="Марка бетона">
              {recipes.length > 0 ? (
                <select
                  value={editedOrder.grade || ''}
                  onChange={e => set('grade', e.target.value)}
                  style={{ ...INPUT, color: editedOrder.grade ? '#E2E8F0' : '#64748B' }}
                >
                  {!editedOrder.grade && <option value="">— выберите марку —</option>}
                  {recipes
                    .map((r: any) => r.code || r.name)
                    .filter((v: string, i: number, arr: string[]) => v && arr.indexOf(v) === i)
                    .sort()
                    .map((grade: string) => (
                      <option key={grade} value={grade}>{grade}</option>
                    ))
                  }
                </select>
              ) : (
                <input value={editedOrder.grade || ''} onChange={e => set('grade', e.target.value)} style={INPUT} />
              )}
            </FieldBlock>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              <FieldBlock icon={<span style={{ fontSize: '13px' }}>м³</span>} label="Объём">
                <input value={editedOrder.volume || ''} onChange={e => set('volume', e.target.value)} style={INPUT} type="number" step="0.01" />
              </FieldBlock>
              <FieldBlock icon={<Clock size={15} />} label="Время">
                <input value={editedOrder.delivery_time || ''} onChange={e => set('delivery_time', e.target.value)} style={INPUT} type="time" />
              </FieldBlock>
            </div>

            <FieldBlock icon={<Calendar size={15} />} label="Дата доставки">
              <input value={editedOrder.delivery_date || ''} onChange={e => set('delivery_date', e.target.value)} style={INPUT} type="date" />
            </FieldBlock>
          </div>

          {/* ── АДРЕС + КОММЕНТАРИЙ ────────────────── */}
          <div style={{ background: '#25334A', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <FieldBlock icon={<MapPin size={15} />} label="Адрес доставки">
              <textarea value={editedOrder.address || ''} onChange={e => set('address', e.target.value)} rows={2} style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5 }} />
            </FieldBlock>
            <FieldBlock icon={<MessageSquare size={15} />} label="Комментарий">
              <textarea value={editedOrder.comment || ''} onChange={e => set('comment', e.target.value)} rows={3} style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5 }} />
            </FieldBlock>
          </div>

          {/* ── ИСТОРИЯ ──────────────────────────────── */}
          <div style={{ background: '#25334A', borderRadius: '16px', padding: '16px' }}>
            <div style={{ color: '#475569', fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
              История изменений
            </div>
            <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
              <OrderHistoryTimeline entries={orderHistory} emptyText="История пока пуста" />
            </div>
          </div>

          {/* ── КНОПКИ ───────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <ModalActionButton onClick={handleSave} disabled={isSaving} color="#10B981" icon={<Save size={17} />} label={isSaving ? 'Сохраняем...' : 'Сохранить'} fullWidth size="lg" />
              {canDelete && (
                <ModalActionButton onClick={() => onDelete && onDelete(editedOrder.id)} color="#EF4444" icon={<Trash2 size={17} />} label="Удалить" fullWidth size="lg" />
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <ModalActionButton onClick={handleShare} color="#3B82F6" icon={<Share2 size={17} />} label="Поделиться" fullWidth size="lg" />
              <ModalActionButton onClick={handleCopyOrder} color="#8B5CF6" icon={<Copy size={17} />} label="Копировать" fullWidth size="lg" />
            </div>
            <ModalActionButton onClick={onClose} color="#475569" icon={<X size={17} />} label="Закрыть" fullWidth size="lg" />
          </div>

        </div>
      </div>
    </div>
  );
}
