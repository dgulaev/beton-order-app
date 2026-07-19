'use client';

import { useState, useEffect } from 'react';
import { Save, Trash2, Share2, Copy, X, User, Phone, Layers, Clock, Calendar, MapPin, MessageSquare, ChevronDown } from 'lucide-react';
import { useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import ModalActionButton from '@/app/adminCifra/components/ModalActionButton';

interface MobileOrderDetailModalProps {
  isOpen: boolean;
  order: any;
  onClose: () => void;
  onUpdate?: (updatedOrder: any) => void;
  onDelete?: (orderId: number) => void;
  onCopyOrder?: (copiedData: any) => void;
  currentRole?: string;
  currentUserName?: string;
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
}: MobileOrderDetailModalProps) {
  const [editedOrder, setEditedOrder] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

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

  useBodyScrollLock(isOpen && !!editedOrder);
  if (!isOpen || !editedOrder) return null;

  const sc = statusCfg(editedOrder.status);
  const isFinal = editedOrder.status === 'completed' || editedOrder.status === 'cancelled';
  const canDelete = currentRole === 'admin';

  const set = (field: string, value: any) => setEditedOrder((p: any) => ({ ...p, [field]: value }));

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/adminCifra/orders/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...editedOrder, userRole: currentRole, userName: currentUserName }),
      });
      if (res.ok) {
        if (onUpdate) onUpdate(editedOrder);
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
          background: '#131C2B',
          borderBottom: '1px solid #1E2937',
          padding: '14px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0, flex: 1 }}>
            <span style={{ fontSize: '18px', fontWeight: 700, color: '#E2E8F0', whiteSpace: 'nowrap' }}>
              Заявка #{editedOrder.id}
            </span>

            {/* Статус — select для активных, пилюля для финальных */}
            {isFinal ? (
              <span style={{
                padding: '5px 12px', borderRadius: '9999px', fontSize: '12px', fontWeight: 700,
                background: `${sc.color}20`, color: sc.color, whiteSpace: 'nowrap',
              }}>
                {sc.label}
              </span>
            ) : (
              <div style={{ position: 'relative' }}>
                <select
                  value={editedOrder.status || 'new'}
                  onChange={e => set('status', e.target.value)}
                  style={{
                    appearance: 'none',
                    padding: '5px 28px 5px 12px',
                    borderRadius: '9999px',
                    border: `1px solid ${sc.color}50`,
                    background: `${sc.color}20`,
                    color: sc.color,
                    fontSize: '12px', fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {STATUS_OPTIONS.map(s => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <ChevronDown size={11} color={sc.color} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
              </div>
            )}
          </div>

          <button onClick={onClose} style={{ background: '#1E2937', border: 'none', borderRadius: '9999px', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
            <X size={16} color="#64748B" />
          </button>
        </div>

        <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>

          {/* ── КЛИЕНТ ──────────────────────────────────── */}
          <div style={{ background: '#131C2B', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <FieldBlock icon={<User size={15} />} label="Клиент">
              <input value={editedOrder.organization_name || editedOrder.full_name || ''} onChange={e => set('organization_name', e.target.value)} style={INPUT} />
            </FieldBlock>
            <FieldBlock icon={<Phone size={15} />} label="Телефон">
              <input value={editedOrder.phone || ''} onChange={e => set('phone', e.target.value)} style={INPUT} type="tel" />
            </FieldBlock>
          </div>

          {/* ── ПАРАМЕТРЫ ЗАКАЗА ─────────────────────── */}
          <div style={{ background: '#131C2B', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <FieldBlock icon={<Layers size={15} />} label="Марка бетона">
              <input value={editedOrder.grade || ''} onChange={e => set('grade', e.target.value)} style={INPUT} />
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
          <div style={{ background: '#131C2B', borderRadius: '16px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <FieldBlock icon={<MapPin size={15} />} label="Адрес доставки">
              <textarea value={editedOrder.address || ''} onChange={e => set('address', e.target.value)} rows={2} style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5 }} />
            </FieldBlock>
            <FieldBlock icon={<MessageSquare size={15} />} label="Комментарий">
              <textarea value={editedOrder.comment || ''} onChange={e => set('comment', e.target.value)} rows={3} style={{ ...INPUT, resize: 'vertical', lineHeight: 1.5 }} />
            </FieldBlock>
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
