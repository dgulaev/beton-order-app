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

  const showVisualNotification = (type: 'new' | 'update', orderData?: any) => {
    const message = type === 'new' ? 'Новая заявка!' : 'Заявка обновлена!';
    const emoji = type === 'new' ? '🔔' : '🔄';

    const notif = document.createElement('div');
    notif.style.cssText = `
      position: fixed;
      top: 24px;
      right: 24px;
      background: linear-gradient(135deg, #ef4444, #f97316);
      color: white;
      padding: 16px 20px;
      border-radius: 16px;
      z-index: 10000;
      font-weight: 600;
      box-shadow: 0 20px 40px rgba(239, 68, 68, 0.4);
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 280px;
      animation: slideIn 0.4s ease;
    `;
    notif.innerHTML = `
      <div style="font-size: 28px;">${emoji}</div>
      <div>
        <div style="font-size: 15px;">${message}</div>
        <div style="font-size: 13px; opacity: 0.9;">Проверьте раздел "Заявки"</div>
      </div>
    `;
    document.body.appendChild(notif);

    setTimeout(() => {
      notif.style.transition = 'all 0.4s ease';
      notif.style.opacity = '0';
      notif.style.transform = 'translateY(-20px)';
      setTimeout(() => notif.remove(), 400);
    }, 4500);
  };

  // ==================== 5. SUPABASE REALTIME (INSERT + UPDATE) ====================
  useEffect(() => {
    if (!userRole || !['admin', 'manager', 'dispatcher', 'operator'].includes(userRole)) return;

    const supabase = createClient();

    const channel = supabase
      .channel('realtime-orders')
      .on(
  'postgres_changes',
  { event: 'INSERT', schema: 'public', table: 'orders' },
  (payload) => {
    const newOrder = payload.new as any;
    
    setNewOrdersCount(prev => prev + 1);        // ← Главное изменение
    setLastNotificationId(newOrder.id);

    playNotificationSound();
    showVisualNotification('new', newOrder);
    triggerBellAnimation();

    console.log('🆕 Новая заявка! Счётчик =', newOrdersCount + 1);
  }
)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
        },
        (payload) => {
          const updatedOrder = payload.new as any;
          
          // Уведомляем только при важных изменениях (статус)
          playNotificationSound();
          showVisualNotification('update', updatedOrder);
          triggerBellAnimation();

          console.log('🔄 Заявка обновлена:', updatedOrder);
        }
      )
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userRole, lastNotificationId]);

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

            {/* ==================== 9. ПУНКТ "ЗАЯВКИ" С БЕЙДЖЕМ И КОЛОКОЛЬЧИКОМ ==================== */}
<div style={{ position: 'relative' }}>
  <Link 
    href="/adminCifra/zayavki" 
    style={navLinkStyle(isActive('/adminCifra/zayavki'), isCollapsed)}
    onClick={() => {
      setNewOrdersCount(0);           // ← Сброс счётчика при клике
    }}
  >
    <Package size={22} /> 
    {!isCollapsed && <span>Заявки</span>}
    
    {/* Анимированный колокольчик */}
    {newOrdersCount > 0 && (
      <Bell 
        size={18} 
        style={{ 
          marginLeft: '8px',
          color: '#fbbf24',
          animation: isBellAnimating ? 'bellRing 0.7s ease 4' : 'none'
        }} 
      />
    )}
  </Link>

  {/* Красный бейдж */}
  {newOrdersCount > 0 && (
    <div style={{
      position: 'absolute',
      top: '-8px',
      right: isCollapsed ? '-8px' : '8px',
      background: '#ef4444',
      color: 'white',
      fontSize: '12px',
      fontWeight: '700',
      minWidth: '20px',
      height: '20px',
      borderRadius: '9999px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '0 6px',
      border: '2px solid #1E2937',
      boxShadow: '0 0 0 3px rgba(239, 68, 68, 0.4)',
      zIndex: 10,
      cursor: 'pointer'
    }}
    onClick={(e) => {
      e.stopPropagation();
      setNewOrdersCount(0);
    }}
    >
      {newOrdersCount > 9 ? '9+' : newOrdersCount}
    </div>
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