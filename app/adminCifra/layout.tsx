'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, FlaskConical, Truck, Package, Users, UserCog, DollarSign, Menu, X, Bell } from 'lucide-react';
import { useEffect, useState, useRef } from 'react';
import { createClient } from '@/app/utils/supabase/client';

export default function AdminCifraLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (path: string) => pathname === path;

  // ==================== 1. ОСНОВНЫЕ СОСТОЯНИЯ ====================
  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(true);

  // ==================== 2. СОСТОЯНИЯ УВЕДОМЛЕНИЙ ====================
  const [newOrdersCount, setNewOrdersCount] = useState(0);
  const [lastNotificationId, setLastNotificationId] = useState<number | null>(null);
  const [isBellAnimating, setIsBellAnimating] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  // ==================== 3. ПРОВЕРКА РОЛИ ====================
  useEffect(() => {
    const savedUserId = localStorage.getItem('userId');
    if (!savedUserId) {
      setLoading(false);
      return;
    }

    fetch('/api/user/role', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: parseInt(savedUserId) }),
    })
      .then(res => res.json())
      .then(data => setUserRole(data.role || 'client'))
      .catch(() => setUserRole('client'))
      .finally(() => setLoading(false));
  }, []);
  // ==================== 3.1 ОЧИСТКА СТАРЫХ ЗАКРЫТЫХ УВЕДОМЛЕНИЙ ====================
  useEffect(() => {
  const closed = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
  if (closed.length > 50) {
    localStorage.setItem('closedNotifications', JSON.stringify(closed.slice(-30)));
   }
  }, []);

  // ==================== 4. ИНИЦИАЛИЗАЦИЯ ЗВУКА ====================
  useEffect(() => {
    audioRef.current = new Audio('/sounds/new-order.mp3');
    audioRef.current.volume = 0.75;
  }, []);

  const playNotificationSound = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(err => console.log('Sound play error:', err));
    }
  };

  const triggerBellAnimation = () => {
    setIsBellAnimating(true);
    setTimeout(() => setIsBellAnimating(false), 2500);
  };

 // ==================== БЛОК 4.1 УЛУЧШЕННОЕ ВСПЛЫВАЮЩЕЕ УВЕДОМЛЕНИЕ ====================
const showVisualNotification = (type: 'new' | 'status' | 'volume' | 'datetime', orderData?: any, oldData?: any) => {
  const orderId = orderData?.id || '—';

  let title = '';
  let message = '';
  let emoji = '';

  if (type === 'new') {
    emoji = '🆕';
    title = 'Новая заявка!';
    // Добавляем дату доставки
    const deliveryDate = orderData?.delivery_date 
      ? new Date(orderData.delivery_date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) 
      : '';
    
    message = `№${orderId} — ${orderData?.grade || ''} — ${orderData?.volume || ''} м³`;
    if (deliveryDate) {
      message += ` — на ${deliveryDate}`;
    }
  } 
  else if (type === 'status') {
    emoji = '🔄';
    title = 'Статус изменён';
    const statusText = 
      orderData?.status === 'processing' ? 'В работе' :
      orderData?.status === 'completed' ? 'Выполнена' :
      orderData?.status === 'cancelled' ? 'Отменена' : orderData?.status || '—';
    message = `Заявка №${orderId} → ${statusText}`;
  } 
  else if (type === 'volume') {
    emoji = '📦';
    title = 'Изменён объём';
    message = `Заявка №${orderId} — было ${oldData?.volume || '?'} → стало ${orderData?.volume} м³`;
  } 
  else if (type === 'datetime') {
    emoji = '🕒';
    title = 'Изменены дата и время';
    message = `Заявка №${orderId} — ${orderData?.delivery_date} ${orderData?.delivery_time || ''}`;
  }

  const notif = document.createElement('div');
  notif.style.cssText = `
    position: fixed;
    top: 24px;
    right: 24px;
    background: linear-gradient(135deg, #22c55e, #86efac);
    color: #0f172a;
    padding: 16px 22px;
    border-radius: 16px;
    z-index: 10000;
    font-weight: 600;
    box-shadow: 0 20px 40px rgba(34, 197, 94, 0.45);
    display: flex;
    align-items: center;
    gap: 14px;
    min-width: 380px;   /* чуть шире из-за даты */
    cursor: pointer;
  `;

  notif.innerHTML = `
    <div style="font-size: 34px;">${emoji}</div>
    <div style="flex: 1;">
      <div style="font-size: 16px; font-weight: 700;">${title}</div>
      <div style="font-size: 14px; opacity: 0.92;">${message}</div>
    </div>
    <div style="font-size: 24px; opacity: 0.75; cursor: pointer; padding: 4px 8px;" class="close-btn">✕</div>
  `;

  const closeBtn = notif.querySelector('.close-btn') as HTMLElement;

  const closeNotification = () => {
    notif.remove();
    const closed = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
    if (!closed.includes(orderId)) {
      closed.push(orderId);
      localStorage.setItem('closedNotifications', JSON.stringify(closed));
    }
    setNewOrdersCount(prev => Math.max(0, prev - 1));
  };

  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      closeNotification();
    });
  }

  notif.addEventListener('click', (e) => {
    if (e.target !== closeBtn) {
      window.location.href = '/adminCifra/zayavki';
      closeNotification();
    }
  });

  document.body.appendChild(notif);
};

 // ==================== БЛОК 5. УЛУЧШЕННЫЙ POLLING (4 ТИПА УВЕДОМЛЕНИЙ) ====================
useEffect(() => {
  if (!userRole || !['admin', 'manager', 'dispatcher', 'operator'].includes(userRole)) {
    return;
  }

  console.log(`✅ Polling (4 типа) запущен для роли: ${userRole}`);

  let lastOrderCount = 0;
  let lastKnownData: Record<number, any> = {}; // сохраняем предыдущие данные заявки

  const checkOrders = async () => {
    try {
      const res = await fetch('/api/adminCifra/all-orders', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });

      if (!res.ok) return;

      const data = await res.json();
      const orders = data.orders || data || [];

      // === 1. Новые заявки ===
      if (orders.length > lastOrderCount) {
        const newCount = orders.length - lastOrderCount;
        console.log(`🆕 Новых заявок: ${newCount}`);

        setNewOrdersCount(prev => prev + newCount);
        playNotificationSound();
        showVisualNotification('new', orders[0]);
        triggerBellAnimation();
      }

      // === 2,3,4. Изменения в существующих заявках ===
      orders.forEach((order: any) => {
        const prev = lastKnownData[order.id];

        if (prev) {
          // Изменение статуса
          if (prev.status !== order.status) {
            console.log(`🔄 Изменение статуса #${order.id}`);
            playNotificationSound();
            showVisualNotification('status', order);
            triggerBellAnimation();
          }

          // Изменение объёма
          if (prev.volume !== order.volume) {
            console.log(`📦 Изменение объёма #${order.id}`);
            playNotificationSound();
            showVisualNotification('volume', order, prev);
            triggerBellAnimation();
          }

          // Изменение даты/времени
          if (prev.delivery_date !== order.delivery_date || prev.delivery_time !== order.delivery_time) {
            console.log(`🕒 Изменение даты/времени #${order.id}`);
            playNotificationSound();
            showVisualNotification('datetime', order);
            triggerBellAnimation();
          }
        }

        // Сохраняем текущие данные
        lastKnownData[order.id] = { ...order };
      });

      lastOrderCount = orders.length;

    } catch (err) {
      console.warn('Polling error:', err);
    }
  };

  const initialTimer = setTimeout(checkOrders, 1500);
  const interval = setInterval(checkOrders, 5000);

  return () => {
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}, [userRole]);

  // ==================== 6. СБРОС СЧЁТЧИКА ====================
  useEffect(() => {
    if (pathname === '/adminCifra/zayavki') {
      setNewOrdersCount(0);
    }
  }, [pathname]);

  if (loading) {
    return <div style={{ padding: '100px', textAlign: 'center', background: '#0F172A', color: '#94A3B8', minHeight: '100vh' }}>Загрузка...</div>;
  }

  const allowedRoles = ['admin', 'manager', 'dispatcher', 'operator'];
  if (!userRole || !allowedRoles.includes(userRole)) {
    return <div style={{ padding: '100px', textAlign: 'center', background: '#0F172A', color: '#94A3B8' }}>Доступ запрещён</div>;
  }

  // ==================== 7. ГЛОБАЛЬНЫЙ МАСШТАБ ====================
  const getGlobalScale = () => {
    const width = window.innerWidth;
    if (width >= 2560) return 1.00;
    if (width >= 1920) return 0.82;
    if (width >= 1680) return 0.79;
    if (width >= 1440) return 0.77;
    return 0.74;
  };

  const scale = getGlobalScale();

  return (
    <div style={{ 
      transform: `scale(${scale})`, 
      transformOrigin: 'top left',
      width: `${100 / scale}%`,
      height: `${100 / scale}%`,
      overflow: 'hidden',
      minHeight: '100vh'
    }}>
      <div style={{ 
        display: 'flex', 
        minHeight: '100vh', 
        backgroundColor: '#0F172A',
        color: '#fff'
      }}>
        
        {/* ==================== 8. СВОРАЧИВАЕМОЕ МЕНЮ ==================== */}
        <div style={{
          width: isCollapsed ? '72px' : '280px',
          backgroundColor: '#1E2937',
          color: '#fff',
          padding: '24px 12px',
          display: 'flex',
          flexDirection: 'column',
          borderRight: '1px solid #334155',
          transition: 'width 0.3s ease',
          flexShrink: 0,
          overflow: 'hidden'
        }}>
          
          {/* Кнопка сворачивания */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'flex-end', 
            marginBottom: '20px',
            paddingRight: '8px'
          }}>
            <button 
              onClick={() => setIsCollapsed(!isCollapsed)}
              style={{
                background: 'none',
                border: 'none',
                color: '#94A3B8',
                cursor: 'pointer',
                padding: '8px',
                borderRadius: '8px'
              }}
            >
              {isCollapsed ? <Menu size={24} /> : <X size={24} />}
            </button>
          </div>

          {/* Логотип */}
          <div style={{ padding: '0 12px', marginBottom: '40px', textAlign: isCollapsed ? 'center' : 'left' }}>
            <h1 style={{ fontSize: isCollapsed ? '22px' : '28px', fontWeight: '700' }}>
              {isCollapsed ? 'РБ' : 'РБУ ТрейдКом'}
            </h1>
            {!isCollapsed && <p style={{ fontSize: '13px', color: '#64748B' }}>Цифра • Диспетчеризация</p>}
          </div>

          <nav style={{ flex: 1 }}>
            <Link href="/adminCifra/dashboard" style={navLinkStyle(isActive('/adminCifra/dashboard'), isCollapsed)}>
              <Home size={22} /> {!isCollapsed && <span>Дашборд</span>}
            </Link>

            {/* ==================== БЛОК 9: ПУНКТ МЕНЮ "ЗАЯВКИ" ==================== */}
<div style={{ position: 'relative' }}>
  <Link 
    href="/adminCifra/zayavki" 
    style={navLinkStyle(isActive('/adminCifra/zayavki'), isCollapsed)}
    onClick={() => setNewOrdersCount(0)}
  >
    <Package size={22} /> 
    {!isCollapsed && <span>Заявки</span>}
  </Link>

  {newOrdersCount > 0 && (
    <>
      {/* Бейдж */}
      <div style={{
        position: 'absolute',
        top: isCollapsed ? '-9px' : '-6px',
        right: isCollapsed ? '-6px' : '8px',
        background: '#ef4444',
        color: 'white',
        fontSize: '11px',
        fontWeight: '700',
        minWidth: '20px',
        height: '20px',
        borderRadius: '9999px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 6px',
        border: '2px solid #1E2937',
        boxShadow: '0 0 0 3px rgba(239, 68, 68, 0.5)',
        zIndex: 30,
        cursor: 'pointer'
      }}
      onClick={(e) => {
        e.stopPropagation();
        setNewOrdersCount(0);
      }}
      >
        {newOrdersCount > 9 ? '9+' : newOrdersCount}
      </div>

      {/* Колокольчик — улучшенное позиционирование */}
      <Bell 
        size={18} 
        style={{ 
          position: 'absolute',
          top: isCollapsed ? '9px' : '13px',
          right: isCollapsed ? '2px' : '12px',
          color: '#fbbf24',
          animation: isBellAnimating ? 'bellRing 0.7s ease 4' : 'none',
          zIndex: 25
        }} 
      />
    </>
  )}
</div>

            {/* ЗАКОММЕНТИРОВАНО */}
            {/* 
            <Link href="/adminCifra/orders" style={navLinkStyle(isActive('/adminCifra/orders'), isCollapsed)}>
              <Package size={22} /> {!isCollapsed && <span>Все заказы</span>}
            </Link>
            */}

            <Link href="/adminCifra/recipes" style={navLinkStyle(isActive('/adminCifra/recipes'), isCollapsed)}>
              <FlaskConical size={22} /> {!isCollapsed && <span>Рецепты</span>}
            </Link>

            <Link href="/adminCifra/mixers" style={navLinkStyle(isActive('/adminCifra/mixers'), isCollapsed)}>
              <Truck size={22} /> {!isCollapsed && <span>Миксеры</span>}
            </Link>

            <Link href="/adminCifra/clients" style={navLinkStyle(isActive('/adminCifra/clients'), isCollapsed)}>
              <Users size={22} /> {!isCollapsed && <span>Клиенты</span>}
            </Link>

            <Link href="/adminCifra/operator" style={navLinkStyle(isActive('/adminCifra/operator'), isCollapsed)}>
              <UserCog size={22} /> {!isCollapsed && <span>Оператор БСУ</span>}
            </Link>

            {(userRole === 'admin') && (
              <Link href="/adminCifra/withdrawals" style={navLinkStyle(isActive('/adminCifra/withdrawals'), isCollapsed)}>
                <DollarSign size={22} /> {!isCollapsed && <span>Выводы наличных</span>}
              </Link>
            )}
          </nav>
        </div>

        {/* ==================== 10. ОСНОВНОЙ КОНТЕНТ ==================== */}
        <div style={{ 
          flex: 1, 
          overflow: 'auto', 
          padding: '20px 32px', 
          minHeight: '80vh',
          backgroundColor: '#0F172A',
          ...(pathname === '/adminCifra/zayavki' && {
            padding: '20px 40px',
            minHeight: '920px',
            overflow: 'visible'
          })
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ==================== 11. СТИЛЬ ДЛЯ ССЫЛОК ====================
const navLinkStyle = (active: boolean, collapsed: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  padding: '14px 16px',
  borderRadius: '12px',
  backgroundColor: active ? '#3B82F6' : 'transparent',
  color: active ? '#fff' : '#94A3B8',
  marginBottom: '6px',
  textDecoration: 'none',
  fontSize: '16px',
  fontWeight: '500' as const,
  justifyContent: collapsed ? 'center' : 'flex-start',
  transition: 'all 0.2s',
});