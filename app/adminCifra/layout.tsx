'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Calendar, Truck, Package, Users, UserCog, DollarSign } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function AdminCifraLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = (path: string) => pathname === path;

  const [userRole, setUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Проверка роли пользователя
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
      .then(data => {
        setUserRole(data.role || 'client');
      })
      .catch(() => setUserRole('client'))
      .finally(() => setLoading(false));
  }, []);

  // Проверка доступа
  if (loading) {
    return (
      <div style={{ padding: '100px', textAlign: 'center', color: '#94A3B8', background: '#0F172A', minHeight: '100vh' }}>
        Загрузка доступа...
      </div>
    );
  }

  const allowedRoles = ['admin', 'manager', 'dispatcher', 'operator'];

  if (!userRole || !allowedRoles.includes(userRole)) {
    return (
      <div style={{ 
        padding: '100px 20px', 
        textAlign: 'center', 
        minHeight: '100vh', 
        backgroundColor: '#0F172A', 
        color: '#94A3B8' 
      }}>
        <h2>Доступ запрещён</h2>
        <p>У вас нет прав для входа в панель АдминЦифра.<br />
        Ваша роль: <strong>{userRole}</strong></p>
      </div>
    );
  }

  return (
    <div style={{ 
      display: 'flex', 
      minHeight: '100vh', 
      backgroundColor: '#0F172A',
      color: '#fff',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      {/* Боковая панель */}
      <div style={{
        width: '280px',
        backgroundColor: '#1E2937',
        color: '#fff',
        padding: '24px 16px',
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid #334155'
      }}>
        <div style={{ padding: '0 16px', marginBottom: '40px' }}>
          <h1 style={{ fontSize: '28px', fontWeight: '700', color: '#fff' }}>РБУ ТрейдКом</h1>
          <p style={{ fontSize: '13px', color: '#64748B', marginTop: '4px' }}>Цифра • Диспетчеризация</p>
        </div>

        <nav style={{ flex: 1 }}>
          <Link href="/adminCifra/dashboard" style={navLinkStyle(isActive('/adminCifra/dashboard'))}>
            <Home size={22} /> <span>Дашборд</span>
          </Link>
          <Link href="/adminCifra/zayavki" style={navLinkStyle(isActive('/adminCifra/zayavki'))}>
            <Package size={22} /> <span>Заявки</span>
          </Link>
          <Link href="/adminCifra/orders" style={navLinkStyle(isActive('/adminCifra/orders'))}>
            <Package size={22} /> <span>Все заказы</span>
          </Link>
          <Link href="/adminCifra/schedule" style={navLinkStyle(isActive('/adminCifra/schedule'))}>
            <Calendar size={22} /> <span>Календарь / Таймлайн</span>
          </Link>
          <Link href="/adminCifra/mixers" style={navLinkStyle(isActive('/adminCifra/mixers'))}>
            <Truck size={22} /> <span>Миксеры</span>
          </Link>
          <Link href="/adminCifra/clients" style={navLinkStyle(isActive('/adminCifra/clients'))}>
            <Users size={22} /> <span>Клиенты</span>
          </Link>

          {/* Выводы наличных — только для админов и менеджеров */}
          {(userRole === 'admin' || userRole === 'manager') && (
            <Link href="/adminCifra/withdrawals" style={navLinkStyle(isActive('/adminCifra/withdrawals'))}>
              <DollarSign size={22} /> <span>Выводы наличных</span>
            </Link>
          )}

          <Link href="/adminCifra/operator" style={navLinkStyle(isActive('/adminCifra/operator'))}>
            <UserCog size={22} /> <span>Оператор БСУ</span>
          </Link>
        </nav>

        <div style={{ padding: '20px 16px', borderTop: '1px solid #334155', marginTop: 'auto' }}>
          <div style={{ fontSize: '14px', color: '#64748B' }}>
            Роль: <strong>{userRole}</strong> • adminTradeCom v1.2
          </div>
        </div>
      </div>

      {/* Основной контент */}
      <div style={{ flex: 1, overflow: 'auto', padding: '32px', backgroundColor: '#0F172A' }}>
        {children}
      </div>
    </div>
  );
}

// Стили ссылки
const navLinkStyle = (active: boolean) => ({
  display: 'flex',
  alignItems: 'center',
  gap: '16px',
  padding: '14px 20px',
  borderRadius: '12px',
  backgroundColor: active ? '#3B82F6' : 'transparent',
  color: active ? '#fff' : '#94A3B8',
  marginBottom: '8px',
  textDecoration: 'none',
  fontSize: '16px',
  fontWeight: '500' as const,
});