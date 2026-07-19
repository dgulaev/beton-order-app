'use client';

// Заглушка для разделов мобильной админки, у которых пока нет полноценной
// мобильной страницы (Миксеры/Склад/Клиенты — см. навбар в layout.tsx).
// Раньше ссылки в навбаре вели на несуществующие маршруты (404) — эта
// страница просто закрывает такой переход человеческим сообщением.
import type { ReactNode } from 'react';
import MobileExitButton from './MobileExitButton';

interface MobileComingSoonProps {
  title: string;
  icon: ReactNode;
  description?: string;
}

export default function MobileComingSoon({ title, icon, description }: MobileComingSoonProps) {
  return (
    <div style={{ padding: '16px', paddingBottom: '100px', minHeight: '100vh' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: '700', margin: 0, color: '#fff' }}>{title}</h1>
        <MobileExitButton />
      </div>

      <div
        style={{
          background: '#1E2937',
          border: '1px solid #334155',
          borderRadius: '20px',
          padding: '48px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: '16px',
          marginTop: '40px',
        }}
      >
        <div
          style={{
            width: '72px',
            height: '72px',
            borderRadius: '9999px',
            background: '#25334A',
            color: '#60A5FA',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </div>
        <div style={{ fontSize: '19px', fontWeight: '600', color: '#fff' }}>Раздел в разработке</div>
        <div style={{ fontSize: '15px', color: '#94A3B8', lineHeight: 1.5, maxWidth: '320px' }}>
          {description || 'Этот раздел мобильной админки пока недоступен. Используйте полную версию на компьютере.'}
        </div>
      </div>
    </div>
  );
}
