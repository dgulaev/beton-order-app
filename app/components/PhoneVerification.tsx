'use client';

import { useState } from 'react';
import Image from 'next/image';

declare const WebApp: any;

interface PhoneVerificationProps {
  onSuccess: (userId: number, phone: string) => void;
}

export default function PhoneVerification({ onSuccess }: PhoneVerificationProps) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);

  const requestPhone = async () => {
    setLoading(true);
    try {
      const result = await (window as any).WebApp.requestContact();
      if (result && result.phone) {
        await registerPhone(result.phone);
      } else {
        alert('Вы не поделились номером телефона');
      }
    } catch (e) {
      alert('Не удалось запросить контакт');
    } finally {
      setLoading(false);
    }
  };

  const registerPhone = async (phoneNumber: string) => {
    try {
      const res = await fetch('/api/user/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneNumber }),
      });

      const data = await res.json();
      if (data.success) {
        onSuccess(data.userId, phoneNumber);
      } else {
        alert('Ошибка: ' + (data.message || 'Не удалось зарегистрировать'));
      }
    } catch (e) {
      alert('Ошибка соединения с сервером');
    }
  };

  return (
    <div style={{
      padding: '40px 20px',
      textAlign: 'center',
      minHeight: '100vh',
      backgroundColor: '#f8fafc',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center'
    }}>
      <div style={{ marginBottom: '40px' }}>
        <Image src="/logo.jpg" alt="Логотип" width={180} height={70} style={{ objectFit: 'contain' }} />
      </div>

      <h1 style={{ fontSize: '26px', fontWeight: '700', marginBottom: '12px' }}>
        Добро пожаловать!
      </h1>
      <p style={{ color: '#666', marginBottom: '40px', fontSize: '17px' }}>
        Для продолжения работы<br />подтвердите ваш номер телефона
      </p>

      <button 
        onClick={requestPhone}
        disabled={loading}
        style={{
          width: '100%',
          maxWidth: '420px',
          margin: '0 auto 16px',
          padding: '18px',
          backgroundColor: '#2563eb',
          color: 'white',
          border: 'none',
          borderRadius: '14px',
          fontSize: '18px',
          fontWeight: '600'
        }}
      >
        {loading ? 'Запрос...' : 'Поделиться моим номером'}
      </button>

      <p style={{ color: '#999', margin: '20px 0' }}>или введите вручную</p>

      <input
        type="tel"
        placeholder="+7 (___) ___-__-__"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        style={{
          width: '100%',
          maxWidth: '420px',
          margin: '0 auto 16px',
          padding: '16px',
          borderRadius: '12px',
          border: '1px solid #ddd',
          fontSize: '17px',
          textAlign: 'center'
        }}
      />

      <button 
        onClick={() => phone && registerPhone(phone)}
        disabled={!phone || loading}
        style={{
          width: '100%',
          maxWidth: '420px',
          margin: '0 auto',
          padding: '16px',
          backgroundColor: phone ? '#2563eb' : '#9ca3af',
          color: 'white',
          border: 'none',
          borderRadius: '12px',
          fontSize: '17px',
          fontWeight: '600'
        }}
      >
        Продолжить
      </button>
    </div>
  );
}