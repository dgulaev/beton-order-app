'use client';

import { useState, useEffect } from 'react';
import { X, Phone, Plus, Package } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import MobileNewOrderModal from './MobileNewOrderModal';

// ==================== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ====================

function statusLabel(status: string): string {
  switch (status) {
    case 'new': return 'Новая';
    case 'processing': return 'В работе';
    case 'completed': return 'Выполнена';
    case 'cancelled': return 'Отменена';
    default: return status;
  }
}

function statusColor(status: string): string {
  switch (status) {
    case 'new': return '#FACC15';
    case 'processing': return '#3B82F6';
    case 'completed': return '#10B981';
    case 'cancelled': return '#EF4444';
    default: return '#94A3B8';
  }
}

function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '—';
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 11) {
    return `+7 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9, 11)}`;
  }
  return raw;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// ==================== ИНТЕРФЕЙС ====================

interface MobileClientDetailModalProps {
  profile: any | null;
  currentRole?: string;
  currentUserName?: string;
  onClose: () => void;
}

// ==================== КОМПОНЕНТ ====================

export default function MobileClientDetailModal({
  profile,
  currentRole = 'manager',
  currentUserName = 'Сотрудник',
  onClose,
}: MobileClientDetailModalProps) {
  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(false);
  const [showNewOrder, setShowNewOrder] = useState(false);

  useBodyScrollLock(!!profile);

  // Загрузка заказов клиента
  useEffect(() => {
    if (!profile) { setOrders([]); return; }
    const userId = profile.clients?.[0]?.user_id;
    if (!userId) return;

    setOrdersLoading(true);
    fetch(`/api/adminCifra/client-orders?userId=${userId}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setOrders(Array.isArray(data) ? data : (data.orders || [])))
      .catch(() => setOrders([]))
      .finally(() => setOrdersLoading(false));
  }, [profile]);

  if (!profile) return null;

  const phone = profile.phones?.[0] || profile.clients?.[0]?.phone || null;
  const address = profile.clients?.map((c: any) => c.address).find(Boolean) || null;
  const inn = profile.inn || null;
  const totalVolume = Number(profile.total_volume || 0);
  const totalOrders = Number(profile.total_orders || orders.length || 0);
  const curator = profile.curator_name || '—';
  const displayName = profile.organization_name || profile.full_name || 'Клиент';

  // Префилл для "Новый заказ"
  const isLegal = !!(profile.organization_name || inn);
  const newOrderData = {
    customerType: isLegal ? 'legal' : 'physical',
    organizationName: profile.organization_name || '',
    fullName: profile.full_name || '',
    phone: phone || '',
    address: address || '',
    inn: inn || '',
  };

  return (
    <>
      {/* Оверлей */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 10000 }}
        onClick={onClose}
      />

      {/* Панель снизу */}
      <div style={{
        position: 'fixed',
        bottom: '74px',
        left: 0,
        right: 0,
        zIndex: 10001,
        background: '#131C2B',
        borderRadius: '20px 20px 0 0',
        maxHeight: 'calc(90vh - 74px)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}>

        {/* Шапка */}
        <div style={{ padding: '20px 20px 0', flexShrink: 0 }}>
          {/* Ручка */}
          <div style={{ width: '40px', height: '4px', background: '#334155', borderRadius: '9999px', margin: '0 auto 16px' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '20px', fontWeight: '700', color: '#fff', lineHeight: 1.2, wordBreak: 'break-word' }}>
                {displayName}
              </div>
              {inn && <div style={{ fontSize: '13px', color: '#64748B', marginTop: '4px' }}>ИНН {inn}</div>}
            </div>
            <button
              onClick={onClose}
              style={{ background: '#1E2937', border: 'none', borderRadius: '9999px', width: '36px', height: '36px', minWidth: '36px', color: '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}
            >
              <X size={18} />
            </button>
          </div>

          {/* Статистика */}
          <div style={{ display: 'flex', gap: '10px', marginTop: '16px', marginBottom: '16px' }}>
            <StatChip label="Заказов" value={totalOrders} />
            <StatChip label="Объём" value={`${totalVolume} м³`} />
            <StatChip label="Куратор" value={curator} small />
          </div>

          {/* Кнопки действий */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
            {phone && (
              <a
                href={`tel:${phone}`}
                style={{
                  flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                  padding: '14px', background: 'transparent', border: '1px solid #10B98140',
                  borderRadius: '14px', color: '#10B981', fontSize: '15px', fontWeight: '600',
                  textDecoration: 'none',
                }}
              >
                <Phone size={16} />
                {formatPhone(phone)}
              </a>
            )}
            <button
              onClick={() => setShowNewOrder(true)}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                padding: '14px', background: '#3B82F620', border: '1px solid #3B82F640',
                borderRadius: '14px', color: '#60A5FA', fontSize: '15px', fontWeight: '600', cursor: 'pointer',
              }}
            >
              <Plus size={16} />
              Новый заказ
            </button>
          </div>

          {/* Адрес */}
          {address && (
            <div style={{ padding: '12px', background: '#1E2937', borderRadius: '12px', marginBottom: '16px', fontSize: '14px', color: '#94A3B8' }}>
              📍 {address}
            </div>
          )}

          <div style={{ height: '1px', background: '#1E2937', marginBottom: '12px' }} />
        </div>

        {/* Список заказов — скроллится */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px 32px' }}>
          <div style={{ fontSize: '14px', fontWeight: '600', color: '#64748B', marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            История заказов
          </div>

          {ordersLoading && (
            <div style={{ textAlign: 'center', padding: '24px', color: '#475569' }}>Загрузка...</div>
          )}

          {!ordersLoading && orders.length === 0 && (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <Package size={36} style={{ color: '#334155', marginBottom: '8px' }} />
              <div style={{ color: '#475569', fontSize: '14px' }}>Заказов пока нет</div>
            </div>
          )}

          {!ordersLoading && orders.map((order: any) => {
            const sc = statusColor(order.status);
            const date = formatDate(order.delivery_date || order.created_at);
            const vol = Number(order.volume || 0);
            const amount = Number(order.total_amount || order.amount || 0);
            return (
              <div key={order.id} style={{
                background: '#1E2937',
                borderRadius: '14px',
                padding: '14px',
                marginBottom: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '14px', fontWeight: '600', color: '#E2E8F0' }}>#{order.id}</span>
                    <span style={{ fontSize: '13px', color: '#64748B' }}>{date}</span>
                  </div>
                  {order.address && (
                    <div style={{ fontSize: '13px', color: '#94A3B8', marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {order.address}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: '12px', marginTop: '6px', fontSize: '13px', color: '#64748B' }}>
                    {vol > 0 && <span>{vol} м³</span>}
                    {amount > 0 && <span>{amount.toLocaleString()} ₽</span>}
                  </div>
                </div>
                <div style={{
                  padding: '4px 10px',
                  background: sc + '20',
                  borderRadius: '9999px',
                  color: sc,
                  fontSize: '12px',
                  fontWeight: '600',
                  flexShrink: 0,
                }}>
                  {statusLabel(order.status)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Модалка нового заказа */}
      {showNewOrder && (
        <MobileNewOrderModal
          isOpen={showNewOrder}
          onClose={() => setShowNewOrder(false)}
          onSuccess={() => { setShowNewOrder(false); }}
          currentRole={currentRole}
          currentUserName={currentUserName}
          initialData={newOrderData}
        />
      )}
    </>
  );
}

// ==================== МЕЛКИЙ ХЕЛПЕР ====================

function StatChip({ label, value, small }: { label: string; value: string | number; small?: boolean }) {
  return (
    <div style={{ flex: 1, background: '#1E2937', borderRadius: '12px', padding: '10px 12px', minWidth: 0 }}>
      <div style={{ fontSize: '11px', color: '#64748B', marginBottom: '3px' }}>{label}</div>
      <div style={{
        fontSize: small ? '12px' : '16px',
        fontWeight: '700',
        color: '#E2E8F0',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}>{value}</div>
    </div>
  );
}
