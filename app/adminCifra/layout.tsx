// app/adminCifra/layout.tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Calendar, Truck, Package, Users } from 'lucide-react';

export default function AdminCifraLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const isActive = (path: string) => pathname === path;

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
        </div>

        <nav style={{ flex: 1 }}>
          <Link href="/adminCifra/dashboard" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '14px 20px',
            borderRadius: '12px',
            backgroundColor: isActive('/adminCifra/dashboard') ? '#3B82F6' : 'transparent',
            color: isActive('/adminCifra/dashboard') ? '#fff' : '#94A3B8',
            marginBottom: '8px',
            textDecoration: 'none'
          }}>
            <Home size={22} />
            <span style={{ fontSize: '16px', fontWeight: '500' }}>Дашборд</span>
          </Link>

          <Link href="/adminCifra/orders" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '14px 20px',
            borderRadius: '12px',
            backgroundColor: isActive('/adminCifra/orders') ? '#3B82F6' : 'transparent',
            color: isActive('/adminCifra/orders') ? '#fff' : '#94A3B8',
            marginBottom: '8px',
            textDecoration: 'none'
          }}>
            <Package size={22} />
            <span style={{ fontSize: '16px', fontWeight: '500' }}>Все заказы</span>
          </Link>

          <Link href="/adminCifra/schedule" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '14px 20px',
            borderRadius: '12px',
            backgroundColor: isActive('/adminCifra/schedule') ? '#3B82F6' : 'transparent',
            color: isActive('/adminCifra/schedule') ? '#fff' : '#94A3B8',
            marginBottom: '8px',
            textDecoration: 'none'
          }}>
            <Calendar size={22} />
            <span style={{ fontSize: '16px', fontWeight: '500' }}>Календарь / Таймлайн</span>
          </Link>

          <Link href="/adminCifra/mixers" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '14px 20px',
            borderRadius: '12px',
            backgroundColor: isActive('/adminCifra/mixers') ? '#3B82F6' : 'transparent',
            color: isActive('/adminCifra/mixers') ? '#fff' : '#94A3B8',
            marginBottom: '8px',
            textDecoration: 'none'
          }}>
            <Truck size={22} />
            <span style={{ fontSize: '16px', fontWeight: '500' }}>Миксеры</span>
          </Link>

          <Link href="/adminCifra/clients" style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            padding: '14px 20px',
            borderRadius: '12px',
            backgroundColor: isActive('/adminCifra/clients') ? '#3B82F6' : 'transparent',
            color: isActive('/adminCifra/clients') ? '#fff' : '#94A3B8',
            marginBottom: '8px',
            textDecoration: 'none'
          }}>
            <Users size={22} />
            <span style={{ fontSize: '16px', fontWeight: '500' }}>Клиенты</span>
          </Link>
        </nav>

        <div style={{ padding: '20px 16px', borderTop: '1px solid #334155', marginTop: 'auto' }}>
          <div style={{ fontSize: '14px', color: '#64748B' }}>
            adminTrade|Com • v1.0
          </div>
        </div>
      </div>

      {/* Основной контент — ИСПРАВЛЕННЫЙ */}
      <div style={{ 
        flex: 1, 
        overflow: 'auto', 
        padding: '32px',
        backgroundColor: '#0F172A'
      }}>
        {children}
      </div>
    </div>
  );
}