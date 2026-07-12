'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { Home, Package, Truck, Factory, Users, LogOut } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { useUserRole } from '../providers/UserRoleProvider';



export default function MobileLayout({ children }: { children: ReactNode }) {

  // ==================== 1. РОЛЬ ИЗ PROVIDER ====================
  // Единственный источник правды о роли/логине/force-logout — сам провайдер
  // уже опрашивает /api/user/role при монтировании, при возврате на вкладку
  // и периодически (см. UserRoleProvider). Раньше здесь был ещё один
  // независимый интервал (раз в 10 минут), который дублировал эту же логику.
  const { user, loading: roleLoading, refreshRole, logout } = useUserRole();
  const isLoggedIn = !!user && !roleLoading;
  const userRole = user?.role || null;

  // ==================== 1.1 СОСТОЯНИЯ АВТОРИЗАЦИИ ==============
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState('');

  // ==================== 1.2 СКРЫТИЕ БОКОВОГО МЕНЮ ====================
  useEffect(() => {
    const hideSidebar = () => {
      document.querySelectorAll('aside, nav, [class*="sidebar"], [class*="Sidebar"], header').forEach((el) => {
        (el as HTMLElement).style.display = 'none';
      });
    };

    hideSidebar();
    const timer = setTimeout(hideSidebar, 200);
    return () => clearTimeout(timer);
  }, []);

     // ==================== 4. ВХОД ====================
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError('');

    try {
      const res = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password }),
      });

      const data = await res.json();

     if (data.success && data.userId) {
       localStorage.setItem('userId', data.userId.toString());
       refreshRole(); // подхватываем роль сразу, без перезагрузки страницы

       setPhone('');
       setPassword('');
       setLoginError('');
     } else {
       setLoginError(data.message || 'Неверный логин/пароль');
     }
    } catch (err) {
      console.error('Login error:', err);
      setLoginError('Ошибка соединения');
    } finally {
      setLoginLoading(false);
    }
  };

  // ==================== 5. ВЫХОД ====================
  const handleLogout = () => {
    if (confirm('Выйти из системы?')) logout();
  };


    // ==================== 9. ЗАГРУЗКА ====================
  if (roleLoading) {
    
    
    return (
      <div style={{ 
        padding: '100px', 
        textAlign: 'center', 
        background: '#0F172A', 
        color: '#94A3B8', 
        minHeight: '100vh' 
      }}>
        Загрузка профиля...
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#0F172A',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        padding: '20px'
      }}>
        <div style={{
          background: '#1E2937',
          padding: '40px 30px',
          borderRadius: '20px',
          width: '100%',
          maxWidth: '420px',
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)'
        }}>
          <h1 style={{ textAlign: 'center', marginBottom: '8px' }}>ТрейдКом • Мобильная версия</h1>
          <p style={{ textAlign: 'center', color: '#94A3B8', marginBottom: '30px' }}>
            Войдите в систему
          </p>

          <form onSubmit={handleLogin}>
            <input type="tel" placeholder="+7 (___) ___-__-__" value={phone} onChange={(e) => setPhone(e.target.value)} style={{width: '93%', padding: '16px', marginBottom: '16px', borderRadius: '12px', border: '1px solid #334155', background: '#0F172A', color: '#fff', fontSize: '17px'}} required />
            <input type="password" placeholder="Пароль" value={password} onChange={(e) => setPassword(e.target.value)} style={{width: '93%', padding: '16px', marginBottom: '24px', borderRadius: '12px', border: '1px solid #334155', background: '#0F172A', color: '#fff', fontSize: '17px'}} required />

            {loginError && <p style={{ color: '#ef4444', textAlign: 'center', marginBottom: '16px' }}>{loginError}</p>}

            <button type="submit" disabled={loginLoading} style={{width: '100%', padding: '16px', background: loginLoading ? '#475569' : '#22c55e', color: 'white', border: 'none', borderRadius: '12px', fontSize: '17px', fontWeight: '600', cursor: loginLoading ? 'not-allowed' : 'pointer'}}>
              {loginLoading ? 'Вход...' : 'Войти'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ==================== НАВБАР И ОСНОВНОЙ КОНТЕНТ ====================
  const NavLink = ({ href, icon, label }: { href: string; icon: React.ReactNode; label: string; }) => {
    const pathname = usePathname();
    const isActive = (href === '/mobile/' && (pathname === '/mobile/' || pathname === '/mobile')) || (href !== '/mobile/' && pathname.startsWith(href));
    const activeColor = '#60A5FA';
    const inactiveColor = '#94A3B8';

    return (
      <Link href={href} style={{ textAlign: 'center', color: isActive ? activeColor : inactiveColor, textDecoration: 'none', flex: 1 }}>
        <div style={{ color: isActive ? activeColor : inactiveColor }}>{icon}</div>
        <div style={{ fontSize: '11px', marginTop: '2px', color: isActive ? activeColor : inactiveColor }}>{label}</div>
      </Link>
    );
  };


  return (
    <div id="mobile-root" style={{ width: '100vw', maxWidth: '100vw', overflowX: 'hidden', backgroundColor: '#0F172A', minHeight: '100vh', position: 'relative' }}>

      {/* ==================== ЛИЧНЫЙ ВЫХОД (не для главного админа) ==================== */}
      {userRole !== 'admin' && (
        <button
          onClick={handleLogout}
          aria-label="Выйти"
          style={{
            position: 'fixed',
            top: '12px',
            right: '12px',
            zIndex: 1001,
            background: '#1E2937',
            border: '1px solid #334155',
            borderRadius: '9999px',
            padding: '8px 14px',
            color: '#94A3B8',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            fontSize: '13px'
          }}
        >
          <LogOut size={16} /> Выйти
        </button>
      )}

      {children}

      {/* Нижний навбар */}
      <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: '74px', background: '#1E2937', borderTop: '1px solid #334155', display: 'flex', alignItems: 'center', justifyContent: 'space-around', zIndex: 1000, paddingBottom: '8px' }}>
        <NavLink href="/mobile/" icon={<Home size={26} />} label="Дашборд" />
        <NavLink href="/mobile/zayavki" icon={<Package size={26} />} label="Заявки" />
        <NavLink href="/mobile/mixers" icon={<Truck size={26} />} label="Миксеры" />
        <NavLink href="/mobile/warehouse" icon={<Factory size={26} />} label="Склад" />
        <NavLink href="/mobile/clients" icon={<Users size={26} />} label="Клиенты" />
      </div>
    </div>
    
  );
}