'use client';

import { useState, useEffect } from 'react';
import Calendar from '../Calendar';
import { useCalendarOrders } from '../hooks/useCalendarOrders';

export default function AdminCifraDashboard() {
  // ==================== АУТЕНТИФИКАЦИЯ ====================
  const [userId, setUserId] = useState<number | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loadingRole, setLoadingRole] = useState(true);

  // ==================== ДАШБОРД ====================
  const [currentHourPercent, setCurrentHourPercent] = useState(42);
  const [showCalendar, setShowCalendar] = useState(false);

  const { orders } = useCalendarOrders(new Date().getFullYear(), new Date().getMonth());

  const today = new Date().toISOString().split('T')[0];
  const todayOrders = orders
    .filter((o: any) => o?.delivery_date === today)
    .sort((a: any, b: any) => (a.delivery_time || '00:00').localeCompare(b.delivery_time || '00:00'));

  // ==================== ЗАГРУЗКА userId ====================
  useEffect(() => {
    const saved = localStorage.getItem('userId');
    if (saved) setUserId(parseInt(saved, 10));
  }, []);

  // ==================== ЗАГРУЗКА РОЛИ ====================
  useEffect(() => {
    if (!userId) {
      setLoadingRole(false);
      return;
    }

    fetch('/api/user/role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    })
      .then(r => r.json())
      .then(data => {
        const role = data.role || 'client';
        setUserRole(role);
        console.log(`[Role Check] ${userId} → ${role}`);
      })
      .catch(() => setUserRole('client'))
      .finally(() => setLoadingRole(false));
  }, [userId]);

  // ==================== ТАЙМЛАЙН ====================
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const minutes = now.getHours() * 60 + now.getMinutes();
      const percent = (minutes / 1440) * 100;
      setCurrentHourPercent(Math.min(Math.max(percent, 3), 97));
    };
    updateTime();
    const interval = setInterval(updateTime, 60000);
    return () => clearInterval(interval);
  }, []);

  // ==================== ПРОВЕРКА ДОСТУПА ====================
  if (loadingRole) {
    return <div style={{ minHeight: '100vh', background: '#0F172A', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>Загрузка панели...</div>;
  }

  if (!userRole || !['admin', 'manager', 'dispatcher', 'operator'].includes(userRole)) {
    return (
      <div style={{ padding: '100px', textAlign: 'center', background: '#0F172A', color: '#94A3B8', minHeight: '100vh' }}>
        Нет доступа к дашборду.<br />Роль: <strong>{userRole}</strong>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: 'flex', backgroundColor: '#0F172A', padding: '32px', gap: '28px', overflow: 'hidden' }}>
      
      {/* Основная колонка */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        
        {/* Topbar */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '28px' }}>
            <h1 style={{ fontSize: '38px', fontWeight: '700', margin: 0 }}>РБУ ТрейдКом</h1>
            <div 
              onClick={() => setShowCalendar(true)}
              style={{ 
                background: '#1E2937', 
                padding: '10px 24px', 
                borderRadius: '9999px', 
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                fontSize: '15px'
              }}
            >
              📅 {new Date().toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
          </div>
          <div style={{ color: '#60A5FA', fontWeight: '500' }}>Роль: {userRole}</div>
        </div>

        {/* KPI — в стиле Цифра */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '36px' }}>
          <div style={{ background: '#1E2937', borderRadius: '20px', padding: '24px' }}>
            <div style={{ color: '#94A3B8', fontSize: '14px' }}>План сегодня</div>
            <div style={{ fontSize: '42px', fontWeight: '700', marginTop: '8px' }}>240 м³</div>
          </div>
          <div style={{ background: '#1E2937', borderRadius: '20px', padding: '24px' }}>
            <div style={{ color: '#94A3B8', fontSize: '14px' }}>Выполнено</div>
            <div style={{ fontSize: '42px', fontWeight: '700', color: '#10B981', marginTop: '8px' }}>192 м³</div>
            <div style={{ color: '#10B981', fontSize: '14px' }}>+80% от плана</div>
          </div>
          <div style={{ background: '#1E2937', borderRadius: '20px', padding: '24px' }}>
            <div style={{ color: '#94A3B8', fontSize: '14px' }}>Активные миксеры</div>
            <div style={{ fontSize: '42px', fontWeight: '700', marginTop: '8px' }}>4</div>
          </div>
          <div style={{ background: '#1E2937', borderRadius: '20px', padding: '24px' }}>
            <div style={{ color: '#94A3B8', fontSize: '14px' }}>ППРЗ</div>
            <div style={{ fontSize: '42px', fontWeight: '700', color: '#3B82F6', marginTop: '8px' }}>87%</div>
          </div>
        </div>

        {/* Основной Таймлайн / Gantt */}
        <div style={{ flex: 1, background: '#1E2937', borderRadius: '24px', padding: '28px', border: '1px solid #334155', position: 'relative' }}>
          <h2 style={{ fontSize: '26px', marginBottom: '24px' }}>График отгрузок на сегодня</h2>

          <div style={{ position: 'relative' }}>
            {todayOrders.length > 0 ? (
              todayOrders.map((order: any) => {
                const client = order.organization_name || order.full_name || '—';
                const time = order.delivery_time || '00:00';
                const [h, m] = time.split(':').map(Number);
                const leftPercent = ((h * 60 + m) / 1440) * 100;
                const widthPercent = Math.min(Math.max((order.volume || 10) * 1.8, 8), 35);

                const statusColor = 
                  order.status === 'completed' ? '#10B981' : 
                  order.status === 'processing' ? '#3B82F6' : '#FACC15';

                return (
                  <div key={order.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    marginBottom: '14px',
                    background: '#25334A',
                    borderRadius: '16px',
                    padding: '16px 20px',
                    position: 'relative'
                  }}>
                    <div style={{ width: '110px', fontWeight: '600', fontSize: '17px' }}>{time}</div>
                    
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '600' }}>#{order.id} — {client}</div>
                      <div style={{ color: '#94A3B8', fontSize: '14px' }}>{order.grade} • {order.volume} м³</div>
                    </div>

                    <div style={{
                      position: 'absolute',
                      left: `${leftPercent}%`,
                      width: `${widthPercent}%`,
                      height: '42px',
                      background: statusColor,
                      borderRadius: '9999px',
                      display: 'flex',
                      alignItems: 'center',
                      paddingLeft: '16px',
                      color: '#fff',
                      fontWeight: '600',
                      fontSize: '14px',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.3)'
                    }}>
                      {order.status === 'completed' ? '✓ Выполнена' : order.status === 'processing' ? '→ В пути' : 'Новый'}
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={{ textAlign: 'center', padding: '80px 0', color: '#64748B' }}>На сегодня заказов нет</div>
            )}
          </div>

          {/* Текущая вертикальная линия времени */}
          <div style={{
            position: 'absolute',
            left: `${currentHourPercent}%`,
            top: '90px',
            bottom: '40px',
            width: '3px',
            background: 'linear-gradient(#3B82F6, #60A5FA)',
            boxShadow: '0 0 15px #3B82F6',
            zIndex: 20,
            pointerEvents: 'none'
          }} />
        </div>
      </div>

      {/* Правая колонка — Миксеры */}
      <div style={{ width: '420px', background: '#1E2937', borderRadius: '24px', padding: '28px', display: 'flex', flexDirection: 'column' }}>
        <h3 style={{ fontSize: '24px', marginBottom: '24px' }}>🚛 Миксеры в работе</h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', flex: 1 }}>
          {/* Пример 1 */}
          <div style={{ background: '#334155', borderRadius: '18px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <strong>SHACMAN e834pp750</strong>
              <span style={{ color: '#10B981' }}>11:45</span>
            </div>
            <div style={{ color: '#CBD5E1' }}>19 м³ • ООО "Стройка"</div>
            <div style={{ marginTop: '16px', color: '#10B981', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '10px', height: '10px', background: '#10B981', borderRadius: '50%' }} /> На объекте • 26 мин
            </div>
          </div>

          {/* Пример 2 */}
          <div style={{ background: '#334155', borderRadius: '18px', padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <strong>KAMAZ e746on750</strong>
              <span style={{ color: '#3B82F6' }}>12:10</span>
            </div>
            <div style={{ color: '#CBD5E1' }}>12 м³ • ИП Василенко</div>
            <div style={{ marginTop: '16px', color: '#3B82F6', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{ width: '10px', height: '10px', background: '#3B82F6', borderRadius: '50%' }} /> В пути
            </div>
          </div>
        </div>

        <button style={{ marginTop: 'auto', padding: '18px', background: '#3B82F6', color: 'white', border: 'none', borderRadius: '9999px', fontSize: '17px', fontWeight: '600' }}>
          📍 Показать все миксеры на карте
        </button>
      </div>

      {/* Модалка календаря */}
      {showCalendar && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.9)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => setShowCalendar(false)}>
          <div onClick={e => e.stopPropagation()}>
            <Calendar onClose={() => setShowCalendar(false)} />
          </div>
        </div>
      )}
    </div>
  );
}