'use client';

import { Suspense } from 'react';
import ConcreteOrderPage from './ConcreteOrderPageContent';

export default function Page() {
  return (
    <Suspense fallback={
      <div style={{
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '18px',
        color: '#666'
      }}>
        Загрузка приложения...
      </div>
    }>
      <ConcreteOrderPage />
    </Suspense>
  );
}