'use client';

import React, { useState, useEffect } from 'react';
import { Order } from '../hooks/useCalendarOrders';

interface OrderDetailModalProps {
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

// ==================== ПЕРЕВОД РОЛЕЙ ДЛЯ ОТОБРАЖЕНИЯ В ИСТОРИИ ====================
const getRoleDisplayName = (role: string): string => {
  switch (role) {
    case 'admin': return 'Админ';
    case 'manager': return 'Менеджер';
    case 'dispatcher': return 'Диспетчер';
    case 'logist': return 'Логист';
    case 'logistic': return 'Логист';
    case 'operator': return 'Оператор';
    case 'accountant': return 'Бухгалтер';
    case 'driver': return 'Водитель';
    default: return role;
  }
};

export default function OrderDetailModal({
  order,
  onClose,
  mixerAssignments,
  setMixerAssignments,
  allOrders,
  setAllOrders,
  allMixers,
  currentUser,
  handleStatusChange,
  deleteMixer,
  completeLogistics,
  history,           
  addToHistory,
  getStatusConfig,
  setHistory,  
  setSelectedOrder,    
}: OrderDetailModalProps) {

  if (!order) return null;

    // ==================== 0. ЗАГРУЗКА МИКСЕРОВ ДЛЯ МОДАЛКИ ====================
const loadData = async () => {
  if (!order?.id) {
    setMixerAssignments([]);
    setHistory([]);
    return;
  }

  try {
    const timestamp = Date.now();
    const res = await fetch(`/api/adminCifra/order-mixers?orderId=${order.id}&_t=${timestamp}`, {
      cache: 'no-store',
      headers: { 
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache'
      }
    });

    if (res.ok) {
      let data = await res.json();
      const sorted = [...data].sort((a, b) => 
        (a.time || '00:00').localeCompare(b.time || '00:00')
      );
      setMixerAssignments(sorted);
    }

    // История
    const histRes = await fetch(`/api/adminCifra/order-history?orderId=${order.id}&_t=${timestamp}`);
    if (histRes.ok) {
      setHistory(await histRes.json());
    }
  } catch (err) {
    console.error('Ошибка загрузки данных модалки:', err);
  }
};

  // ==================== 1. ЛОКАЛЬНОЕ СОСТОЯНИЕ ЗАКАЗА ====================
  const [localOrder, setLocalOrder] = useState(order);

  // Синхронизация при смене заказа
  useEffect(() => {
    setLocalOrder(order);
  }, [order]);

  // ==================== 2. HELPER ДЛЯ ОПРЕДЕЛЕНИЯ РОЛИ ====================
  const getCurrentRole = () => {
    return currentUser?.role?.toLowerCase().trim() || 'unknown';
  };

  const getCurrentUserName = () => {
    return currentUser?.name || 
           (getCurrentRole() === 'admin' ? 'Администратор' :
            getCurrentRole() === 'manager' ? 'Менеджер' :
            getCurrentRole() === 'dispatcher' ? 'Диспетчер' :
            getCurrentRole() === 'logist' ? 'Логист' : 'Пользователь');
  };

  // ==================== 3. ФУНКЦИИ СМЕНЫ ОЧЕРЕДИ ====================
const moveMixerUp = async (mixerId: number) => {
  const mixer = mixerAssignments.find(m => m.id === mixerId);
  const mixerName = mixer?.mixerName || mixer?.number || mixer?.mixer_name || 'Миксер';

  setMixerAssignments(prev => {
    const newList = [...prev];
    const index = newList.findIndex(m => m.id === mixerId);
    if (index <= 0) return prev;

    [newList[index], newList[index - 1]] = [newList[index - 1], newList[index]];

    newList.forEach((m, i) => {
      if (String(m.orderId) === String(order.id)) m.sortOrder = i;
    });

    return newList;
  });

  await saveSortOrderToDB();
};

const moveMixerDown = async (mixerId: number) => {
  const mixer = mixerAssignments.find(m => m.id === mixerId);
  const mixerName = mixer?.mixerName || mixer?.number || mixer?.mixer_name || 'Миксер';

  setMixerAssignments(prev => {
    const newList = [...prev];
    const index = newList.findIndex(m => m.id === mixerId);
    if (index === -1 || index === newList.length - 1) return prev;

    [newList[index], newList[index + 1]] = [newList[index + 1], newList[index]];

    newList.forEach((m, i) => {
      if (String(m.orderId) === String(order.id)) m.sortOrder = i;
    });

    return newList;
  });

  await saveSortOrderToDB();
};

// ==================== 4. СОХРАНЕНИЕ ПОРЯДКА В БАЗУ (улучшенная версия) ====================
const saveSortOrderToDB = async () => {
  const currentMixers = mixerAssignments
    .filter(m => String(m.orderId) === String(order.id))
    .sort((a, b) => (b.sortOrder || 0) - (a.sortOrder || 0));

  console.log('💾 Сохраняем порядок:', currentMixers.map(m => ({id: m.id, sortOrder: m.sortOrder})));

  for (let i = 0; i < currentMixers.length; i++) {
    const mixer = currentMixers[i];
    if (!mixer.id) continue;

    const res = await fetch('/api/adminCifra/order-mixers/sort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: mixer.id,
        sortOrder: i
      })
    });

    const data = await res.json();
    console.log(`   → Миксер ${mixer.id} → sortOrder=${i} | success: ${data.success}`);
  }
};

  // ==================== 5. ОБНОВЛЕНИЕ СТАТУСА МИКСЕРА ====================
  // Запись в историю и авто-смена статуса заявки (Рейд 2: В работе → Выполнена)
  // теперь выполняются централизованно на сервере в /api/adminCifra/order-mixers/status,
  // чтобы поведение было одинаковым для всех источников (модалка, сайдбар, оператор).
const handleStatusChangeLocal = async (mixerId: number, newStatus: string) => {
  const oldMixer = mixerAssignments.find(m => m.id === mixerId);
  const oldStatus = oldMixer?.status || 'Загрузка';

  if (oldStatus === newStatus) return;

  // Оптимистическое обновление
  setMixerAssignments(prev =>
    prev.map(m => m.id === mixerId ? { ...m, status: newStatus } : m)
  );

  try {
    const res = await fetch('/api/adminCifra/order-mixers/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: mixerId,
        status: newStatus,
        userName: getCurrentUserName(),
        userRole: getCurrentRole()
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.message || 'Не удалось изменить статус миксера');
    }

    // Подтягиваем фактическое время на объекте / простой, посчитанные сервером
    if (data.data) {
      setMixerAssignments(prev =>
        prev.map(m => m.id === mixerId ? {
          ...m,
          onSiteAt: data.data.onSiteAt ?? m.onSiteAt,
          unloadedAt: data.data.unloadedAt ?? m.unloadedAt,
          downtimeMinutes: data.data.downtimeMinutes ?? m.downtimeMinutes,
        } : m)
      );
    }

    // Обновляем историю сразу — сервер уже записал нужные записи
    if (typeof setHistory === 'function' && order?.id) {
      const histRes = await fetch(`/api/adminCifra/order-history?orderId=${order.id}&_t=${Date.now()}`);
      if (histRes.ok) setHistory(await histRes.json());
    }

  } catch (err: any) {
    console.error('Ошибка обновления статуса миксера:', err);

    // Откат
    setMixerAssignments(prev =>
      prev.map(m => m.id === mixerId ? { ...m, status: oldStatus } : m)
    );
    alert(err.message || 'Не удалось изменить статус миксера.');
  }
};

  // ==================== 6.1 ПОЛУЧЕНИЕ МИКСЕРОВ ТЕКУЩЕГО ЗАКАЗА (новые внизу) ====================
const currentMixers = mixerAssignments
  .filter(m => String(m.orderId) === String(order.id))
  .sort((a, b) => {
    const timeA = new Date(a.updated_at || a.created_at).getTime();
    const timeB = new Date(b.updated_at || b.created_at).getTime();
    return timeA - timeB;   // ← новые внизу
  });

// ==================== 6.2 ПРОСТОЙ: ПО РЕЙСАМ И ИТОГО ПО ЗАЯВКЕ ====================
const totalDowntimeMinutes = currentMixers.reduce((sum, m) => sum + Number(m.downtimeMinutes || 0), 0);

const formatOnSiteDuration = (mixer: any): string | null => {
  if (!mixer.onSiteAt) return null;
  const endTime = mixer.unloadedAt ? new Date(mixer.unloadedAt) : new Date();
  const minutes = Math.round((endTime.getTime() - new Date(mixer.onSiteAt).getTime()) / 60000);
  if (minutes < 0) return null;
  return `${minutes} мин`;
};

  // ==================== 7. ИЗМЕНЕНИЕ ВРЕМЕНИ ЗАГРУЗКИ ====================
const handleMixerTimeChange = async (mixerId: number, newTime: string) => {
  // Оптимистическое обновление
  setMixerAssignments(prev =>
    prev.map(item =>
      item.id === mixerId ? { ...item, time: newTime } : item
    )
  );

  try {
    const res = await fetch('/api/adminCifra/order-mixers/time', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: mixerId, time: newTime })
    });

    const data = await res.json();

    if (data.success) {
      // Небольшая задержка перед перезагрузкой данных
      setTimeout(() => loadData(), 400);
    }
  } catch (err) {
    console.error('Ошибка сохранения времени:', err);
  }
};

// Форматирование объёма без лишних нулей
const formatVolume = (value: number | string) => {
  const num = Number(value);
  if (isNaN(num)) return '0';
  
  return num.toFixed(2).replace(/\.?0+$/, '');
};



  return (
  <div 
    style={{ 
      position: 'fixed', 
      inset: 0, 
      background: 'rgba(0,0,0,0.94)', 
      zIndex: 9999, 
      display: 'flex', 
      alignItems: 'center', 
      justifyContent: 'center' 
    }} 
    onClick={onClose}
  >
    <div 
  style={{ 
    background: '#1E2937', 
    width: '1300px', 
    borderRadius: '24px', 
    padding: '32px', 
    height: '1300px',                    // ← Фиксированная высота в пикселях
    maxHeight: '1400px',                 // ← Ограничиваем
    overflow: 'auto',                   // ← Скролл если контент не помещается
    boxShadow: '0 30px 80px rgba(0,0,0,0.7)',
    margin: '40px auto'
  }}
        onClick={e => e.stopPropagation()}
      >
        {/* ==================== HEADER ==================== */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <h2 style={{ margin: 0, fontSize: '28px' }}>
            Заявка #{order.id}
          </h2>
          <button 
            onClick={onClose} 
            style={{ fontSize: '42px', background: 'none', border: 'none', color: '#94A3B8', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>

       {/* ==================== СТАТУС ЗАКАЗА ==================== */}
<div style={{ marginBottom: '28px' }}>
  <label style={{ display: 'block', color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
    Статус заказа
  </label>

  {getStatusConfig(localOrder.status).final ? (
    // ==================== ФИНАЛЬНЫЕ СТАТУСЫ (нельзя менять) ====================
    <div style={{ 
      backgroundColor: getStatusConfig(localOrder.status).bg,
      color: getStatusConfig(localOrder.status).color,
      padding: '12px 26px',
      borderRadius: '9999px',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      fontWeight: '600',
      fontSize: '16px'
    }}>
      {getStatusConfig(localOrder.status).label} — конечный статус
    </div>
  ) : (
    // Можно менять (только если не финальный статус)
    <select 
  value={localOrder.status || 'new'}
  onChange={async (e) => {
    const newStatus = e.target.value;
    if (newStatus === localOrder.status) return;

    const oldStatus = localOrder.status;

    // Локальное обновление
    setLocalOrder(prev => ({ ...prev, status: newStatus }));
    setAllOrders(prev => prev.map(o => 
      o.id === order.id ? { ...o, status: newStatus } : o
    ));

    try {
      // Ручная смена статуса всегда идёт через /orders/update — там же
      // защита финальных статусов и запись истории с реальной ролью.
      const res = await fetch('/api/adminCifra/orders/update', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: order.id,
          status: newStatus,
          userName: getCurrentUserName(),
          userRole: getCurrentRole()
        })
      });

      const data = await res.json();

      if (data.success) {
        if (typeof setHistory === 'function') {
          const histRes = await fetch(`/api/adminCifra/order-history?orderId=${order.id}&_t=${Date.now()}`);
          if (histRes.ok) setHistory(await histRes.json());
        }
      } else {
        // Откат
        setLocalOrder(prev => ({ ...prev, status: oldStatus }));
        setAllOrders(prev => prev.map(o => 
          o.id === order.id ? { ...o, status: oldStatus } : o
        ));
        alert('Ошибка сохранения: ' + (data.message || ''));
      }
    } catch (err) {
      console.error(err);
      // Откат
      setLocalOrder(prev => ({ ...prev, status: oldStatus }));
      setAllOrders(prev => prev.map(o => 
        o.id === order.id ? { ...o, status: oldStatus } : o
      ));
      alert('Не удалось связаться с сервером');
    }
  }}
  style={{
    background: '#1E2937',
    color: 'white',
    border: '2px solid #475569',
    borderRadius: '12px',
    padding: '12px 16px',
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


        {/* ==================== GRID 1fr 1fr ==================== */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px' }}>
          
          {/* ==================== ЛЕВАЯ КОЛОНКА — ИНФОРМАЦИЯ ==================== */}
          <div>
            <h3 style={{ marginBottom: '18px', color: '#94A3B8' }}>Информация о заказе</h3>
            
            <div style={{ background: '#25334A', borderRadius: '16px', padding: '24px', lineHeight: '2' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '12px' }}>
                <div style={{ color: '#94A3B8' }}>Клиент</div>
                <div style={{ fontWeight: '600' }}>{(order as any).organization_name || (order as any).full_name || '—'}</div>

                <div style={{ color: '#94A3B8' }}>Телефон</div>
                <div>{order.phone || '—'}</div>

                <div style={{ color: '#94A3B8' }}>Марка бетона</div>
                <div style={{ fontWeight: '600', color: '#60A5FA' }}>{order.grade}</div>

                <div style={{ color: '#94A3B8' }}>Объём</div>
                <div style={{ fontSize: '24px', fontWeight: '700', color: '#10B981' }}>{order.volume} м³</div>

                <div style={{ color: '#94A3B8' }}>Дата и время</div>
                <div>{order.delivery_date} • {order.delivery_time}</div>

                <div style={{ color: '#94A3B8' }}>Адрес доставки</div>
                <div style={{ fontWeight: '600', fontSize: '17px' }}>{order.address}</div>
              </div>
            </div>

            {order.comment && (
              <div style={{ marginTop: '24px' }}>
                <h4 style={{ color: '#94A3B8', marginBottom: '8px' }}>Комментарий клиента</h4>
                <div style={{ background: '#25334A', padding: '20px', borderRadius: '16px', whiteSpace: 'pre-wrap' }}>
                  {order.comment}
                </div>
              </div>
            )}
          </div>

                    {/* ==================== ПРАВАЯ КОЛОНКА — ЛОГИСТИКА ==================== */}
          <div>
            <h3 style={{ marginBottom: '20px', color: '#94A3B8' }}>Выстраивание логистики</h3>
            
            {(() => {
              const assignedVolume = mixerAssignments
                .filter(m => m.orderId === order.id)
                .reduce((sum, m) => sum + Number(m.volume || 0), 0);

              const orderVolume = Number(order.volume || 0);
              const isFullyReady = assignedVolume >= orderVolume && assignedVolume > 0;

              return (
                <div style={{ background: '#25334A', borderRadius: '16px', padding: '24px' }}>
                  {/* Сумма по миксерам */}
<div style={{ 
  background: '#1E2937', 
  borderRadius: '12px', 
  padding: '16px', 
  textAlign: 'center',
  marginBottom: '24px'
}}>
  <div style={{ color: '#94A3B8', fontSize: '14px' }}>Назначено бетона</div>
  <div style={{ fontSize: '32px', fontWeight: '700', color: '#10B981', margin: '8px 0' }}>
    {formatVolume(assignedVolume)} / {formatVolume(orderVolume)} м³
  </div>
  <div style={{ fontSize: '14px', color: isFullyReady ? '#10B981' : '#F59E0B' }}>
    {isFullyReady 
      ? '✅ Полностью укомплектовано' 
      : `Осталось ${formatVolume(orderVolume - assignedVolume)} м³`
    }
  </div>

  <div style={{
    marginTop: '14px',
    paddingTop: '14px',
    borderTop: '1px solid #334155',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px'
  }}>
    <span style={{ color: '#94A3B8', fontSize: '13.5px' }}>Общий простой по заявке:</span>
    <span style={{ color: totalDowntimeMinutes > 0 ? '#F97316' : '#10B981', fontWeight: '700', fontSize: '16px' }}>{totalDowntimeMinutes} мин</span>
  </div>
</div>

                  {/* ==================== СПИСОК НАЗНАЧЕННЫХ МИКСЕРОВ ==================== */}
<div style={{ marginBottom: '24px' }}>
  <div style={{ color: '#94A3B8', fontSize: '15px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between' }}>
    <span>Назначенные миксеры ({currentMixers.length})</span>
    <span style={{ fontSize: '13px', color: '#64748B' }}>Изменяй время — список пересортируется</span>
  </div>
  
  <div style={{ 
    maxHeight: '240px',
    overflowY: 'auto',
    paddingRight: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px'
  }}>
    {currentMixers.length > 0 ? (
      [...currentMixers]
        .sort((a, b) => (a.time || '00:00').localeCompare(b.time || '00:00'))
        .map((mixer, index) => (
        <div 
          key={mixer.id || index}
          style={{ 
            background: '#1E2937', 
            padding: '6px 12px',
            borderRadius: '10px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            minHeight: '36px',
            userSelect: 'none'
          }}
        >
          {/* Порядковый номер */}
          <div style={{
            width: '22px',
            height: '22px',
            background: '#334155',
            borderRadius: '9999px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: '700',
            color: '#94A3B8',
            fontSize: '13px',
            flexShrink: 0
          }}>
            {index + 1}
          </div>

          {/* Номер миксера */}
          <div style={{ fontWeight: '700', fontSize: '14.5px', minWidth: '120px' }}>
            {mixer.mixerName || mixer.number}
          </div>

          {/* Время загрузки — РЕДАКТИРУЕМОЕ */}
          <input 
            type="time" 
            value={mixer.time || ''}
            onChange={(e) => handleMixerTimeChange(mixer.id, e.target.value)}
            style={{ 
              background: '#0F172A', 
              color: '#94A3B8', 
              border: '1px solid #475569', 
              borderRadius: '8px', 
              padding: '4px 8px',
              fontSize: '13px',
              width: '92px'
            }}
          />

          {/* Объём */}
          <div style={{ 
            color: '#94A3B8', 
            fontSize: '13px',
            minWidth: '70px'
          }}>
            {Number(mixer.volume).toFixed(1)} м³
          </div>

          {/* Статус */}
          <select 
            value={mixer.status || 'Загрузка'} 
            onChange={(e) => handleStatusChangeLocal(mixer.id, e.target.value)} 
            style={{ 
              padding: '4px 8px', 
              borderRadius: '9999px', 
              background: '#0F172A', 
              color: 'white', 
              border: 'none', 
              fontSize: '13px', 
              minWidth: '120px' 
            }}
          >
            <option value="Загрузка">🟡 Загрузка</option>
            <option value="В пути">🔵 В пути</option>
            <option value="На объекте">📍 На объекте</option>
            <option value="Разгружен">🟢 Разгружен</option>
            <option value="Возврат">↩️ Возврат</option>
            <option value="Проблема">🔴 Проблема</option>
          </select>

          {/* Время на объекте / простой — видно всегда; до "На объекте" данных нет, показываем 0 */}
          <div style={{
            fontSize: '12px',
            padding: '3px 9px',
            borderRadius: '6px',
            whiteSpace: 'nowrap',
            background: Number(mixer.downtimeMinutes) > 0 ? 'rgba(249, 115, 22, 0.15)' : 'rgba(148, 163, 184, 0.15)',
            color: Number(mixer.downtimeMinutes) > 0 ? '#F97316' : '#94A3B8'
          }}
            title="Время на объекте / простой сверх нормы"
          >
            ⏱ {formatOnSiteDuration(mixer) || '0 мин'}
            {mixer.status === 'Разгружен' && ` (простой ${Number(mixer.downtimeMinutes || 0)} мин)`}
          </div>

          <button 
            onClick={() => deleteMixer(mixer.id, index)} 
            style={{ 
              color: '#EF4444', 
              background: 'none', 
              border: 'none', 
              cursor: 'pointer', 
              fontSize: '17px',
              padding: '2px 6px'
            }}
          >
            ✕
          </button>
        </div>
      ))
    ) : (
      <div style={{ color: '#64748B', textAlign: 'center', padding: '30px 0', fontStyle: 'italic' }}>
        Пока нет назначенных миксеров
      </div>
    )}
  </div>
</div>

                 {/* ==================== КНОПКА ЗАВЕРШЕНИЯ ЛОГИСТИКИ ==================== */}
<button 
  onClick={async () => {
    console.log('🛠 Нажата кнопка сохранения логистики — сохраняем порядок...');
    await saveSortOrderToDB();     // ← сначала сохраняем порядок
    await completeLogistics(order); // ← потом логистику
  }} 
  style={{ 
    width: '100%', 
    padding: '18px', 
    background: isFullyReady ? '#10B981' : '#475569', 
    color: 'white', 
    border: 'none', 
    borderRadius: '16px', 
    fontSize: '17px', 
    fontWeight: '700', 
    cursor: 'pointer' 
  }}
>
  {isFullyReady ? '✓ Завершить логистику и сохранить в базу' : '⚠️ Сохранить частичную логистику'}
</button>
                </div>
              );
            })()}
          </div>
          </div>

                       {/* ==================== ФОРМА ДОБАВЛЕНИЯ МИКСЕРА ==================== */}
        <div style={{ borderTop: '1px solid #334155', paddingTop: '15px', marginTop: '20px' }}>
          <h4 style={{ color: '#94A3B8', marginBottom: '20px' }}>Добавить миксер</h4>
          
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: '2.6fr 1.8fr 1.4fr 1.1fr auto', 
            gap: '16px', 
            alignItems: 'end' 
          }}>
    
            {/* Выбор миксера из базы */}
            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
                Миксер
              </label>
              <select 
                id="mixerSelect"
                style={{ 
                  width: '100%', 
                  padding: '14px', 
                  background: '#1E2937', 
                  border: '2px solid #475569', 
                  borderRadius: '12px', 
                  color: 'white',
                  fontSize: '15px'
                }}
                onChange={(e) => {
                  if (e.target.value === 'custom') {
                    (document.getElementById('mixerName') as HTMLInputElement).value = '';
                  } else {
                    const selected = allMixers.find(m => m.id === Number(e.target.value));
                    if (selected) {
                      (document.getElementById('mixerName') as HTMLInputElement).value = selected.number;
                    }
                  }
                }}
              >
                <option value="">— Выберите миксер —</option>
                {allMixers.map((mixer) => (
                  <option key={mixer.id} value={mixer.id}>
                    {mixer.number} — {mixer.model} ({mixer.volume} м³)
                  </option>
                ))}
                <option value="custom">Другой (ввести вручную)</option>
              </select>
            </div>

            {/* Номер / Название */}
            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
                Номер / Название
              </label>
              <input 
                type="text" 
                id="mixerName"
                placeholder="Например: О021УХ32"
                style={{ 
                  width: '80%', 
                  padding: '14px', 
                  background: '#1E2937', 
                  border: '2px solid #475569',
                  borderRadius: '12px', 
                  color: 'white' 
                }}
              />
            </div>

            {/* ==================== ВРЕМЯ ПОГРУЗКИ (ОБЯЗАТЕЛЬНОЕ) ==================== */}
<div>
  <label style={{ display: 'block', color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
    Время погрузки <span style={{ color: '#EF4444' }}>*</span>
  </label>
  <input 
    type="time" 
    id="mixerTime"
    required
    style={{ 
      width: '80%', 
      padding: '14px', 
      background: '#1E2937', 
      border: '2px solid #475569',
      borderRadius: '12px', 
      color: '#E2E8F0',
      colorScheme: 'dark'
    }}
  />
</div>

            {/* Объём */}
            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
                м³
              </label>
              <input 
                type="number" 
                id="mixerVolume"
                placeholder="8"
                step="0.01"
                style={{ 
                  width: '80%', 
                  padding: '14px', 
                  background: '#1E2937', 
                  border: '2px solid #475569',
                  borderRadius: '12px', 
                  color: 'white' 
                }}
              />
            </div>

            {/* Кнопки действий (рядом справа) */}
            <div style={{ display: 'flex', gap: '12px', alignItems: 'end' }}>

              {/* ==================== КНОПКА ДОБАВЛЕНИЯ МИКСЕРА ==================== */}
               <button 
               onClick={async () => {
                 const name = (document.getElementById('mixerName') as HTMLInputElement).value.trim();
                 const time = (document.getElementById('mixerTime') as HTMLInputElement).value;
                 const vol = parseFloat((document.getElementById('mixerVolume') as HTMLInputElement).value || '0');

              // ← Обязательная проверка времени
                 if (!name || !time || vol <= 0) {
                 alert('Пожалуйста, заполните все обязательные поля:\n• Название миксера\n• Время погрузки\n• Объём');
                 return;
              }

    // Находим максимальный sortOrder среди уже существующих миксеров этого заказа
    const existingMixers = mixerAssignments.filter(m => String(m.orderId) === String(order.id));
    const maxSortOrder = existingMixers.length > 0 
      ? Math.max(...existingMixers.map(m => Number(m.sortOrder) || 0)) 
      : -1;

    const newSortOrder = maxSortOrder + 1;

    // === 1. Сохраняем миксер в базу ===
    // Сервер сам: (а) проверит, что заявка не в финальном статусе,
    // (б) запишет историю добавления миксера,
    // (в) при необходимости автоматически переведёт заявку "Новая → В работе"
    // и тоже запишет это в историю — от имени "Системы", а не сотрудника.
    const res = await fetch('/api/adminCifra/order-mixers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.id,
        mixerName: name,
        time: time,
        volume: vol,
        sortOrder: newSortOrder,
        status: 'Загрузка',
        userName: getCurrentUserName(),
        userRole: getCurrentRole()
      })
    });

    if (res.ok) {
      const result = await res.json();
      const savedId = result.data?.id || result.id || Date.now();

      // === 2. Создаём объект нового миксера ===
      const newMixer = {
        id: savedId,
        orderId: order.id,
        mixerName: name,
        number: name,
        time: time,
        volume: vol,
        status: 'Загрузка',
        sortOrder: newSortOrder
      };

      // === 3. Добавляем в конец списка и сортируем по sortOrder (маленькие сверху) ===
      setMixerAssignments(prev => {
        const updated = [...prev, newMixer];
        return updated.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
      });

      // === 4. Если сервер перевёл заявку в "В работе" — обновляем локальный список заказов ===
      if (result.newOrderStatus) {
        setAllOrders(prev => prev.map(o =>
          o.id === order.id ? { ...o, status: result.newOrderStatus } : o
        ));
      }

      // === 5. Обновляем историю сразу ===
      if (typeof setHistory === 'function') {
        const histRes = await fetch(`/api/adminCifra/order-history?orderId=${order.id}&_t=${Date.now()}`);
        if (histRes.ok) setHistory(await histRes.json());
      }

      // 🔥 window.dispatchEvent('mixerAdded') убран — дашборд получает INSERT
      // через realtime-подписку на order_mixers, ручной рефетч больше не нужен

      // === 6. Очистка формы ===
      (document.getElementById('mixerName') as HTMLInputElement).value = '';
      (document.getElementById('mixerTime') as HTMLInputElement).value = '';
      (document.getElementById('mixerVolume') as HTMLInputElement).value = '';
      (document.getElementById('mixerSelect') as HTMLSelectElement).value = '';

      console.log(`✅ Миксер ${name} добавлен в конец списка (sortOrder = ${newSortOrder})`);
    } else {
      const errData = await res.json().catch(() => ({}));
      alert(errData.error || 'Ошибка сохранения миксера в базу');
    }
  }}
  style={{
    padding: '14px 32px',
    background: '#10B981',
    color: 'white',
    border: 'none',
    borderRadius: '12px',
    fontWeight: '600',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    height: '52px'
  }}
>
  Добавить
</button>

              {/* Кнопка Завершить логистику */}
              <button 
                onClick={() => completeLogistics(order)}
                style={{
                  padding: '14px 28px',
                  background: '#3B82F6',
                  color: 'white',
                  border: 'none',
                  borderRadius: '12px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  height: '52px'
                }}
              >
                Завершить логистику
              </button>
            </div>
          </div>
        </div>

        {/* ==================== ИСТОРИЯ ИЗМЕНЕНИЙ (ПОЛНАЯ + МИКСЕРЫ) ==================== */}
<div style={{ marginTop: '15px', borderTop: '1px solid #334155', paddingTop: '10px' }}>
  <h4 style={{ color: '#94A3B8', marginBottom: '16px' }}>История изменений</h4>
  
  <div style={{ 
    background: '#25334A', 
    borderRadius: '16px', 
    padding: '20px', 
    fontSize: '15px',
    maxHeight: '280px',
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

        const cleanAction = entry.action || '';
        const isAuto = entry.user_role === 'system';

        // Определение цвета изменения
        let highlightColor = '#CBD5E1';
        if (entry.field_name === 'organization_name' || cleanAction.toLowerCase().includes('организации')) highlightColor = '#60A5FA';
        if (entry.field_name === 'status') highlightColor = '#10B981';
        if (entry.field_name === 'volume') highlightColor = '#F59E0B';
        if (entry.field_name === 'address') highlightColor = '#A78BFA';

        return (
          <div key={index} style={{ 
            display: 'flex', 
            gap: '12px', 
            marginBottom: '14px', 
            paddingBottom: '12px',
            borderBottom: index !== history.length - 1 ? '1px solid #334155' : 'none',
            alignItems: 'flex-start'
          }}>
            {/* Время */}
            <div style={{ 
              width: '68px', 
              color: '#64748B', 
              fontSize: '13px', 
              flexShrink: 0,
              textAlign: 'right',
              paddingTop: '2px'
            }}>
              {time}
            </div>
            
            {/* Контент */}
            <div style={{ flex: 1 }}>
              <strong style={{ color: isAuto ? '#60A5FA' : '#CBD5E1' }}>
                {isAuto ? '🤖 Система (автоматически)' : (entry.user_name || 'Сотрудник')}
                {!isAuto && entry.user_role && entry.user_role !== 'unknown' && ` (${getRoleDisplayName(entry.user_role)})`}
              </strong>

              <div style={{ marginTop: '4px', color: '#E2E8F0', lineHeight: '1.4' }}>
                {cleanAction}
              </div>

              {/* Детальная информация об изменении (как в странице Заявки) */}
              {(entry.field_name || entry.old_value || entry.new_value) && (
                <div style={{ 
                  marginTop: '6px', 
                  padding: '6px 10px', 
                  background: '#1E2937', 
                  borderRadius: '8px',
                  fontSize: '14px'
                }}>
                  <span style={{ color: '#94A3B8' }}>{entry.field_name || 'Поле'}:</span>{' '}
                  <span style={{ color: '#EF4444' }}>{entry.old_value || '—'}</span>
                  {' → '}
                  <span style={{ color: highlightColor, fontWeight: '600' }}>
                    {entry.new_value || '—'}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })
    ) : (
      <div style={{ color: '#64748B', textAlign: 'center', padding: '60px 0', fontStyle: 'italic' }}>
        История изменений пуста
      </div>
    )}
  </div>
</div>

        {/* ==================== КАРТЫ ==================== */}
<div style={{ marginTop: '32px' }}>
  <h4 style={{ color: '#94A3B8', marginBottom: '16px' }}>Маршрут доставки</h4>
  
  <div style={{ 
    display: 'flex', 
    flexDirection: 'row', 
    gap: '12px' 
  }}>
    <a 
      href={`https://www.google.com/maps/dir/?api=1&origin=Брянск,+Орловский+тупик,+6&destination=${encodeURIComponent(order.address || '')}&travelmode=driving`} 
      target="_blank" 
      rel="noopener noreferrer" 
      style={{ 
        flex: 1,
        padding: '13px 18px', 
        background: '#10B981', 
        color: 'white', 
        textAlign: 'center', 
        borderRadius: '12px', 
        textDecoration: 'none', 
        fontWeight: '600',
        fontSize: '15px',
        transition: 'all 0.2s'
      }}
    >
      🗺️ Google Maps
    </a>

    <a 
      href={`https://yandex.ru/maps/?ll=34.415968,53.254623&z=12&mode=route&rtext=Брянск,%20Орловский%20тупик,%206~${encodeURIComponent(order.address || '')}&rtt=auto`} 
      target="_blank" 
      rel="noopener noreferrer" 
      style={{ 
        flex: 1,
        padding: '13px 18px', 
        background: '#3B82F6', 
        color: 'white', 
        textAlign: 'center', 
        borderRadius: '12px', 
        textDecoration: 'none', 
        fontWeight: '600',
        fontSize: '15px',
        transition: 'all 0.2s'
      }}
    >
      🗺️ Яндекс.Карты
    </a>
  </div>
</div>

      </div>
    </div>
  );
}