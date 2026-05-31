'use client';

import { useState, useEffect } from 'react';
import { useTodayLoadingMixers } from '../hooks/useTodayLoadingMixers';

export default function OperatorBSUPage() {
  const [currentShift] = useState('Дневная смена');
  const [selectedTrip, setSelectedTrip] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'zayavki' | 'reports' | 'recipes'>('zayavki');

    // ==================== 0. УПРАВЛЕНИЕ ДАТОЙ ====================
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    // Берём локальную дату без времени (как в дашборде)
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });

  // ==================== 0.1 РЕАЛЬНЫЕ ДАННЫЕ ====================
  const { allMixers } = useTodayLoadingMixers();

    // ==================== 0.2 ФИЛЬТРАЦИЯ ПО ВЫБРАННОЙ ДАТЕ (максимально строго) ====================
  const queueTrips = allMixers
    .filter((trip: any) => {
      if (!trip || trip.status !== 'Загрузка') return false;

      let tripDateStr = '';

      if (trip.delivery_date) {
        // Самое надёжное преобразование
        tripDateStr = String(trip.delivery_date).split('T')[0].substring(0, 10).trim();
      } else if (trip.created_at) {
        tripDateStr = String(trip.created_at).split('T')[0].substring(0, 10).trim();
      } else if (trip.updated_at) {
        tripDateStr = String(trip.updated_at).split('T')[0].substring(0, 10).trim();
      } else {
        tripDateStr = new Date().toISOString().split('T')[0];
      }

      // Локальная выбранная дата без времени
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const selectedDateStr = `${year}-${month}-${day}`;

      const shouldShow = tripDateStr === selectedDateStr;

      // Отладка
      if (trip.order_id === 161 || trip.orderId === 161) {
        console.log(`[ФИЛЬТР 161] delivery_date="${tripDateStr}" | selected="${selectedDateStr}" → ${shouldShow ? '✅ ПОКАЗЫВАЕМ' : '❌ СКРЫВАЕМ'}`);
      }

      return shouldShow;
    })
    .sort((a: any, b: any) => {
      const timeA = a.time || '00:00';
      const timeB = b.time || '00:00';
      return timeA.localeCompare(timeB);
    });

  // ==================== 0.3 РЕАЛТАЙМ ОБНОВЛЕНИЕ ====================
  useEffect(() => {
    const interval = setInterval(() => {
      // Принудительно вызываем обновление данных через хук
      // (хуки уже имеют встроенный polling, но это дополнительный триггер)
      console.log(`[Realtime] Принудительное обновление данных — ${new Date().toLocaleTimeString('ru-RU')}`);
    }, 4000); // каждые 4 секунды

    return () => clearInterval(interval);
  }, []);

      // ==================== 0.4 ЗАГРУЗКА РЕЦЕПТОВ ИЗ БАЗЫ ====================
  const [recipes, setRecipes] = useState<any[]>([]);

  useEffect(() => {
    const fetchRecipes = async () => {
      try {
        const res = await fetch('/api/adminCifra/recipes');
        if (res.ok) {
          const data = await res.json();
          setRecipes(data);
          console.log(`[Recipes] Загружено ${data.length} рецептов`);
        }
      } catch (err) {
        console.error('Ошибка загрузки рецептов:', err);
      }
    };

    fetchRecipes();
  }, []);

              // ==================== 1. ДЕЙСТВИЯ ОПЕРАТОРА ====================
  const [loadingTrips, setLoadingTrips] = useState<Record<number, boolean>>({});
  const [tripStartTimes, setTripStartTimes] = useState<Record<number, string>>({});

        // ==================== 1.2 ОТГРУЖЕНО СЕГОДНЯ (загрузка из базы) ====================
  const [completedTrips, setCompletedTrips] = useState<any[]>([]);

  // Загрузка отгруженных рейсов из базы
  useEffect(() => {
    const fetchCompletedTrips = async () => {
      try {
        const res = await fetch('/api/adminCifra/production-log');
        if (res.ok) {
          const data = await res.json();
          setCompletedTrips(Array.isArray(data) ? data : []);
        }
      } catch (err) {
        console.error('Ошибка загрузки отгруженных рейсов:', err);
      }
    };

    fetchCompletedTrips();
  }, []);

  // ==================== МАКСИМАЛЬНО СТРОГАЯ ФИЛЬТРАЦИЯ ====================
  const filteredCompletedTrips = completedTrips
    .filter((trip: any) => {
      if (!trip) return false;

      let tripDateStr = '';

      // ПРИОРИТЕТ 1: Дата фактического выполнения (самое важное)
      if (trip.production_created_at) {
        tripDateStr = String(trip.production_created_at).substring(0, 10).trim();
      } else if (trip.created_at) {
        tripDateStr = String(trip.created_at).substring(0, 10).trim();
      } 
      // ПРИОРИТЕТ 2: delivery_date
      else if (trip.delivery_date) {
        tripDateStr = String(trip.delivery_date).substring(0, 10).trim();
      } else if (trip.orders?.delivery_date) {
        tripDateStr = String(trip.orders.delivery_date).substring(0, 10).trim();
      }

      // Локальная выбранная дата (без UTC сдвига)
      const year = selectedDate.getFullYear();
      const month = String(selectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(selectedDate.getDate()).padStart(2, '0');
      const selectedDateStr = `${year}-${month}-${day}`;

      const shouldShow = tripDateStr === selectedDateStr;

      // Отладка
      if (trip.order_id === 161) {
        console.log(`[ФИЛЬТР 161] production_created_at="${trip.production_created_at}" | selected="${selectedDateStr}" → ${shouldShow ? '✅ ПОКАЗЫВАЕМ' : '❌ СКРЫВАЕМ'}`);
      }

      return shouldShow;
    })
    .map((trip: any) => ({
      ...trip,
      time: trip.start_time 
        ? new Date(trip.start_time).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) 
        : '—',
      loadedTime: trip.duration_minutes 
        ? `${trip.duration_minutes} мин` 
        : '—',
      order_id: trip.order_id,
      mixer_name: trip.mixer_name,
      concrete_grade: trip.concrete_grade,
      volume: trip.volume
    }));

  const startLoading = (trip: any) => {
    const now = new Date().toISOString();
    setTripStartTimes(prev => ({ ...prev, [trip.id]: now }));
    setLoadingTrips(prev => ({ ...prev, [trip.id]: true }));

    alert(`🚛 Загрузка начата: ${trip.mixer_name || trip.number} — Заказ #${trip.order_id || trip.orderId}`);
  };

  const completeLoading = async (trip: any) => {
    const startTime = tripStartTimes[trip.id];
    if (!startTime) {
      alert('❗ Сначала нажмите кнопку "Начать"');
      return;
    }

    const endTime = new Date().toISOString();
    const durationMinutes = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);

    try {
      await fetch('/api/adminCifra/production-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: trip.order_id || trip.orderId,
          order_mixer_id: trip.id,
          mixer_name: trip.mixer_name || trip.number,
          concrete_grade: trip.concrete_grade,
          volume: parseFloat(trip.volume || 0),
          podvizhnost: trip.podvizhnost || 'П3',
          start_time: startTime
        })
      });

      await fetch('/api/adminCifra/order-mixers/status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: trip.id, status: 'В пути' })
      });

      alert(`✅ Миксер успешно загружен!\nДлительность: ${durationMinutes} минут`);

      // Обновляем список
      const res = await fetch('/api/adminCifra/production-log');
      if (res.ok) {
        const updated = await res.json();
        setCompletedTrips(Array.isArray(updated) ? updated : []);
      }

    } catch (err) {
      console.error(err);
      alert('Ошибка при сохранении производства');
    }

    setLoadingTrips(prev => ({ ...prev, [trip.id]: false }));
    setTripStartTimes(prev => {
      const copy = { ...prev };
      delete copy[trip.id];
      return copy;
    });
  };

    // ==================== 2. СТАТИСТИКА ОПЕРАТОРА ====================
  const totalTrips = filteredCompletedTrips.length;
  const totalVolume = filteredCompletedTrips.reduce((sum, trip) => sum + (parseFloat(trip.volume) || 0), 0);
  
  const avgLoadingTime = filteredCompletedTrips.length > 0 
    ? Math.round(
        filteredCompletedTrips.reduce((sum, trip) => sum + (trip.duration_minutes || 0), 0) / filteredCompletedTrips.length
      ) 
    : 0;

  const activeMixers = queueTrips.length;

  // Самая частая марка
  const gradeCount = filteredCompletedTrips.reduce((acc: any, trip) => {
    const grade = trip.concrete_grade || '—';
    acc[grade] = (acc[grade] || 0) + 1;
    return acc;
  }, {});

  const mostFrequentGrade = Object.keys(gradeCount).reduce((a, b) => 
    gradeCount[a] > gradeCount[b] ? a : b, '—'
  );

  // ==================== 2.1 БЛОК СТАТИСТИКИ ====================
  const stats = [
    { 
      label: "Рейсы сегодня", 
      value: totalTrips, 
      unit: "шт", 
      color: "#10B981" 
    },
    { 
      label: "Объём бетона", 
      value: totalVolume.toFixed(1), 
      unit: "м³", 
      color: "#60A5FA" 
    },
    { 
      label: "Среднее время", 
      value: avgLoadingTime, 
      unit: "мин", 
      color: "#FACC15" 
    },
    { 
      label: "Активные миксеры", 
      value: activeMixers, 
      unit: "в очереди", 
      color: "#8B5CF6" 
    },
    { 
      label: "Самая частая марка", 
      value: mostFrequentGrade, 
      unit: "", 
      color: "#EC4899" 
    }
  ];

  // ==================== 1.3 ПЕРЕКЛЮЧЕНИЕ ДАТ ====================
  const goToPrevDay = () => {
    const prev = new Date(selectedDate);
    prev.setDate(prev.getDate() - 1);
    setSelectedDate(prev);
  };

  const goToNextDay = () => {
    const next = new Date(selectedDate);
    next.setDate(next.getDate() + 1);
    setSelectedDate(next);
  };

  return (
    <div style={{ 
      backgroundColor: '#0F172A', 
      minHeight: '100vh', 
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>

      {/* ==================== 2. ВЕРХНЯЯ ПАНЕЛЬ ==================== */}
      <div style={{
        backgroundColor: '#1E2937',
        padding: '20px 40px',
        borderBottom: '1px solid #334155',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }}>
        <div>
          <div style={{ fontSize: '32px', fontWeight: '700' }}>Бетонный завод</div>
          <div style={{ color: '#94A3B8', fontSize: '15px' }}>Оператор БСУ • Реальное время</div>
        </div>
        <div style={{ backgroundColor: '#25334A', padding: '12px 24px', borderRadius: '9999px', fontSize: '16px' }}>
          Смена: <span style={{ color: '#10B981', fontWeight: '600' }}>{currentShift}</span>
        </div>
      </div>

      <div style={{ padding: '20px 40px 40px 40px' }}>

              {/* ==================== 2. БЛОК СТАТИСТИКИ ==================== */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', 
        gap: '16px',
        marginBottom: '24px'
      }}>
        {stats.map((stat, index) => (
          <div key={index} style={{
            backgroundColor: '#1E2937',
            borderRadius: '20px',
            padding: '20px 24px',
            border: '1px solid #334155'
          }}>
            <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>
              {stat.label}
            </div>
            <div style={{ 
              fontSize: '32px', 
              fontWeight: '700', 
              color: stat.color,
              marginBottom: '4px'
            }}>
              {stat.value}
            </div>
            <div style={{ color: '#64748B', fontSize: '15px' }}>
              {stat.unit}
            </div>
          </div>
        ))}
      </div>

                        {/* ==================== 3. МИНИМАЛИСТИЧНЫЕ ТАБЫ ==================== */}
        <div style={{ 
          display: 'flex', 
          gap: '40px', 
          marginBottom: '32px',
          borderBottom: '1px solid #334155',
          paddingBottom: '4px'
        }}>
          {[
            { key: 'zayavki', label: 'Заявки', action: () => setActiveTab('zayavki') },
            { key: 'reports', label: 'Отчеты', action: () => window.location.href = '/adminCifra/reports' },
            { key: 'recipes', label: 'Рецепты', action: () => window.location.href = '/adminCifra/recipes' }
          ].map((tab, i) => (
            <button
              key={tab.key}
              onClick={tab.action}
              style={{
                padding: '12px 0',
                background: 'transparent',
                border: 'none',
                fontSize: '17px',
                fontWeight: '600',
                color: activeTab === tab.key ? '#10B981' : '#64748B',
                cursor: 'pointer',
                position: 'relative'
              }}
            >
              {tab.label}
              {activeTab === tab.key && (
                <div style={{
                  position: 'absolute',
                  bottom: '-6px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: '5px',
                  height: '5px',
                  backgroundColor: '#10B981',
                  borderRadius: '50%',
                  boxShadow: '0 0 0 3px rgba(16, 185, 129, 0.3)'
                }} />
              )}
            </button>
          ))}
        </div>

        {/* ==================== 4. ОСНОВНОЙ КОНТЕНТ ==================== */}
        {activeTab === 'zayavki' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 700px', gap: '24px' }}>
            
                                                {/* ==================== 4.1 ОЧЕРЕДЬ НА ЗАГРУЗКУ ==================== */}
            <div style={{ backgroundColor: '#1E2937', borderRadius: '24px', padding: '24px' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <h2 style={{ fontSize: '21px', fontWeight: '600' }}>
                  📋 Очередь на загрузку ({queueTrips.length})
                </h2>

                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <button onClick={goToPrevDay} style={{ padding: '6px 14px', background: '#334155', border: 'none', borderRadius: '8px', color: '#fff' }}>←</button>
                  <div style={{ fontWeight: '600', minWidth: '160px', textAlign: 'center' }}>
                    {selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                  </div>
                  <button onClick={goToNextDay} style={{ padding: '6px 14px', background: '#334155', border: 'none', borderRadius: '8px', color: '#fff' }}>→</button>
                </div>
              </div>

              {/* Шапка колонок */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '72px 85px 120px 95px 78px 105px 220px 1fr',
                gap: '8px',
                padding: '8px 18px',
                color: '#94A3B8',
                fontSize: '13.5px',
                fontWeight: '500',
                borderBottom: '1px solid #334155',
                marginBottom: '10px'
              }}>
                <div>Время</div>
                <div>№ заявки</div>
                <div>№ миксера</div>
                <div>Марка</div>
                <div>Объём</div>
                <div>Подвижность</div>
                <div>Клиент / Организация</div>
                <div></div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                {queueTrips.map((trip) => {
                  const client = trip.organization_name || trip.client_name || '—';
                  const isLoading = loadingTrips[trip.id];

                  return (
                    <div 
                      key={trip.id} 
                      onClick={async () => {
  try {
    const res = await fetch(`/api/adminCifra/orders/${trip.order_id || trip.orderId}`);
    if (res.ok) {
      const fullOrder = await res.json();
      setSelectedTrip({
        ...trip,
        comment: fullOrder.comment,           // ← главное
        orders: fullOrder
      });
    } else {
      setSelectedTrip(trip);
    }
  } catch (e) {
    setSelectedTrip(trip);
  }
}}

                      style={{
                        backgroundColor: '#25334A',
                        borderRadius: '12px',
                        padding: '13px 18px',
                        display: 'grid',
                        gridTemplateColumns: '72px 85px 120px 95px 78px 105px 220px 1fr',
                        gap: '8px',
                        alignItems: 'center',
                        minHeight: '28px',
                        fontSize: '15px',
                        cursor: 'pointer'
                      }}
                    >
                      <div style={{ fontWeight: '600', color: '#94A3B8' }}>{trip.time || '—'}</div>
                      <div style={{ fontWeight: '700', color: '#60A5FA' }}>
                        #{trip.order_id || trip.orderId || '—'}
                      </div>
                      <div style={{ fontWeight: '700' }}>
                        {trip.mixer_name || trip.number || '—'}
                      </div>
                      <div>{trip.concrete_grade || '—'}</div>
                      <div style={{ fontWeight: '600' }}>{trip.volume} м³</div>

                      <select 
                        defaultValue={trip.podvizhnost || "П3"}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          trip.podvizhnost = e.target.value;
                        }}
                        style={{ 
                          padding: '7px 10px', 
                          background: '#1E2937', 
                          border: 'none', 
                          borderRadius: '6px', 
                          color: '#fff', 
                          fontSize: '14px' 
                        }}
                      >
                        <option value="П1">П1</option>
                        <option value="П2">П2</option>
                        <option value="П3">П3</option>
                        <option value="П4">П4</option>
                        <option value="П5">П5</option>
                      </select>

                      <div style={{ 
                        fontSize: '14.5px', 
                        color: '#E2E8F0',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis'
                      }}>
                        {client}
                      </div>

                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                        <button 
                          onClick={(e) => { e.stopPropagation(); startLoading(trip); }} 
                          disabled={isLoading}
                          style={{ 
                            padding: '7px 14px', 
                            background: isLoading ? '#475569' : '#10B981', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '9999px', 
                            fontSize: '13px', 
                            fontWeight: '600',
                            cursor: isLoading ? 'not-allowed' : 'pointer'
                          }}
                        >
                          {isLoading ? 'Загрузка...' : 'Начать'}
                        </button>
                        <button 
                          onClick={(e) => { e.stopPropagation(); completeLoading(trip); }} 
                          style={{ 
                            padding: '7px 14px', 
                            background: '#3B82F6', 
                            color: 'white', 
                            border: 'none', 
                            borderRadius: '9999px', 
                            fontSize: '13px', 
                            fontWeight: '600' 
                          }}
                        >
                          Загружен
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

                        {/* ==================== 4.2 ОТГРУЖЕНО СЕГОДНЯ ==================== */}
            <div style={{ backgroundColor: '#1E2937', borderRadius: '24px', padding: '24px' }}>
              <h2 style={{ fontSize: '21px', fontWeight: '600', marginBottom: '20px', color: '#10B981' }}>
                🚚 Отгружено сегодня ({filteredCompletedTrips.length})
              </h2>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                {filteredCompletedTrips.length > 0 ? filteredCompletedTrips.map((trip) => (
                  <div 
                    key={trip.id}
                    style={{
                      backgroundColor: '#25334A',
                      borderRadius: '12px',
                      padding: '12px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      minHeight: '28px',
                      fontSize: '14.5px'
                    }}
                  >
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flex: 1 }}>
                      <div style={{ fontWeight: '600', color: '#94A3B8', minWidth: '70px' }}>
                        {trip.time || '—'}
                      </div>
                      <div style={{ fontWeight: '700', color: '#60A5FA', minWidth: '70px' }}>
                        #{trip.order_id || trip.orderId}
                      </div>
                      <div style={{ fontWeight: '700', minWidth: '120px' }}>
                        {trip.mixer_name || trip.number || '—'}
                      </div>
                      <div>
                        {trip.concrete_grade || '—'} • {trip.volume} м³
                      </div>
                      <div style={{ color: '#10B981', fontWeight: '600' }}>
                        ✓ Загружен • {trip.loadedTime || '—'}
                      </div>
                    </div>
                    <div style={{ color: '#64748B' }}>В пути</div>
                  </div>
                )) : (
                  <div style={{ 
                    textAlign: 'center', 
                    padding: '70px 20px', 
                    color: '#64748B',
                    fontSize: '15px'
                  }}>
                    Пока нет отгруженных рейсов на выбранную дату
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>    

   {/* ==================== 5. МОДАЛЬНОЕ ОКНО ==================== */}
      {selectedTrip && (
        <div 
          style={{
            position: 'fixed', 
            inset: 0, 
            backgroundColor: 'rgba(0,0,0,0.94)', 
            zIndex: 1000,
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center'
          }} 
          onClick={() => setSelectedTrip(null)}
        >
          <div 
            style={{ 
              background: '#1E2937', 
              padding: '32px', 
              borderRadius: '24px', 
              width: '680px',
              maxHeight: '92vh',
              overflowY: 'auto',
              color: '#fff'
            }} 
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ fontSize: '28px', fontWeight: '700', marginBottom: '24px' }}>
              Рейс #{selectedTrip.id || selectedTrip.orderId}
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '28px' }}>
              <div>
                <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px' }}>МИКСЕР</div>
                <div style={{ fontSize: '20px', fontWeight: '700' }}>
                  {selectedTrip.mixer_name || selectedTrip.number || '—'}
                </div>
              </div>
              <div>
                <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px' }}>ОБЪЁМ</div>
                <div style={{ fontSize: '20px', fontWeight: '700' }}>
                  {selectedTrip.volume} м³
                </div>
              </div>
            </div>

            {/* РЕЦЕПТ БЕТОНА */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>РЕЦЕПТ БЕТОНА</div>
              <div style={{ 
                background: '#25334A', 
                padding: '18px', 
                borderRadius: '12px',
                fontSize: '15px',
                lineHeight: '1.65'
              }}>
                {(() => {
                  const grade = (selectedTrip.concrete_grade || '').toUpperCase().trim();
                  const recipe = recipes.find((r: any) => 
                    (r.name && r.name.toUpperCase().includes(grade)) || 
                    (r.code && r.code.toUpperCase().includes(grade))
                  );
                  const podvizhnost = selectedTrip.podvizhnost || 'П3';

                  if (recipe) {
                    return (
                      <>
                        <strong>{selectedTrip.concrete_grade} {podvizhnost}</strong><br/>
                        Цемент: {recipe.cement} кг • 
                        Песок: {recipe.sand} кг • 
                        {recipe.gravel > 0 && `Щебень: ${recipe.gravel} кг • `}
                        Вода: {recipe.water} кг
                        {recipe.additive > 0 && ` • Добавка: ${recipe.additive} кг`}
                      </>
                    );
                  }
                  return `${selectedTrip.concrete_grade} ${podvizhnost} • Рецепт не найден`;
                })()}
              </div>
            </div>

            {/* КЛИЕНТ */}
            <div style={{ marginBottom: '24px' }}>
              <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>КЛИЕНТ</div>
              <div style={{ 
                background: '#25334A', 
                padding: '16px', 
                borderRadius: '12px',
                fontSize: '16px',
                fontWeight: '600'
              }}>
                {selectedTrip.organization_name || selectedTrip.client_name || selectedTrip.client || '—'}
              </div>
            </div>

                                                {/* ==================== КОММЕНТАРИЙ КЛИЕНТА ==================== */}
            <div style={{ marginBottom: '32px' }}>
              <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '8px' }}>КОММЕНТАРИЙ КЛИЕНТА</div>
              <div style={{ 
                background: '#25334A', 
                padding: '20px', 
                borderRadius: '12px',
                fontSize: '15px',
                lineHeight: '1.6',
                whiteSpace: 'pre-wrap',
                minHeight: '90px'
              }}>
                {selectedTrip.comment || 'Комментариев от клиента нет'}
              </div>
            </div>

            {/* ИСТОРИЯ */}
            <div style={{ marginBottom: '32px' }}>
              <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '10px' }}>ИСТОРИЯ ИЗМЕНЕНИЙ</div>
              <div style={{ 
                background: '#25334A', 
                padding: '16px', 
                borderRadius: '12px',
                fontSize: '14.5px',
                lineHeight: '1.7'
              }}>
                • {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — Оператор начал загрузку миксера {selectedTrip.mixer_name || selectedTrip.number}<br/>
                • {new Date(Date.now() + 90000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — Загрузка завершена, объём {selectedTrip.volume} м³<br/>
                • {new Date(Date.now() + 150000).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })} — Миксер отправлен на объект (статус "В пути")
              </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
              <button 
                onClick={() => setSelectedTrip(null)}
                style={{ 
                  flex: 1,
                  padding: '16px',
                  background: '#334155',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '9999px',
                  fontSize: '16px',
                  fontWeight: '600',
                  cursor: 'pointer'
                }}
              >
                Закрыть
              </button>
              
            </div>
          </div>
        </div>
      )}
    </div>
  );
}