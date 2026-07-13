'use client';

import React, { useState, useEffect } from 'react';
import { Order } from '../../adminCifra/hooks/useCalendarOrders';

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
  completeLogistics: (order: Order) => void;
  history: any[];
  addToHistory: (action: string) => Promise<void>;
  getStatusConfig: (status: string) => any;
  setHistory: React.Dispatch<React.SetStateAction<any[]>>;
  setSelectedOrder: React.Dispatch<React.SetStateAction<Order | null>>;
}

export default function MobileOrderDetailModal(props: MobileOrderDetailModalProps) {
  const {
    order,
    onClose,
    mixerAssignments,
    setAllOrders,
    completeLogistics,
    addToHistory,
    history: initialHistory,
    setHistory,
  } = props;

  if (!order) return null;

  const [localOrder, setLocalOrder] = useState(order);
  const [history, setLocalHistory] = useState(initialHistory || []);

  // ==================== ЗАГРУЗКА ИСТОРИИ ====================
  useEffect(() => {
    const loadHistory = async () => {
      if (!order?.id) return;

      try {
        const res = await fetch(`/api/adminCifra/order-history?orderId=${order.id}&_t=${Date.now()}`);
        if (res.ok) {
          const data = await res.json();
          setLocalHistory(data);
          if (setHistory) setHistory(data); // синхронизируем с родителем
        }
      } catch (err) {
        console.error('Ошибка загрузки истории в мобильной модалке:', err);
      }
    };

    loadHistory();
  }, [order?.id, setHistory]);

  useEffect(() => {
    setLocalOrder(order);
  }, [order]);

  const currentMixers = mixerAssignments
    .filter(m => String(m.orderId) === String(order.id))
    .sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'));

  const assignedVolume = currentMixers.reduce((sum, m) => sum + Number(m.volume || 0), 0);
  const orderVolume = Number(order.volume || 0);
  const isFullyReady = assignedVolume >= orderVolume && assignedVolume > 0;

  // ==================== ПРОСТОЙ: ПО РЕЙСАМ И ИТОГО ПО ЗАЯВКЕ ====================
  const totalDowntimeMinutes = currentMixers.reduce((sum, m) => sum + Number(m.downtimeMinutes || 0), 0);

  const formatOnSiteDuration = (mixer: any): string | null => {
    if (!mixer.onSiteAt) return null;
    const endTime = mixer.unloadedAt ? new Date(mixer.unloadedAt) : new Date();
    const minutes = Math.round((endTime.getTime() - new Date(mixer.onSiteAt).getTime()) / 60000);
    if (minutes < 0) return null;
    return `${minutes} мин`;
  };

  const getStatusRussian = (status: string): string => {
    const map: Record<string, string> = {
      'new': 'Новая', 'processing': 'В работе', 'completed': 'Выполнена', 'cancelled': 'Отменена'
    };
    return map[status?.toLowerCase()] || status || '—';
  };

  const getStatusConfigLocal = (status: string) => {
    const s = (status || 'new').toLowerCase();
    if (s === 'completed') return { label: 'Выполнена', bg: '#22C55E', color: '#ffffff', final: true };
    if (s === 'cancelled') return { label: 'Отменена', bg: '#EF4444', color: '#ffffff', final: true };
    if (s === 'processing') return { label: 'В работе', bg: '#3B82F6', color: '#ffffff', final: false };
    return { label: 'Новая', bg: '#F59E0B', color: '#ffffff', final: false };
  };

  const handleOrderStatusChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newStatus = e.target.value;
    if (newStatus === localOrder.status) return;

    const oldStatus = localOrder.status;
    setLocalOrder(prev => ({ ...prev, status: newStatus }));
    setAllOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: newStatus } : o));

    try {
      await fetch('/api/adminCifra/order-logistics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, status: newStatus })
      });
      if (typeof addToHistory === 'function') {
        await addToHistory(`Изменил статус заявки с "${getStatusRussian(oldStatus)}" на "${getStatusRussian(newStatus)}"`);
      }
    } catch (err) {
      console.error(err);
    }
  };

             // ==================== АВТОПОДСТАНОВКА ГОРОДА ====================
    const getFullAddressForRoute = (rawAddress: string): string => {
    if (!rawAddress) return "Брянск";

    const address = rawAddress.trim();

    // Если уже содержит "Брянск" (в любом регистре)
    if (/брянск/i.test(address)) {
      return address;
    }

    // Добавляем префикс
    return `Брянск, ${address}`;
  };

  const openYandexMaps = () => {
    const destination = getFullAddressForRoute(order.address || '');
    window.open(
      `https://yandex.ru/maps/?ll=34.37,53.25&z=12&mode=route&rtext=Брянск,%20Орловский%20тупик,%206А~${encodeURIComponent(destination)}&rtt=auto`, 
      '_blank'
    );
  };

  const openGoogleMaps = () => {
    const destination = getFullAddressForRoute(order.address || '');
    const origin = "Брянск, туп. Орловский, 6А";
    window.open(
      `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&travelmode=driving`, 
      '_blank'
    );
  };

  

  

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.95)',
      zIndex: 100000,
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
        
        {/* 1. ШАПКА МОДАЛКИ */}
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
          <h2 style={{ margin: 0, fontSize: '22px', color: '#ffffff' }}>
            Заявка #{order?.id}
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

        <div style={{ padding: '20px' }}>

          {/* 2. СТАТУС ЗАКАЗА */}
          <div style={{ marginBottom: '28px' }}>
            <label style={{ 
              display: 'block', 
              color: '#94A3B8', 
              fontSize: '14px', 
              marginBottom: '8px' 
            }}>
              Статус заказа
            </label>

            {getStatusConfigLocal(localOrder.status).final ? (
              <div style={{ 
                backgroundColor: getStatusConfigLocal(localOrder.status).bg,
                color: getStatusConfigLocal(localOrder.status).color,
                padding: '14px 20px',
                borderRadius: '9999px',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '10px',
                fontWeight: '600',
                fontSize: '16px',
                width: '35%',
                justifyContent: 'center'
              }}>
                {getStatusConfigLocal(localOrder.status).label}
              </div>
            ) : (
              <select 
                value={localOrder.status || 'new'}
                onChange={handleOrderStatusChange}
                style={{
                  background: '#1E2937',
                  color: 'white',
                  border: '2px solid #475569',
                  borderRadius: '12px',
                  padding: '14px 16px',
                  fontSize: '16px',
                  width: '100%'
                }}
              >
                <option value="new">Новая</option>
                <option value="processing">В работе</option>
                <option value="completed">Выполнена</option>
                <option value="cancelled">Отменена</option>
              </select>
            )}
          </div>

          {/* 3. ИНФОРМАЦИЯ О ЗАКАЗЕ */}
          <div style={{ 
            background: '#25334A', 
            borderRadius: '16px', 
            padding: '20px', 
            marginBottom: '24px',
            color: '#ffffff'
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px 12px', fontSize: '15.5px' }}>
              <div style={{ color: '#94A3B8' }}>Клиент</div>
              <div style={{ fontWeight: '600' }}>{order.organization_name || order.full_name || '—'}</div>

              <div style={{ color: '#94A3B8' }}>Телефон</div>
              <div style={{ fontWeight: '600' }}>{order.phone || '—'}</div>

              <div style={{ color: '#94A3B8' }}>Марка бетона</div>
              <div style={{ fontWeight: '600', color: '#60A5FA' }}>{order.grade || '—'}</div>

              <div style={{ color: '#94A3B8' }}>Объём</div>
              <div style={{ fontSize: '23px', fontWeight: '700', color: '#10B981' }}>{order.volume} м³</div>

              <div style={{ color: '#94A3B8' }}>Дата и время</div>
              <div style={{ fontWeight: '600' }}>{order.delivery_date} • {order.delivery_time}</div>

              <div style={{ color: '#94A3B8' }}>Адрес</div>
              <div style={{ fontWeight: '600', lineHeight: 1.35 }}>{order.address || '—'}</div>
            </div>

            {order.comment && (
              <div style={{ marginTop: '24px' }}>
                <div style={{ color: '#94A3B8', marginBottom: '8px' }}>Комментарий клиента</div>
                <div style={{ 
                  background: '#1E2937', 
                  padding: '16px', 
                  borderRadius: '12px', 
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.5 
                }}>
                  {order.comment}
                </div>
              </div>
            )}
          </div>

          {/* 4. НАЗНАЧЕННЫЕ МИКСЕРЫ */}
          <div style={{ marginBottom: '28px' }}>
            <h3 style={{ color: '#94A3B8', marginBottom: '14px', fontSize: '17px' }}>
              Назначенные миксеры ({currentMixers.length})
            </h3>

            {currentMixers.length > 0 && (
              <div style={{
                marginBottom: '14px',
                padding: '12px 16px',
                borderRadius: '12px',
                background: totalDowntimeMinutes > 0 ? 'rgba(249, 115, 22, 0.12)' : 'rgba(16, 185, 129, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px'
              }}>
                <span style={{ color: '#94A3B8', fontSize: '13.5px' }}>Общий простой по заявке:</span>
                <span style={{ color: totalDowntimeMinutes > 0 ? '#F97316' : '#10B981', fontWeight: '700', fontSize: '16px' }}>{totalDowntimeMinutes} мин</span>
              </div>
            )}
            
            {currentMixers.length > 0 ? (
              currentMixers.map(mixer => {
                const onSiteDuration = formatOnSiteDuration(mixer);
                return (
                  <div key={mixer.id} style={{ 
                    background: '#25334A', 
                    padding: '16px', 
                    borderRadius: '12px', 
                    marginBottom: '12px',
                    color: '#ffffff'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <strong>{mixer.mixerName || mixer.number || 'Миксер'}</strong>
                        <div style={{ fontSize: '14px', color: '#94A3B8' }}>{mixer.time}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: '600' }}>{Number(mixer.volume).toFixed(1)} м³</div>
                        <div style={{ fontSize: '13.5px', color: '#10B981' }}>{mixer.status || 'Загрузка'}</div>
                      </div>
                    </div>

                    <div style={{
                      marginTop: '10px',
                      fontSize: '13px',
                      padding: '6px 10px',
                      borderRadius: '8px',
                      display: 'inline-block',
                      background: Number(mixer.downtimeMinutes) > 0 ? 'rgba(249, 115, 22, 0.15)' : 'rgba(148, 163, 184, 0.15)',
                      color: Number(mixer.downtimeMinutes) > 0 ? '#F97316' : '#94A3B8'
                    }}>
                      ⏱ {onSiteDuration || '0 мин'}
                      {mixer.status === 'Разгружен' && ` (простой ${Number(mixer.downtimeMinutes || 0)} мин)`}
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ 
                background: '#25334A', 
                padding: '50px 20px', 
                borderRadius: '12px', 
                textAlign: 'center',
                color: '#94A3B8'
              }}>
                Пока нет назначенных миксеров
              </div>
            )}
          </div>

         {/* 5. КАРТЫ (с автоподстановкой города) */}
          <div style={{ marginBottom: '28px' }}>
            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={openYandexMaps}
                style={{ 
                  flex: 1, 
                  padding: '16px', 
                  background: '#3B82F6', 
                  color: '#ffffff', 
                  border: 'none', 
                  borderRadius: '12px', 
                  fontSize: '16px',
                  fontWeight: '600'
                }}
              >
                🗺️ Яндекс.Карты
              </button>
              <button 
                onClick={openGoogleMaps}
                style={{ 
                  flex: 1, 
                  padding: '16px', 
                  background: '#10B981', 
                  color: '#ffffff', 
                  border: 'none', 
                  borderRadius: '12px', 
                  fontSize: '16px',
                  fontWeight: '600'
                }}
              >
                🗺️ Google Maps
              </button>
            </div>
          </div>

        {/* 6. ИСТОРИЯ ИЗМЕНЕНИЙ */}
          <div>
            <h3 style={{ color: '#94A3B8', marginBottom: '14px', fontSize: '17px' }}>История изменений</h3>
            
            <div style={{ 
              background: '#25334A', 
              borderRadius: '16px', 
              padding: '20px', 
              maxHeight: '320px',
              overflowY: 'auto'
            }}>
              {history.length > 0 ? (
                history.map((entry: any, index: number) => {
                  const time = new Date(entry.created_at).toLocaleString('ru-RU', { 
                    hour: '2-digit', 
                    minute: '2-digit',
                    day: '2-digit',
                    month: '2-digit'
                  });

                  const userName = entry.user_name || 'Сотрудник';
                  const userRole = entry.user_role ? ` (${entry.user_role})` : '';

                  // Исправляем английские статусы на русские
                  let actionText = entry.action || '';
                  actionText = actionText
                    .replace('processing', 'В работе')
                    .replace('completed', 'Выполнена')
                    .replace('new', 'Новая')
                    .replace('cancelled', 'Отменена');

                  return (
                    <div key={index} style={{ 
                      paddingBottom: '14px', 
                      marginBottom: '14px',
                      borderBottom: index !== history.length - 1 ? '1px solid #334155' : 'none'
                    }}>
                      <div style={{ color: '#64748B', fontSize: '13px', marginBottom: '6px' }}>
                        {time}
                      </div>
                      
                      <div style={{ fontWeight: '600', color: '#CBD5E1' }}>
                        {userName}{userRole}
                      </div>
                      
                      <div style={{ marginTop: '4px', color: '#E2E8F0', lineHeight: '1.45' }}>
                        {actionText}
                      </div>
                    </div>
                  );
                })
              ) : (
                <div style={{ color: '#94A3B8', textAlign: 'center', padding: '40px 0' }}>
                  История пока пуста
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}