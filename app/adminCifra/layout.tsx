'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, FlaskConical, Truck, Package, Users, UserCog, DollarSign, Menu, X, Bell, CheckCircle } from 'lucide-react';


// === ИСПРАВЛЕННЫЙ ИМПОРТ REACT ===
import { useEffect, useState, useRef } from 'react';

import { createClient } from '@/app/utils/supabase/client';
import Image from 'next/image';

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

// ==================== 2.1 СОСТОЯНИЕ УВЕДОМЛЕНИЙ ПО КЛИЕНТАМ ====================
const [clientReminders, setClientReminders] = useState<any[]>([]);

const audioRef = useRef<HTMLAudioElement | null>(null);

// Для удобного тестирования в консоли
useEffect(() => {
  (window as any).showVisualNotification = showVisualNotification;
  console.log('✅ window.showVisualNotification доступна');
}, []);

// Для тестирования звука в консоли
  useEffect(() => {
    (window as any).playNotificationSound = playNotificationSound;
    console.log('✅ playNotificationSound доступна в консоли');
  }, []);

// ==================== 2.2 ИНИЦИАЛИЗАЦИЯ ЗВУКА ====================
useEffect(() => {
  audioRef.current = new Audio('/sounds/new-order.mp3');
  if (audioRef.current) {
    audioRef.current.volume = 0.9;
  }
}, []);

const playNotificationSound = () => {
  const audio = audioRef.current;
  if (!audio) return;

  audio.currentTime = 0;
  audio.play().catch((err) => {
    console.log('Звук заблокирован браузером (нормально):', err.message);
  });
};
  

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


  // ==================== 4.2 УВЕДОМЛЕНИЕ ПО КЛИЕНТУ (НОВЫЙ БЛОК) ====================
  const showClientReminder = (client: any) => {
    const closed = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
    const key = `client-reminder-${client.groupId || client.user_id}`;

    if (closed.includes(key)) return;

    const notif = document.createElement('div');
    notif.style.cssText = `
      position: fixed;
      top: 90px;
      right: 24px;
      background: linear-gradient(135deg, #f59e0b, #fbbf24);
      color: #0f172a;
      padding: 18px 24px;
      borderRadius: 16px;
      z-index: 10000;
      box-shadow: 0 20px 40px rgba(245, 158, 11, 0.4);
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 420px;
      cursor: pointer;
    `;

    notif.innerHTML = `
      <div style="font-size: 36px;">📞</div>
      <div style="flex: 1;">
        <div style="font-size: 17px; font-weight: 700;">Пора позвонить клиенту!</div>
        <div style="font-size: 15px; margin-top: 4px;">
          ${client.organization_name || client.full_name || 'Клиент'}
        </div>
        <div style="font-size: 14px; opacity: 0.9;">
          Следующий контакт: ${new Date(client.next_contact).toLocaleDateString('ru-RU')}
        </div>
      </div>
      <div style="font-size: 28px; cursor: pointer; padding: 4px 10px;" class="close-reminder">✕</div>
    `;

    const closeBtn = notif.querySelector('.close-reminder') as HTMLElement;
    const closeNotification = () => {
      notif.remove();
      const closedList = JSON.parse(localStorage.getItem('closedNotifications') || '[]');
      closedList.push(key);
      localStorage.setItem('closedNotifications', JSON.stringify(closedList));
    };

    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        closeNotification();
      });
    }

    notif.addEventListener('click', () => {
      window.location.href = '/adminCifra/clients';
      closeNotification();
    });

    document.body.appendChild(notif);
    playNotificationSound();
  };
// ==================== БЛОК 4.1 УЛУЧШЕННОЕ ВСПЛЫВАЮЩЕЕ УВЕДОМЛЕНИЕ ====================
const showVisualNotification = (type: 'new' | 'status' | 'volume' | 'datetime', orderData?: any, oldData?: any) => {
  const orderId = orderData?.id || '—';

  let title = '';
  let message = '';
  let emoji = '';

  // Функция форматирования даты в ДД-ММ-ГГГГ
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  };

  if (type === 'new') {
    emoji = '🆕';
    title = 'Новая заявка!';
    const deliveryStr = formatDate(orderData?.delivery_date);
    message = `№${orderId} — ${orderData?.grade || ''} — ${orderData?.volume || ''} м³`;
    if (deliveryStr) message += ` — на ${deliveryStr}`;
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
    const deliveryStr = formatDate(orderData?.delivery_date);
    message = `Заявка №${orderId} — ${deliveryStr}`;
    if (orderData?.delivery_time) {
      message += ` ${orderData.delivery_time}`;
    }
  }

  // ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←
  playNotificationSound();   // ← Звук для ВСЕХ типов уведомлений
  // ←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←←

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
    min-width: 390px;
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

 // ==================== БЛОК 5. УЛУЧШЕННЫЙ POLLING (ФИКС ПОВТОРНЫХ УВЕДОМЛЕНИЙ) ====================
useEffect(() => {
  if (!userRole || !['admin', 'manager', 'dispatcher', 'operator'].includes(userRole)) {
    return;
  }

  console.log(`✅ Polling запущен для роли: ${userRole}`);

  // Восстанавливаем последний обработанный ID из localStorage
  let lastMaxOrderId = parseInt(localStorage.getItem('lastMaxOrderId') || '0');
  let lastKnownData: Record<number, any> = {};

  const checkOrders = async () => {
    try {
      const res = await fetch('/api/adminCifra/all-orders', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });

      if (!res.ok) return;

      const data = await res.json();
      const orders = data.orders || data || [];

      const currentMaxId = orders.length > 0 ? Math.max(...orders.map((o: any) => o.id)) : 0;

      // === НОВЫЕ ЗАЯВКИ ===
      if (currentMaxId > lastMaxOrderId) {
        const newOrders = orders.filter((o: any) => o.id > lastMaxOrderId);

        console.log(`🆕 Найдено новых заявок: ${newOrders.length}`);

        for (const newOrder of newOrders) {
          setNewOrdersCount(prev => prev + 1);
          playNotificationSound();
          showVisualNotification('new', newOrder);
        }

        // Сохраняем прогресс
        lastMaxOrderId = currentMaxId;
        localStorage.setItem('lastMaxOrderId', currentMaxId.toString());
      }

      // === Изменения в существующих заявках ===
      orders.forEach((order: any) => {
        const prev = lastKnownData[order.id];

        if (prev) {
          if (prev.status !== order.status) {
            playNotificationSound();
            showVisualNotification('status', order);
            
          }
          if (prev.volume !== order.volume) {
            playNotificationSound();
            showVisualNotification('volume', order, prev);
            
          }
          if (prev.delivery_date !== order.delivery_date || prev.delivery_time !== order.delivery_time) {
            playNotificationSound();
            showVisualNotification('datetime', order);
            
          }
        }

        lastKnownData[order.id] = { ...order };
      });

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

// ==================== 5.1 ПРОВЕРКА НАПОМИНАНИЙ ПО КЛИЕНТАМ (ОДИН РАЗ В ДЕНЬ) ====================
useEffect(() => {
  if (!userRole || !['admin', 'manager', 'dispatcher', 'operator'].includes(userRole)) return;

  const checkClientReminders = async () => {
    try {
      const savedUserId = localStorage.getItem('userId');
      if (!savedUserId) return;

      const res = await fetch(`/api/adminCifra/clients/reminders?userId=${savedUserId}`);

      if (!res.ok) {
        console.warn('Reminders API returned:', res.status);
        return;
      }

      const reminders = await res.json();

      console.log(`📢 Получено ${reminders.length} напоминаний`);

      reminders.forEach((reminder: any) => {
        const key = `client-reminder-${reminder.groupId || reminder.user_id}`;
        const closed = JSON.parse(localStorage.getItem('closedNotifications') || '[]');

        if (!closed.includes(key)) {
          showClientReminder(reminder);
        }
      });
    } catch (err) {
      console.warn('Client reminders check error:', err);
    }
  };

  // Первый запуск
  checkClientReminders();

  // Ежедневная проверка в 9:00 утра
  const now = new Date();
  const tomorrow9AM = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0);
  const timeUntil9AM = tomorrow9AM.getTime() - now.getTime();

  const dailyTimer = setTimeout(() => {
    checkClientReminders();
    setInterval(checkClientReminders, 24 * 60 * 60 * 1000);
  }, timeUntil9AM);

  return () => clearTimeout(dailyTimer);

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

      {/* ==================== ЛОГОТИП TRADECOM ==================== */}
          <div style={{ 
            padding: '0 12px', 
            marginBottom: '40px', 
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center'
          }}>
            <Image 
              src={isCollapsed ? "/logo-tradecom-circle.png" : "/logo-tradecom-white.png"} 
              alt="TRADECOM" 
              width={isCollapsed ? 82 : 270} 
              height={isCollapsed ? 82 : 130} 
              style={{ 
                objectFit: 'contain',
                borderRadius: isCollapsed ? '50%' : '8px',
                transition: 'all 0.3s ease'
              }} 
              priority
            />
            
            {!isCollapsed && (
              <p style={{ 
                fontSize: '13px', 
                color: '#64748B', 
                marginTop: '8px',
                letterSpacing: '0.5px'
              }}>
                ТрейдКом • ДИСПЕТЧЕРИЗАЦИЯ
              </p>
            )}
          </div>

                    <nav style={{ flex: 1 }}>

            <Link href="/adminCifra/dashboard" style={navLinkStyle(isActive('/adminCifra/dashboard'), isCollapsed)}>
              <Home size={22} /> {!isCollapsed && <span>Дашборд</span>}
            </Link>

            {/* ==================== БЛОК 9: ПУНКТ МЕНЮ "ЗАЯВКИ" ==================== */}
            <div>
              <Link 
                href="/adminCifra/zayavki" 
                style={navLinkStyle(isActive('/adminCifra/zayavki'), isCollapsed)}
                onClick={() => setNewOrdersCount(0)}
              >
                <Package size={22} /> 
                {!isCollapsed && <span>Заявки</span>}
              </Link>
            </div>

            {/* ==================== БЛОК 9.1: ОГРАНИЧЕНИЕ МЕНЮ ==================== */}
            {userRole === 'operator' ? (
              <Link href="/adminCifra/operator" style={navLinkStyle(isActive('/adminCifra/operator'), isCollapsed)}>
                <UserCog size={22} /> {!isCollapsed && <span>Оператор БСУ</span>}
              </Link>
            ) : (
              <>
                <Link href="/adminCifra/tasks" style={navLinkStyle(isActive('/adminCifra/tasks'), isCollapsed)}>
                  <CheckCircle size={22} /> {!isCollapsed && <span>Задачи</span>}
                </Link>

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
              </>
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
} as React.CSSProperties);   // ← Добавили эту строку