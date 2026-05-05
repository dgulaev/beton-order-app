'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import { createClient } from '../../utils/supabase/client';

interface Order {
  id: string;
  organization_name?: string;
  full_name?: string;
  client_name?: string;
  volume?: number;
  delivery_date?: string;
  delivery_time?: string;
  address?: string;
  phone?: string;
  status?: string;
  vehicle?: string;
  driver?: string;
  total_price?: number;
  concrete_cost?: number;
  delivery_cost?: number;
  comment?: string;
}

interface Shipment extends Order {
  tripId: string;
  tripNumber: number;
  totalTrips: number;
  tripVolume: number;
  tripStartHour: number;
  loadingMinutes: number;
}

export default function CifraSchedulePage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [shipments, setShipments] = useState<Shipment[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Shipment | null>(null);
  const [currentHourPercent, setCurrentHourPercent] = useState(50);
  const [zoomLevel, setZoomLevel] = useState(1.0);

  // Создаём клиент ТОЛЬКО после монтирования компонента
  const [supabase] = useState(() => createClient());

  // Загрузка заказов
  useEffect(() => {
    async function fetchTodayOrders() {
      setLoading(true);
      const today = new Date().toISOString().split('T')[0];

      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('delivery_date', today)
        .order('id', { ascending: true });

      if (error) console.error(error);
      else setOrders(data || []);
      
      setLoading(false);
    }

    fetchTodayOrders();
  }, [supabase]);

  // Разбиение заказов на рейсы
  useEffect(() => {
    const TRIP_VOLUME = 10;
    const allShipments: Shipment[] = [];

    orders.forEach((order) => {
      const totalVolume = order.volume || 0;
      if (totalVolume <= 0) return;

      const trips = Math.max(1, Math.ceil(totalVolume / TRIP_VOLUME));
      let currentTime = getHour(order.delivery_time);

      for (let i = 0; i < trips; i++) {
        const tripVolume = i === trips - 1 
          ? totalVolume - (trips - 1) * TRIP_VOLUME 
          : TRIP_VOLUME;

        const loadingMinutes = tripVolume * 2;

        allShipments.push({
          ...order,
          tripId: `${order.id}-${i + 1}`,
          tripNumber: i + 1,
          totalTrips: trips,
          tripVolume,
          tripStartHour: currentTime,
          loadingMinutes
        });

        currentTime += loadingMinutes / 60;
      }
    });

    setShipments(allShipments);
  }, [orders]);

  const getHour = (timeStr?: string) => {
    if (!timeStr) return 12;
    const [hour] = timeStr.split(':').map(Number);
    return hour || 12;
  };

  const getClient = (o: any) => 
    o.organization_name || o.full_name || o.client_name || 'Клиент';

  // Обновление текущего времени
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const totalMinutes = now.getHours() * 60 + now.getMinutes();
      const percent = (totalMinutes / 1440) * 100;
      setCurrentHourPercent(Math.min(Math.max(percent, 2), 98));
    };

    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, []);

  const updateTripVolume = (tripId: string, newVolume: number) => {
    if (newVolume <= 0) return;

    setShipments(prev => prev.map(s => 
      s.tripId === tripId 
        ? { ...s, tripVolume: newVolume, loadingMinutes: newVolume * 2 } 
        : s
    ));

    if (selected && selected.tripId === tripId) {
      setSelected({ 
        ...selected, 
        tripVolume: newVolume, 
        loadingMinutes: newVolume * 2 
      });
    }
  };

  if (loading) {
    return <div style={{ padding: '80px', textAlign: 'center', fontSize: '24px', color: '#fff' }}>Загрузка расписания...</div>;
  }

  return (
    <div style={{ 
      padding: '32px', 
      backgroundColor: '#0F172A', 
      minHeight: '100vh', 
      color: '#fff',
      width: '100%'
    }}>
      <div style={{ maxWidth: '100%', margin: '0 auto' }}>
        
        {/* Заголовок */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div>
            <h1 style={{ fontSize: '38px', fontWeight: '700' }}>Диспетчеризация завода</h1>
            <p style={{ color: '#94A3B8', fontSize: '19px', marginTop: '4px' }}>
              Сегодня — {new Date().toLocaleDateString('ru-RU')} • Завод Мека 100 м³.час
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button style={{ padding: '14px 32px', backgroundColor: '#3B82F6', color: '#fff', border: 'none', borderRadius: '9999px', fontSize: '17px' }}>
              Авто-распределение
            </button>
            <button style={{ padding: '14px 32px', backgroundColor: '#fff', color: '#000', border: 'none', borderRadius: '9999px', fontSize: '17px' }}>
              Печать всех документов
            </button>
          </div>
        </div>

        {/* Таймлайн */}
        <div 
          id="timeline-container"
          style={{ 
            backgroundColor: '#1E2937', 
            borderRadius: '20px', 
            padding: '32px', 
            border: '1px solid #334155', 
            position: 'relative',
            width: '100%',
            overflow: 'hidden'
          }}
          onWheel={(e) => {
            e.preventDefault();
            const delta = e.deltaY > 0 ? 0.9 : 1.1;
            setZoomLevel(prev => Math.max(0.5, Math.min(3, prev * delta)));
          }}
        >
          {/* Шапка с часами */}
          <div style={{ 
            display: 'grid', 
            gridTemplateColumns: 'repeat(24, 1fr)', 
            textAlign: 'center', 
            color: '#94A3B8', 
            marginBottom: '24px',
            width: '100%',
            fontSize: '14px',
            userSelect: 'none'
          }}>
            {Array.from({ length: 24 }, (_, i) => <div key={i}>{i}:00</div>)}
          </div>

          {/* Область таймлайна */}
          <div 
            style={{ 
              position: 'relative', 
              height: '820px', 
              border: '2px dashed #475569', 
              borderRadius: '16px', 
              backgroundColor: '#111827',
              width: '100%',
              overflow: 'hidden',
              cursor: 'grab'
            }}
          >
            {shipments.map((shipment) => {
              const left = (shipment.tripStartHour / 24) * 100 * zoomLevel;
              const width = Math.max(6, (shipment.tripVolume || 10) / 3.2 * zoomLevel);

              const rowIndex = orders.findIndex(o => o.id === shipment.id);
              const topPosition = 80 + rowIndex * 160;

              return (
                <div
                  key={shipment.tripId}
                  onClick={() => setSelected(shipment)}
                  style={{
                    position: 'absolute',
                    left: `${left}%`,
                    width: `${width}%`,
                    top: `${topPosition}px`,
                    height: '78px',
                    backgroundColor: '#10b981',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '0 20px',
                    color: '#fff',
                    cursor: 'pointer',
                    boxShadow: '0 6px 16px rgba(0,0,0,0.4)',
                    transition: 'left 0.1s ease, width 0.1s ease',
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: '700', fontSize: '18px' }}>
                      #{shipment.id} ({shipment.tripNumber}/{shipment.totalTrips})
                    </div>
                    <div style={{ fontSize: '14px' }}>{getClient(shipment)}</div>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: '15px', lineHeight: '1.3' }}>
                    <div>{shipment.tripVolume} м³</div>
                    <div style={{ fontSize: '13px', opacity: 0.9 }}>{shipment.vehicle || '—'}</div>
                    <div style={{ fontSize: '13px', opacity: 0.9 }}>{shipment.driver || '—'}</div>
                  </div>
                </div>
              );
            })}

            {/* Вертикальная линия + текущее время */}
            <div style={{
              position: 'absolute',
              left: `${currentHourPercent * zoomLevel}%`,
              top: '0',
              bottom: '0',
              width: '3px',
              backgroundColor: '#3B82F6',
              boxShadow: '0 0 12px #3B82F6',
              zIndex: 30,
              transition: 'left 0.1s ease'
            }} />

            <div style={{
              position: 'absolute',
              left: `${currentHourPercent * zoomLevel}%`,
              bottom: '-32px',
              transform: 'translateX(-50%)',
              backgroundColor: '#1E2937',
              padding: '6px 16px',
              borderRadius: '9999px',
              fontSize: '15px',
              fontWeight: '700',
              color: '#3B82F6',
              zIndex: 35,
              border: '2px solid #3B82F6',
              transition: 'left 0.1s ease'
            }}>
              {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
        </div>
      </div>

      {/* Модалка */}
      {selected && (
        <div 
          style={{ 
            position: 'fixed', 
            inset: 0, 
            backgroundColor: 'rgba(0,0,0,0.92)', 
            zIndex: 1000, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center' 
          }} 
          onClick={() => setSelected(null)}
        >
          <div 
            style={{ 
              backgroundColor: '#1A2332', 
              width: '100%', 
              maxWidth: '560px', 
              borderRadius: '20px', 
              overflow: 'hidden' 
            }} 
            onClick={e => e.stopPropagation()}
          >
            <div style={{ padding: '24px 32px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '28px', fontWeight: '700' }}>Заказ #{selected.id}</h2>
              <div style={{ backgroundColor: '#eab308', color: '#000', padding: '6px 18px', borderRadius: '9999px', fontSize: '15px', fontWeight: '600' }}>
                {selected.status === 'new' ? 'Новый' : selected.status || 'В работе'}
              </div>
            </div>

            <div style={{ padding: '28px 32px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px 40px', fontSize: '16px' }}>
                <div>
                  <div style={{ color: '#94A3B8', marginBottom: '4px' }}>Дата доставки:</div>
                  <div>{selected.delivery_date}</div>
                </div>
                <div>
                  <div style={{ color: '#94A3B8', marginBottom: '4px' }}>Время доставки:</div>
                  <div>{selected.delivery_time}</div>
                </div>

                <div>
                  <div style={{ color: '#94A3B8', marginBottom: '4px' }}>Клиент:</div>
                  <div>{getClient(selected)}</div>
                </div>
                <div>
                  <div style={{ color: '#94A3B8', marginBottom: '4px' }}>Телефон:</div>
                  <div>{selected.phone || '—'}</div>
                </div>

                <div style={{ gridColumn: '1 / -1' }}>
                  <div style={{ color: '#94A3B8', marginBottom: '4px' }}>Адрес:</div>
                  <div>{selected.address || '—'}</div>
                </div>

                <div>
                  <div style={{ color: '#94A3B8', marginBottom: '4px' }}>Кубов в этом рейсе:</div>
                  <input
                    type="number"
                    value={selected.tripVolume}
                    onChange={(e) => {
                      const newVol = parseFloat(e.target.value);
                      if (!isNaN(newVol) && newVol > 0) {
                        updateTripVolume(selected.tripId, newVol);
                      }
                    }}
                    style={{ 
                      background: '#334155', 
                      color: '#fff', 
                      border: 'none', 
                      padding: '10px', 
                      borderRadius: '8px', 
                      width: '120px', 
                      fontSize: '18px' 
                    }}
                  />
                </div>

                <div>
                  <div style={{ color: '#94A3B8', marginBottom: '4px' }}>Время загрузки:</div>
                  <div style={{ fontWeight: '600' }}>{(selected.tripVolume * 2).toFixed(0)} минут</div>
                </div>

                <div>
                  <div style={{ color: '#94A3B8', marginBottom: '4px' }}>Миксер:</div>
                  <div>{selected.vehicle || '—'}</div>
                </div>
                <div>
                  <div style={{ color: '#94A3B8', marginBottom: '4px' }}>Водитель:</div>
                  <div>{selected.driver || '—'}</div>
                </div>
              </div>

              <div style={{ marginTop: '32px', backgroundColor: '#25334A', borderRadius: '16px', padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>Стоимость бетона</div>
                  <div>{selected.concrete_cost ? selected.concrete_cost.toLocaleString() : '—'} ₽</div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>Стоимость доставки</div>
                  <div>{selected.delivery_cost ? selected.delivery_cost.toLocaleString() : '—'} ₽</div>
                </div>
                <div style={{ borderTop: '1px solid #475569', paddingTop: '12px', display: 'flex', justifyContent: 'space-between', fontSize: '19px', fontWeight: '700' }}>
                  <div>Общая стоимость</div>
                  <div style={{ color: '#10b981' }}>
                    {selected.total_price ? selected.total_price.toLocaleString() : '—'} ₽
                  </div>
                </div>
              </div>
            </div>

            <div style={{ padding: '0 32px 32px' }}>
              <button 
                onClick={() => setSelected(null)}
                style={{ 
                  width: '100%', 
                  padding: '18px', 
                  backgroundColor: '#3B82F6', 
                  color: '#fff', 
                  border: 'none', 
                  borderRadius: '9999px', 
                  fontSize: '18px', 
                  fontWeight: '600' 
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