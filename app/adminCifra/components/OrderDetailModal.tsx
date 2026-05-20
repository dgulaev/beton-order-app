'use client';

import React from 'react';
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
}

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
  history,           // ← добавь
  addToHistory,      // ← добавь
}: OrderDetailModalProps) {

  if (!order) return null;

  // ==================== ФУНКЦИИ СМЕНЫ ОЧЕРЕДИ С ЗАПИСЬЮ В ИСТОРИЮ ====================
  const moveMixerUp = async (mixerId: number) => {
    const mixer = mixerAssignments.find(m => m.id === mixerId);
    const mixerName = mixer?.mixerName || mixer?.number || mixer?.mixer_name || 'Миксер';

    setMixerAssignments(prev => {
      const newList = [...prev];
      const index = newList.findIndex(m => m.id === mixerId);
      if (index <= 0) return prev;

      // Меняем местами
      [newList[index], newList[index - 1]] = [newList[index - 1], newList[index]];

      // Обновляем sortOrder
      newList.forEach((m, i) => {
        if (m.orderId === order.id) m.sortOrder = i;
      });

      return newList;
    });

    await saveSortOrderToDB();

    // Запись в историю
    if (typeof addToHistory === 'function') {
      await addToHistory(`Переместил миксер ${mixerName} ↑ выше в очереди`);
    }
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
        if (m.orderId === order.id) m.sortOrder = i;
      });

      return newList;
    });

    await saveSortOrderToDB();

    // Запись в историю
    if (typeof addToHistory === 'function') {
      await addToHistory(`Переместил миксер ${mixerName} ↓ ниже в очереди`);
    }
  };

  // Сохранение порядка в базу
  const saveSortOrderToDB = async () => {
    const currentOrderMixers = mixerAssignments.filter(m => m.orderId === order.id);

    for (let i = 0; i < currentOrderMixers.length; i++) {
      const mixer = currentOrderMixers[i];
      await fetch('/api/adminCifra/order-mixers/sort', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: mixer.id,
          sortOrder: i
        })
      });
    }
  };

  // ==================== ОБНОВЛЕНИЕ СТАТУСА МИКСЕРА + ИСТОРИЯ ====================
  const handleStatusChangeLocal = async (mixerId: number, newStatus: string) => {
  const oldMixer = mixerAssignments.find(m => m.id === mixerId);
  const oldStatus = oldMixer?.status || 'В пути';
  const mixerName = oldMixer?.mixerName || oldMixer?.number || oldMixer?.mixer_name || 'Миксер';

  // Optimistic update
  setMixerAssignments(prev =>
    prev.map(m =>
      m.id === mixerId ? { ...m, status: newStatus } : m
    )
  );

  try {
    const res = await fetch('/api/adminCifra/order-mixers/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        id: mixerId, 
        status: newStatus 
      })
    });

    const data = await res.json();

    if (data.success) {
      // Записываем в историю только если статус реально изменился
      if (typeof addToHistory === 'function' && oldStatus !== newStatus) {
        await addToHistory(
          `Изменил статус миксера ${mixerName} с "${oldStatus}" → "${newStatus}"`
        );
      }
    } else {
      throw new Error(data.message || 'Не удалось обновить статус');
    }
  } catch (err) {
    console.error('Ошибка обновления статуса:', err);

    // Откат optimistic update при ошибке
    setMixerAssignments(prev =>
      prev.map(m =>
        m.id === mixerId ? { ...m, status: oldStatus } : m
      )
    );

    alert(`Не удалось изменить статус. Ошибка: ${err}`);
  }
};

  // Получаем миксеры текущего заказа (используется в JSX)
  const currentMixers = mixerAssignments
    .filter(m => m.orderId === order.id)
    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

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
          width: '1100px', 
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
  {(() => {
    const status = order.status || 'new';
    
    const statusConfig = {
      new:        { bg: '#FACC1520', color: '#FACC15', text: '🟡 Новая' },
      processing: { bg: '#3B82F620', color: '#3B82F6',  text: '→ В работе' },
      completed:  { bg: '#10B98120', color: '#10B981', text: '✓ Выполнена' },
      cancelled:  { bg: '#EF444420', color: '#EF4444', text: '❌ Отменена' }
    };

    const config = statusConfig[status as keyof typeof statusConfig] || 
                  { bg: '#334155', color: '#CBD5E1', text: 'Неизвестно' };

    return (
      <div style={{ 
        backgroundColor: config.bg, 
        color: config.color,
        padding: '8px 26px',
        borderRadius: '9999px',
        display: 'inline-block',
        fontWeight: '600'
      }}>
        {config.text}
      </div>
    );
  })()}
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
                      {assignedVolume} / {orderVolume} м³
                    </div>
                    <div style={{ fontSize: '14px', color: isFullyReady ? '#10B981' : '#F59E0B' }}>
                      {isFullyReady ? '✅ Полностью укомплектовано' : `Осталось ${orderVolume - assignedVolume} м³`}
                    </div>
                  </div>

                  {/* ==================== СПИСОК НАЗНАЧЕННЫХ МИКСЕРОВ (с фиксированной высотой) ==================== */}
                  <div style={{ marginBottom: '24px' }}>
                    <div style={{ color: '#94A3B8', fontSize: '15px', marginBottom: '12px', display: 'flex', justifyContent: 'space-between' }}>
                      <span>Назначенные миксеры ({currentMixers.length})</span>
                      <span style={{ fontSize: '13px', color: '#64748B' }}>Перетаскивай ↑ ↓</span>
                    </div>
                    
                    {/* Фиксированная высота + скролл */}
                    <div style={{ 
                      maxHeight: '150px',           // ← Основная настройка высоты
                      overflowY: 'auto',
                      paddingRight: '8px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px'
                    }}>
                      {currentMixers.length > 0 ? (
                        currentMixers.map((mixer, index) => (
                          <div key={mixer.id || index} style={{ 
                            background: '#1E2937', 
                            padding: '12px 16px',     // ← Уменьшил высоту строки
                            borderRadius: '14px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            minHeight: '24px'         // ← Фиксированная минимальная высота
                          }}>
                            {/* Порядковый номер */}
                            <div style={{
                              width: '28px',
                              height: '28px',
                              background: '#334155',
                              borderRadius: '9999px',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: '700',
                              color: '#94A3B8',
                              fontSize: '15px',
                              flexShrink: 0
                            }}>
                              {index + 1}
                            </div>

                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontWeight: '700', fontSize: '15.5px' }}>
                                {mixer.mixerName || mixer.number}
                              </div>
                              <div style={{ color: '#94A3B8', fontSize: '13.5px' }}>
                                {mixer.time} • {mixer.volume} м³
                              </div>
                            </div>

                            {/* Кнопки очереди */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
                              <button onClick={() => moveMixerUp(mixer.id)} disabled={index === 0} style={{ padding: '2px 6px', background: 'none', border: 'none', color: index === 0 ? '#475569' : '#94A3B8', cursor: index === 0 ? 'default' : 'pointer', fontSize: '16px' }}>↑</button>
                              <button onClick={() => moveMixerDown(mixer.id)} disabled={index === currentMixers.length - 1} style={{ padding: '2px 6px', background: 'none', border: 'none', color: index === currentMixers.length - 1 ? '#475569' : '#94A3B8', cursor: index === currentMixers.length - 1 ? 'default' : 'pointer', fontSize: '16px' }}>↓</button>
                            </div>

                            <select value={mixer.status || 'Загрузка'} onChange={(e) => handleStatusChangeLocal(mixer.id, e.target.value)} style={{ padding: '6px 12px', borderRadius: '9999px', background: '#0F172A', color: 'white', border: 'none', fontSize: '14px', minWidth: '140px' }}>
                              <option value="Загрузка">🟡 Загрузка</option>
                              <option value="В пути">🔵 В пути</option>
                              <option value="На объекте">📍 На объекте</option>
                              <option value="Разгружен">🟢 Разгружен</option>
                              <option value="Возврат">↩️ Возврат</option>
                              <option value="Проблема">🔴 Проблема</option>
                            </select>

                            <button onClick={() => deleteMixer(mixer.id, index)} style={{ color: '#EF4444', background: 'none', border: 'none', cursor: 'pointer', fontSize: '20px' }}>✕</button>
                          </div>
                        ))
                      ) : (
                        <div style={{ color: '#64748B', textAlign: 'center', padding: '40px 0', fontStyle: 'italic' }}>
                          Пока нет назначенных миксеров
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Кнопка завершения */}
                  <button onClick={() => completeLogistics(order)} style={{ width: '100%', padding: '18px', background: isFullyReady ? '#10B981' : '#475569', color: 'white', border: 'none', borderRadius: '16px', fontSize: '17px', fontWeight: '700', cursor: 'pointer' }}>
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

            {/* Время погрузки */}
            <div>
              <label style={{ display: 'block', color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
                Время
              </label>
              <input 
                type="time" 
                id="mixerTime"
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

                            {/* Кнопка Добавить + сохранение в базу */}
              <button 
                onClick={async () => {
                  const name = (document.getElementById('mixerName') as HTMLInputElement).value.trim();
                  const time = (document.getElementById('mixerTime') as HTMLInputElement).value;
                  const vol = parseFloat((document.getElementById('mixerVolume') as HTMLInputElement).value || '0');

                  if (!name || !time || vol <= 0) {
                    alert('Заполните все поля');
                    return;
                  }

                  // Вычисляем позицию нового миксера в очереди (в конец)
                  const currentQueueLength = mixerAssignments
                    .filter(m => m.orderId === order.id)
                    .length;

                  // === СОХРАНЕНИЕ В БАЗУ ===
                  const res = await fetch('/api/adminCifra/order-mixers', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      orderId: order.id,
                      mixerName: name,
                      time: time,
                      volume: vol,
                      sortOrder: currentQueueLength,
                      status: 'Загрузка'                    // Начальный статус
                    })
                  });

                  if (res.ok) {
                    const newMixerData = await res.json();

                    // Добавляем новый миксер в локальное состояние
                    setMixerAssignments(prev => [...prev, {
                      id: newMixerData.id || Date.now(),
                      orderId: order.id,
                      mixerName: name,
                      time: time,
                      volume: vol,
                      sortOrder: currentQueueLength,
                      status: 'Загрузка'
                    }]);

                    // ==================== АВТОМАТИЧЕСКАЯ СМЕНА СТАТУСА ЗАКАЗА ====================
                    const assignedVolume = [...mixerAssignments, { volume: vol }]
                      .filter(m => m.orderId === order.id)
                      .reduce((sum, m) => sum + Number(m.volume || 0), 0);

                    const orderVolume = Number(order.volume || 0);
                    const isFullyReady = assignedVolume >= orderVolume && assignedVolume > 0;

                    if (isFullyReady && order.status !== 'processing') {
                      setAllOrders(prev => prev.map(o => 
                        o.id === order.id ? { ...o, status: 'processing', logistics_ready: true } : o
                      ));

                      if (typeof addToHistory === 'function') {
                        await addToHistory(`Автоматически переведён в "В работе" (полная логистика ${assignedVolume}/${orderVolume} м³)`);
                      }
                    }

                    // ==================== ОДНА ЗАПИСЬ В ИСТОРИЮ ====================
                    if (typeof addToHistory === 'function') {
                      await addToHistory(`Добавил миксер ${name} (${vol} м³ в ${time})`);
                    }

                    // Оптимистично обновляем allOrders
                    setAllOrders(prev => prev.map(o => 
                      o.id === order.id ? { ...o, logistics_ready: true } : o
                    ));

                    // После setMixerAssignments и setAllOrders
                    if (typeof window !== 'undefined') {
                    window.dispatchEvent(new Event('mixerAdded'));
                     }

                    // Очистка формы
                    (document.getElementById('mixerName') as HTMLInputElement).value = '';
                    (document.getElementById('mixerTime') as HTMLInputElement).value = '';
                    (document.getElementById('mixerVolume') as HTMLInputElement).value = '';
                    (document.getElementById('mixerSelect') as HTMLSelectElement).value = '';

                    console.log(`✅ Миксер ${name} добавлен со статусом "Загрузка"`);
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

              {/* Кнопка Завершить логистику (справа) */}
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
              <strong style={{ color: '#CBD5E1' }}>{entry.user_name}</strong>
              <span style={{ color: '#94A3B8', marginLeft: '6px' }}>
                {entry.action}
              </span>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <a href={`https://www.google.com/maps/dir/?api=1&origin=Брянск,+Орловский+тупик,+6&destination=${encodeURIComponent(order.address || '')}&travelmode=driving`} 
               target="_blank" rel="noopener noreferrer" 
               style={{ padding: '16px', background: '#10B981', color: 'white', textAlign: 'center', borderRadius: '16px', textDecoration: 'none', fontWeight: '600' }}>
              🗺️ Построить маршрут в Google Maps
            </a>
            <a href={`https://yandex.ru/maps/?ll=34.415968,53.254623&z=12&mode=route&rtext=Брянск,%20Орловский%20тупик,%206~${encodeURIComponent(order.address || '')}&rtt=auto`} 
               target="_blank" rel="noopener noreferrer" 
               style={{ padding: '16px', background: '#3B82F6', color: 'white', textAlign: 'center', borderRadius: '16px', textDecoration: 'none', fontWeight: '600' }}>
              🗺️ Яндекс.Карты
            </a>
          </div>
        </div>

      </div>
    </div>
  );
}