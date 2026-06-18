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

// ==================== ПЕРЕВОД СТАТУСОВ ====================
const getStatusRussian = (status: string): string => {
  const map: Record<string, string> = {
    'new': 'Новый',
    'processing': 'В работе',
    'completed': 'Выполнен',
    'cancelled': 'Отменён',
    'loading': 'Загрузка',
    'on_way': 'В пути',
  };
  return map[status?.toLowerCase()] || status || '—';
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

// ==================== 0.5. ПРОВЕРКА СТАТУСА ЗАЯВКИ ПРИ ОТКРЫТИИ МОДАЛКИ ====================
useEffect(() => {
  if (order?.id) {
    checkAndUpdateOrderStatus();
  }
}, [order?.id]);   // срабатывает каждый раз при открытии новой заявки

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
const handleStatusChangeLocal = async (mixerId: number, newStatus: string) => {
  const oldMixer = mixerAssignments.find(m => m.id === mixerId);
  const oldStatus = oldMixer?.status || 'Загрузка';
  const mixerName = oldMixer?.mixerName || 
                    oldMixer?.number || 
                    oldMixer?.mixer_name || 
                    `Миксер #${mixerId}`;

  if (oldStatus === newStatus) return;

  // Оптимистическое обновление
  setMixerAssignments(prev =>
    prev.map(m => m.id === mixerId ? { ...m, status: newStatus } : m)
  );

  try {
    await fetch('/api/adminCifra/order-mixers/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: mixerId, status: newStatus })
    });

    // ←←← ПРЯМОЙ ВЫЗОВ С ЧЁТКИМ ТЕКСТОМ
    const actionText = `Изменил статус миксера ${mixerName} с "${oldStatus}" на "${newStatus}"`;

    console.log('📝 Записываем в историю:', actionText);

    if (typeof addToHistory === 'function') {
      await addToHistory(actionText);
    } else if (typeof window !== 'undefined' && (window as any).addToHistoryGlobal) {
      (window as any).addToHistoryGlobal(actionText);
    }

    // Авто-смена статуса заявки
    await checkAndUpdateOrderStatus();

  } catch (err) {
    console.error('Ошибка обновления статуса миксера:', err);
    
    // Откат
    setMixerAssignments(prev =>
      prev.map(m => m.id === mixerId ? { ...m, status: oldStatus } : m)
    );
    alert(`Не удалось изменить статус миксера.`);
  }
};

// ==================== 6. АВТОМАТИЧЕСКАЯ СМЕНА СТАТУСА ЗАЯВКИ (ФИНАЛЬНАЯ) ====================
const checkAndUpdateOrderStatus = async () => {
  if (!order?.id) return;

  const orderMixers = mixerAssignments.filter(m => String(m.orderId) === String(order.id));
  if (orderMixers.length === 0) return;

  const totalAssignedVolume = orderMixers.reduce((sum, m) => sum + Number(m.volume || 0), 0);
  const orderVolume = Number(order.volume || 0);

  const allUnloaded = orderMixers.length > 0 && 
                     orderMixers.every(m => m.status === 'Разгружен');

  let newStatus = order.status;

  // ==================== СТРОГИЙ ПРИОРИТЕТ ====================
  if (allUnloaded) {
    newStatus = 'completed';                    // Высший приоритет
  } 
  else if (totalAssignedVolume >= orderVolume && order.status === 'new') {
    newStatus = 'processing';
  }

  // ==================== ЗАЩИТА ФИНАЛЬНЫХ СТАТУСОВ ====================
  if (order.status === 'completed' || order.status === 'cancelled') {
    newStatus = order.status;
  }

  // Меняем только если статус действительно другой
  if (newStatus !== order.status) {
    console.log(`🔄 Автосмена #${order.id}: ${order.status} → ${newStatus}`);

    // Обновляем глобальный список
    setAllOrders(prev => prev.map(o => 
      o.id === order.id ? { ...o, status: newStatus, logistics_ready: true } : o
    ));

    // Обновляем локальное состояние в модалке
    setLocalOrder(prev => prev ? { 
      ...prev, 
      status: newStatus, 
      logistics_ready: true 
    } as any : null);

    // Обновляем выбранную заявку в родительском компоненте
    if (typeof setSelectedOrder === 'function') {
      setSelectedOrder((prev: any) => prev ? { 
        ...prev, 
        status: newStatus, 
        logistics_ready: true 
      } : null);
    }

    // ==================== ЗАПИСЬ В ИСТОРИЮ (СИСТЕМА) ====================
    if (typeof addToHistory === 'function') {
      let actionText = '';

      if (newStatus === 'completed') {
        actionText = `Автоматически изменил статус заявки на "Выполнена" (все миксеры разгружены) [SYSTEM]`;
      } else if (newStatus === 'processing') {
        actionText = `Автоматически изменил статус заявки на "В работе" (полностью укомплектован миксерами) [SYSTEM]`;
      }

      if (actionText) {
        await addToHistory(actionText);
      }
    }
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

  // ==================== ПЕЧАТЬ ТТН (ВОДИТЕЛЬ ИЗ СПИСКА МИКСЕРОВ) ====================
const printTTN = (mixerId: number) => {
  const currentMixer = mixerAssignments.find(m => m.id === mixerId);
  if (!currentMixer || !order) {
    alert('Не удалось найти данные для ТТН');
    return;
  }

  // === ИЩЕМ ПОЛНЫЕ ДАННЫЕ МИКСЕРА ИЗ ГЛОБАЛЬНОГО СПИСКА ===
  const fullMixerData = allMixers?.find(m => 
    m.number === currentMixer.number || 
    m.mixer_name === currentMixer.number || 
    m.id === currentMixer.id
  );

  const driverName = fullMixerData?.driver || 
                     fullMixerData?.driverName || 
                     fullMixerData?.full_name || 
                     fullMixerData?.FIO || 
                     currentMixer.driver || 
                     'Не указан';

  const plate = fullMixerData?.plate || currentMixer.plate || '—';

  const ttnNumber = `ТТН-${order.id}-${currentMixer.id}`;
  const currentDate = new Date().toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const currentDateTime = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

  const ttnHTML = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>ТТН № ${ttnNumber}</title>
      <style>
        @page { size: A4 portrait; margin: 8mm; }
        body { font-family: Arial, sans-serif; font-size: 10.8px; line-height: 1.22; margin:0; }
        .page { width: 100%; min-height: 100vh; page-break-after: always; padding: 12px; box-sizing: border-box; }
        table { width: 100%; border-collapse: collapse; margin: 5px 0; }
        td, th { border: 1px solid #000; padding: 4px 6px; vertical-align: top; }
        .section { background: #f0f0f0; font-weight: bold; text-align: center; }
      </style>
    </head>
    <body>

      <!-- СТРАНИЦА 1 -->
      <div class="page">
        <div style="text-align:center;font-size:12px;margin-bottom:5px;">Приложение № 4 к Правилам перевозок грузов автомобильным транспортом</div>
        <div style="text-align:center;font-size:11px;margin-bottom:12px;">(в редакции постановления Правительства Российской Федерации от 30 ноября 2021 г. № 2116)</div>
        
        <div style="text-align:center;font-size:16px;font-weight:bold;margin:15px 0;">Транспортная накладная</div>

        <table>
          <tr><td>Транспортная накладная</td><td>Заказ (заявка)</td></tr>
          <tr><td>Дата: ${currentDate}<br>№ ${ttnNumber}</td><td>Дата: ${currentDate}<br>№ ${order.id}</td></tr>
        </table>

        <table>
          <tr><td colspan="2" class="section">1. Грузоотправитель</td></tr>
          <tr><td colspan="2">ООО "ТРЕЙДКОМ", ИНН 3257056152, 241022, Брянская область, г.о. город Брянск, г Брянск, туп Орловский, стр. 6А, помещ. 4, тел.: +7 (906) 500-21-55</td></tr>

          <tr><td colspan="2" class="section">2. Грузополучатель</td></tr>
          <tr><td colspan="2">${order.organization_name || order.full_name || '—'}</td></tr>
          <tr><td colspan="2">${order.address || '—'}</td></tr>

          <tr><td colspan="2" class="section">3. Груз</td></tr>
          <tr><td>Наименование груза</td><td>Бетон ${order.grade || '—'}</td></tr>
          <tr><td>Объём</td><td>${Number(currentMixer.volume).toFixed(1)} м³</td></tr>
          <tr><td>Миксер</td><td>${currentMixer.number || currentMixer.mixer_name || '—'}</td></tr>
        </table>

        <table>
          <tr><td colspan="2" class="section">6. Перевозчик</td></tr>
          <tr><td colspan="2">ООО "ТРЕЙДКОМ", ИНН 3257056152, 241022, Брянская область, г.о. город Брянск, г Брянск, туп Орловский, стр. 6А, помещ. 4</td></tr>
          <tr><td>Водитель</td><td>${driverName}</td></tr>
        </table>

        <table>
          <tr><td colspan="2" class="section">7. Транспортное средство</td></tr>
          <tr><td>Марка, модель</td><td>${currentMixer.number || currentMixer.mixer_name || '—'}</td></tr>
          <tr><td>Гос. номер</td><td>${plate}</td></tr>
        </table>
      </div>

      <!-- СТРАНИЦА 2 — ОБОРОТНАЯ -->
      <div class="page">
        <div class="header">Оборотная сторона</div>

        <table>
          <tr><td colspan="2" class="section">8. Прием груза</td></tr>
          <tr><td>Наименование (ИНН) владельца пункта погрузки</td><td>ООО "ТРЕЙДКОМ" ИНН 3257056152</td></tr>
          <tr><td>Адрес места погрузки</td><td>241022, Брянская область, г.о. город Брянск, г Брянск, туп Орловский, стр. 6А, помещ. 4</td></tr>
          <tr><td>Фактические дата и время прибытия под погрузку</td><td>${currentDate} ${currentMixer.time || currentDateTime}</td></tr>
          <tr><td>Фактические дата и время убытия</td><td>${currentDate} ${currentDateTime}</td></tr>
          <tr><td>Масса груза</td><td>${Number(currentMixer.volume).toFixed(1)} м³</td></tr>
        </table>

        <table>
          <tr><td colspan="2" class="section">9. Переадресовка (при наличии)</td></tr>
          <tr><td colspan="2">—</td></tr>
        </table>

        <table>
          <tr><td colspan="2" class="section">10. Выдача груза</td></tr>
          <tr><td>Адрес места выгрузки</td><td>${order.address || '—'}</td></tr>
          <tr><td>Фактические дата и время прибытия</td><td>${currentDate}</td></tr>
          <tr><td>Фактические дата и время убытия</td><td>${currentDate}</td></tr>
          <tr><td>Масса груза</td><td>${Number(currentMixer.volume).toFixed(1)} м³</td></tr>
        </table>

        <table>
          <tr><td colspan="2" class="section">11. Отметки грузоотправителей, грузополучателей, перевозчиков</td></tr>
          <tr><td colspan="2" style="height:85px;">—</td></tr>
        </table>

        <table>
          <tr><td colspan="2" class="section">12. Стоимость перевозки груза</td></tr>
          <tr><td>Стоимость перевозки без налога - всего</td><td>— ₽</td></tr>
          <tr><td>Сумма налога</td><td>— ₽</td></tr>
          <tr><td>Стоимость с налогом - всего</td><td>— ₽</td></tr>
        </table>

        <div style="margin-top:35px; text-align:center; font-size:11px;">
          Подпись грузоотправителя _______________________ &nbsp;&nbsp;&nbsp;&nbsp;
          Подпись водителя _______________________ &nbsp;&nbsp;&nbsp;&nbsp;
          Подпись грузополучателя _______________________
        </div>
      </div>

    </body>
    </html>
  `;

  const win = window.open('', '_blank', 'width=1100,height=950');
  if (win) {
    win.document.write(ttnHTML);
    win.document.close();
    setTimeout(() => win.print(), 700);
  }
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
          maxHeight: '94vh', 
          overflow: 'auto',
          boxShadow: '0 30px 80px rgba(0,0,0,0.7)'
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
      const res = await fetch('/api/adminCifra/order-logistics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          status: newStatus
        })
      });

      const data = await res.json();

      if (data.success) {
        // ←←← ГЛАВНОЕ ИСПРАВЛЕНИЕ
                if (typeof addToHistory === 'function') {
          const statusText = `Изменил статус заявки с "${getStatusRussian(oldStatus)}" на "${getStatusRussian(newStatus)}"`;
          await addToHistory(statusText);
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
    {Number(assignedVolume).toFixed(1)} / {Number(orderVolume).toFixed(1)} м³
  </div>
  <div style={{ fontSize: '14px', color: isFullyReady ? '#10B981' : '#F59E0B' }}>
    {isFullyReady ? '✅ Полностью укомплектовано' : `Осталось ${Number(orderVolume - assignedVolume).toFixed(1)} м³`}
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

          {/* Кнопка ТТН — уменьшенная */}
<button 
  onClick={() => printTTN(mixer.id)} 
  style={{ 
    padding: '3px 9px', 
    background: 'rgba(148, 163, 184, 0.15)',   
    color: '#94A3B8',                          
    border: '1px solid rgba(148, 163, 184, 0.3)',
    borderRadius: '6px', 
    fontSize: '11.5px',        // уменьшено
    fontWeight: '500',
    cursor: 'pointer',
    transition: 'all 0.2s',
    minWidth: 'auto',
    height: '26px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  }}
  onMouseEnter={(e) => {
    e.currentTarget.style.background = 'rgba(148, 163, 184, 0.25)';
    e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.5)';
  }}
  onMouseLeave={(e) => {
    e.currentTarget.style.background = 'rgba(148, 163, 184, 0.15)';
    e.currentTarget.style.borderColor = 'rgba(148, 163, 184, 0.3)';
  }}
>
  ТТН
</button>

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
                step="0.5"
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
    const res = await fetch('/api/adminCifra/order-mixers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.id,
        mixerName: name,
        time: time,
        volume: vol,
        sortOrder: newSortOrder,
        status: 'Загрузка'
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

      // === 4. Авто-смена статуса заказа (если полностью заполнен) ===
const newAssignedVolume = [...mixerAssignments, newMixer]
  .filter(m => String(m.orderId) === String(order.id))
  .reduce((sum, m) => sum + Number(m.volume || 0), 0);

const orderVolume = Number(order.volume || 0);
const isFullyReady = newAssignedVolume >= orderVolume && newAssignedVolume > 0;

if (isFullyReady && order.status === 'new') {
  // Обновляем локально
  setAllOrders(prev => prev.map(o => 
    o.id === order.id ? { ...o, status: 'processing', logistics_ready: true } : o
  ));

  // === Важно: Отправляем в базу как автоматическое действие ===
  try {
    await fetch('/api/adminCifra/orders/update', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: order.id,
        status: 'processing',
        logistics_ready: true,
        userName: 'Система',           // ← Чтобы не приписывать человеку
        userRole: 'system'
      })
    });
  } catch (e) {
    console.error('Не удалось обновить статус автоматически:', e);
  }
}

// === 5. Запись в историю ===
if (typeof addToHistory === 'function') {
  await addToHistory(`Добавил миксер ${name} (${vol} м³ в ${time})`);
  
  // Дополнительная запись про авто-статус (если сработал)
  if (isFullyReady && order.status === 'new') {
    await addToHistory('Автоматически изменил статус заявки на "В работе"');
  }
}

if (typeof window !== 'undefined') {
  window.dispatchEvent(new Event('mixerAdded'));
}

      // === 6. Очистка формы ===
      (document.getElementById('mixerName') as HTMLInputElement).value = '';
      (document.getElementById('mixerTime') as HTMLInputElement).value = '';
      (document.getElementById('mixerVolume') as HTMLInputElement).value = '';
      (document.getElementById('mixerSelect') as HTMLSelectElement).value = '';

      console.log(`✅ Миксер ${name} добавлен в конец списка (sortOrder = ${newSortOrder})`);
    } else {
      alert('Ошибка сохранения миксера в базу');
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

        {/* ==================== ИСТОРИЯ ИЗМЕНЕНИЙ ==================== */}
<div style={{ marginTop: '15px', borderTop: '1px solid #334155', paddingTop: '10px' }}>
  <h4 style={{ color: '#94A3B8', marginBottom: '16px' }}>История изменений</h4>
  
  <div style={{ 
    background: '#25334A', 
    borderRadius: '16px', 
    padding: '20px', 
    fontSize: '15px',
    maxHeight: '150px',
    overflowY: 'auto'
  }}>
    {history.length > 0 ? (
      history.map((entry: any, index: number) => {
        const time = new Date(entry.created_at).toLocaleTimeString('ru-RU', { 
          hour: '2-digit', 
          minute: '2-digit' 
        });

        // Очищаем текст от служебного флага [SYSTEM]
        const cleanAction = entry.action ? entry.action.replace(' [SYSTEM]', '') : '';

        return (
          <div key={index} style={{ 
            display: 'flex', 
            gap: '12px', 
            marginBottom: '10px', 
            paddingBottom: '10px',
            borderBottom: index !== history.length - 1 ? '1px solid #334155' : 'none',
            alignItems: 'flex-start'
          }}>
            {/* Время */}
            <div style={{ 
              width: '52px', 
              color: '#64748B', 
              fontSize: '13.5px', 
              flexShrink: 0,
              textAlign: 'right'
            }}>
              {time}
            </div>
            
            {/* Основная запись */}
            <div style={{ flex: 1 }}>
              <strong style={{ color: '#CBD5E1' }}>
                {entry.user_name?.includes('SYSTEM') || entry.action?.includes('[SYSTEM]') 
                  ? '🤖 Система' 
                  : (entry.user_name || 'Сотрудник')}
              </strong>
              <div style={{ marginTop: '4px', color: '#E2E8F0' }}>
                {cleanAction}
              </div>
            </div>
          </div>
        );
      })
    ) : (
      <div style={{ color: '#64748B', textAlign: 'center', padding: '40px 0', fontStyle: 'italic' }}>
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