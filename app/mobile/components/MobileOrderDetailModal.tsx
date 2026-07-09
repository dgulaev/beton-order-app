'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabaseClient';

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

  // ==================== 1. СОСТОЯНИЯ ====================
  const [editedOrder, setEditedOrder] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);

    // ==================== REALTIME ОБНОВЛЕНИЕ В МОДАЛКЕ ====================
  useEffect(() => {
    if (!isOpen || !order?.id) return;

    const channel = supabase
      .channel(`modal-order-${order.id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${order.id}`
        },
        (payload) => {
          console.log('🔄 Обновление в открытой модалке!', payload.new);
          setEditedOrder({ ...payload.new });
          
          // Опционально: уведомление внутри модалки
          // alert('Данные заявки обновлены!');
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [isOpen, order?.id]);

  // ==================== 2. СИНХРОНИЗАЦИЯ ДАННЫХ ====================
  useEffect(() => {
    if (order) {
      setEditedOrder({ ...order });
    } else {
      setEditedOrder(null);
    }
  }, [order]);

  // ==================== 3. ЗАЩИТА ОТ NULL ====================
  if (!isOpen || !editedOrder) return null;

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'new': return { label: 'Новая', color: '#FACC15' };
      case 'processing': return { label: 'В работе', color: '#3B82F6' };
      case 'completed': return { label: 'Выполнена', color: '#10B981' };
      case 'cancelled': return { label: 'Отменена', color: '#EF4444' };
      default: return { label: status || 'Неизвестно', color: '#94A3B8' };
    }
  };

  const statusConfig = getStatusConfig(editedOrder.status);

  // ==================== 4. ПРОВЕРКА ПРАВ ====================
  const canEdit = currentRole === 'admin' || currentRole === 'manager' || currentRole === 'dispatcher';
  const canDelete = currentRole === 'admin';

  // ==================== 4. СОХРАНЕНИЕ ====================
  const handleSave = async () => {
    setIsSaving(true);
    try {
      const res = await fetch('/api/adminCifra/orders/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...editedOrder,
          userRole: currentRole,
          userName: currentUserName,
        }),
      });

      if (res.ok) {
        alert('✅ Изменения сохранены');
        if (onUpdate) onUpdate(editedOrder);
        onClose();
      } else {
        alert('Ошибка сохранения');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка соединения');
    } finally {
      setIsSaving(false);
    }
  };

    // ==================== 5. КОПИРОВАТЬ ЗАЯВКУ ====================
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

    // Закрываем текущую модалку
    onClose();

    // Передаём данные
    if (onCopyOrder) {
      onCopyOrder(copiedData);
    } else {
      console.warn('onCopyOrder callback не передан');
    }
  };

   // ==================== 6. ПОДЕЛИТЬСЯ ====================
  const handleShare = () => {
    const orderId = editedOrder.id || editedOrder.order_number || '—';
    
    const text = `Заявка #${orderId}
Клиент: ${editedOrder.organization_name || editedOrder.full_name || '—'}
Телефон: ${editedOrder.phone || '—'}
Объём: ${editedOrder.volume} м³ ${editedOrder.grade || ''}
Дата: ${editedOrder.delivery_date || editedOrder.deliveryDate || '—'}
Время: ${editedOrder.delivery_time || editedOrder.deliveryTime || '—'}
Адрес: ${editedOrder.address || '—'}
${editedOrder.comment ? `\nКомментарий: ${editedOrder.comment}` : ''}`;

    if (navigator.share) {
      navigator.share({
        title: `Заявка #${orderId}`,
        text: text.replace(`Заявка #${orderId}\n`, ''), // убираем дублирование в share
      }).catch(() => {
        navigator.clipboard.writeText(text);
      });
    } else {
      navigator.clipboard.writeText(text);
    }
  };

   // ==================== 7. РЕНДЕР ====================
  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.95)',
      zIndex: 10000,
      overflowY: 'auto',
      WebkitOverflowScrolling: 'touch'
    }} onClick={onClose}>
      
      <div 
        style={{
          backgroundColor: '#1E2937',
          minHeight: '100vh',
          maxWidth: '560px',
          margin: '0 auto',
          paddingBottom: '100px'
        }}
        onClick={e => e.stopPropagation()}
      >
        
        {/* ШАПКА */}
        <div style={{ 
          padding: '18px 20px', 
          borderBottom: '1px solid #334155',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          position: 'sticky',
          top: 0,
          backgroundColor: '#1E2937',
          zIndex: 10
        }}>
          <h2 style={{ margin: 0, fontSize: '23px', fontWeight: '700', color: '#ffffff' }}>
            Заявка #{editedOrder.id}
          </h2>
          <button 
            onClick={onClose} 
            style={{ 
              fontSize: '34px', 
              background: 'none', 
              border: 'none', 
              color: '#94A3B8',
              padding: 0,
              lineHeight: 1
            }}
          >
            ×
          </button>
        </div>

        <div style={{ padding: '10px' }}>

          {/* СТАТУС */}
          <div style={{ marginBottom: '28px' }}>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
              Статус заказа
            </label>
            <div style={{
              padding: '14px 20px',
              background: '#25334A',
              borderRadius: '9999px',
              display: 'inline-flex',
              alignItems: 'center',
              fontWeight: '600',
              fontSize: '17px',
              color: statusConfig.color
            }}>
              {statusConfig.label}
            </div>
          </div>

          {/* ФОРМА */}
          <div style={{ 
            background: '#25334A', 
            borderRadius: '16px', 
            padding: '16px', 
            marginBottom: '24px',
            color: '#ffffff'
          }}>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

              <div>
                <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Клиент</div>
                <input 
                  value={editedOrder.organization_name || editedOrder.full_name || ''} 
                  onChange={(e) => setEditedOrder({ ...editedOrder, organization_name: e.target.value })}
                  style={{ width: '94%', padding: '14px', background: '#1E2937', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' }}
                />
              </div>

              <div>
                <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Телефон</div>
                <input 
                  value={editedOrder.phone || ''} 
                  onChange={(e) => setEditedOrder({ ...editedOrder, phone: e.target.value })}
                  style={{ width: '94%', padding: '14px', background: '#1E2937', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' }}
                />
              </div>

              <div>
                <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Марка бетона</div>
                <input 
                  value={editedOrder.grade || ''} 
                  onChange={(e) => setEditedOrder({ ...editedOrder, grade: e.target.value })}
                  style={{ width: '94%', padding: '14px', background: '#1E2937', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' }}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                <div>
                  <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Объём</div>
                  <input 
                    type="number" step="0.01"
                    value={editedOrder.volume || ''} 
                    onChange={(e) => setEditedOrder({ ...editedOrder, volume: e.target.value })}
                    style={{ width: '85%', padding: '14px', background: '#1E2937', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' }}
                  />
                </div>
                <div>
                  <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Время</div>
                  <input 
                    type="time"
                    value={editedOrder.delivery_time || ''} 
                    onChange={(e) => setEditedOrder({ ...editedOrder, delivery_time: e.target.value })}
                    style={{ width: '86%', padding: '14px', background: '#1E2937', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' }}
                  />
                </div>
              </div>

              <div>
                <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Дата доставки</div>
                <input 
                  type="date"
                  value={editedOrder.delivery_date || ''} 
                  onChange={(e) => setEditedOrder({ ...editedOrder, delivery_date: e.target.value })}
                  style={{ width: '93%', padding: '14px', background: '#1E2937', border: 'none', borderRadius: '12px', color: '#fff', fontSize: '16px' }}
                />
              </div>

              <div>
                <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Адрес доставки</div>
                <textarea 
                  value={editedOrder.address || ''} 
                  onChange={(e) => setEditedOrder({ ...editedOrder, address: e.target.value })}
                  rows={3}
                  style={{ width: '87%', padding: '24px', background: '#1E2937', border: 'none', borderRadius: '12px', color: '#fff', resize: 'vertical' }}
                />
              </div>

              <div>
                <div style={{ color: '#94A3B8', marginBottom: '6px', fontSize: '14px' }}>Комментарий клиента</div>
                <textarea 
                  value={editedOrder.comment || ''} 
                  onChange={(e) => setEditedOrder({ ...editedOrder, comment: e.target.value })}
                  rows={5}
                  style={{ 
                    width: '92%', 
                    padding: '16px', 
                    background: '#1E2937', 
                    border: 'none', 
                    borderRadius: '12px', 
                    color: '#fff',
                    fontSize: '15.5px',
                    lineHeight: 1.5 
                  }}
                />
              </div>

            </div>
          </div>

          {/* КНОПКИ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={handleSave}
                disabled={isSaving}
                style={{ flex: 1, padding: '16px', background: '#10B981', color: 'white', border: 'none', borderRadius: '14px', fontSize: '16px', fontWeight: '600' }}
              >
                💾 Сохранить изменения
              </button>
              {canDelete && (
                <button 
                  onClick={() => onDelete && onDelete(editedOrder.id)}
                  style={{ flex: 1, padding: '16px', background: '#EF4444', color: 'white', border: 'none', borderRadius: '14px', fontSize: '16px', fontWeight: '600' }}
                >
                  🗑️ Удалить
                </button>
              )}
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button onClick={handleShare} style={{ flex: 1, padding: '16px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '14px', fontSize: '16px', fontWeight: '600' }}>
                🔗 Поделиться
              </button>
              <button onClick={handleCopyOrder} style={{ flex: 1, padding: '16px', background: '#8B5CF6', color: 'white', border: 'none', borderRadius: '14px', fontSize: '16px', fontWeight: '600' }}>
                📋 Копировать
              </button>
            </div>

            <button onClick={onClose} style={{ padding: '16px', background: '#475569', color: 'white', border: 'none', borderRadius: '14px', fontSize: '16px' }}>
              Отмена
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}