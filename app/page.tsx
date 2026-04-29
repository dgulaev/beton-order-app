'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

declare const WebApp: any;

export default function ConcreteOrderPage() {
  const [form, setForm] = useState({
    grade: 'М300',
    volume: '',
    deliveryDate: new Date().toISOString().split('T')[0],
    deliveryTime: '10:00',
    address: '',
    customerType: 'physical' as 'physical' | 'legal',
    organizationName: '',
    fullName: '',
    phone: '',
    comment: '',
  });

  const [currentScreen, setCurrentScreen] = useState<'form' | 'success'>('form');
  const [orderId, setOrderId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // === ИСПРАВЛЕННАЯ ЛОГИКА ДОСТАВКИ ===
  const volume = parseFloat(form.volume) || 0;
  const pricePerCubic: Record<string, number> = {
    'М100': 6380, 'М150': 6500, 'М200': 6600, 'М250': 6950,
    'М300': 7230, 'М350': 7400, 'М400': 8050, 'М450': 8350, 'М500': 8700,
  };

  const concreteCost = volume > 0 ? Math.round(volume * (pricePerCubic[form.grade] || 7230)) : 0;

  let deliveryCost = 0;
  let deliveryNote = '';

  if (volume > 0) {
    if (volume <= 10) {
      deliveryCost = 6000;
      deliveryNote = '6000 ₽ за рейс (до 10 м³)';
    } 
    else if (volume <= 12) {
      deliveryCost = 7500;
      deliveryNote = '7500 ₽ за рейс (миксер 12 м³)';
    } 
    else if (volume <= 50) {
      const trips = Math.ceil(volume / 10);
      deliveryCost = trips * 6000;
      deliveryNote = `${trips} рейса × 6000 ₽`;
    } 
    else {
      deliveryCost = Math.round(volume * 600);
      deliveryNote = '600 ₽ за 1 м³ (при большом объёме)';
    }
  }

  const totalPrice = concreteCost + deliveryCost;

  useEffect(() => {
    const wa = (window as any).WebApp;
    if (wa) {
      wa.ready();
      wa.expand();
      wa.enableClosingConfirmation();
      wa.MainButton.setText('Отправить заявку');
      wa.MainButton.show();
      wa.MainButton.onClick(handleSubmit);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<any>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleCustomerTypeChange = (type: 'physical' | 'legal') => {
    setForm(prev => ({ ...prev, customerType: type }));
  };

  const requestPhone = async () => {
    try {
      const result = await (window as any).WebApp.requestContact();
      if (result?.phone) setForm(prev => ({ ...prev, phone: result.phone }));
    } catch (e) {}
  };

  const handleSubmit = async () => {
  const wa = (window as any).WebApp;
  const showAlert = wa?.showAlert || alert;

  // Получаем userId надёжным способом
  const userId = wa?.initDataUnsafe?.user?.id || wa?.initData?.user?.id;

  if (!form.grade || !form.volume || !form.deliveryDate || !form.address || !form.phone) {
    showAlert('Пожалуйста, заполните все обязательные поля!');
    return;
  }
  if (form.customerType === 'legal' && !form.organizationName) {
    showAlert('Укажите название организации!');
    return;
  }
  if (form.customerType === 'physical' && !form.fullName) {
    showAlert('Укажите ФИО!');
    return;
  }

  setIsSubmitting(true);
  if (wa?.MainButton) wa.MainButton.showProgress();

  const payload = {
    ...form,
    volume,
    concreteCost,
    deliveryCost,
    totalPrice,
    customerType: form.customerType === 'legal' ? 'Юридическое лицо' : 'Физическое лицо',
    timestamp: new Date().toISOString(),
    userId: userId,                    // ← Важно!
  };

  try {
    const response = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.success) {
      setOrderId(data.orderId || Date.now());
      setCurrentScreen('success');
      if (wa?.MainButton) wa.MainButton.hide();
    } else {
      throw new Error();
    }
  } catch (error) {
    showAlert('Ошибка отправки. Попробуйте ещё раз.');
  } finally {
    setIsSubmitting(false);
    if (wa?.MainButton) wa.MainButton.hideProgress();
  }
};

  if (currentScreen === 'success') {
    return (
      <div style={{ padding: '40px 20px', textAlign: 'center', minHeight: '100vh', backgroundColor: '#f8fafc' }}>
        <div style={{ fontSize: '80px', marginBottom: '24px' }}>✅</div>
        <h2 style={{ fontSize: '28px', marginBottom: '16px' }}>Заявка отправлена!</h2>
        <p style={{ fontSize: '18px', color: '#444', marginBottom: '32px' }}>
          Номер заявки: <strong>#{orderId}</strong><br />
          Менеджер свяжется с вами в ближайшее время.
        </p>
        <button 
          onClick={() => window.location.reload()}
          style={{ width: '100%', maxWidth: '420px', padding: '16px', fontSize: '18px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '12px' }}
        >
          Создать новую заявку
        </button>
      </div>
    );
  }

  return (
    <div style={{ 
      padding: '20px', 
      maxWidth: '640px', 
      margin: '0 auto', 
      backgroundColor: '#f8fafc',
      minHeight: '100vh',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    }}>
      <h1 style={{ textAlign: 'center', fontSize: '26px', fontWeight: '700', marginBottom: '30px', color: '#1f2937' }}>
        Заявка на отгрузку бетона
      </h1>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        {/* ... (все поля формы остаются такими же) ... */}

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '15px' }}>Марка бетона</label>
          <select name="grade" value={form.grade} onChange={handleChange}
            style={{ width: '100%', padding: '14px', fontSize: '16px', borderRadius: '10px', border: '1px solid #d1d5db' }}>
            {Object.keys(pricePerCubic).map(g => (
              <option key={g} value={g}>{g} — {pricePerCubic[g]} ₽/м³</option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '15px' }}>Объём, м³</label>
          <input 
            type="number" 
            name="volume" 
            value={form.volume} 
            onChange={handleChange}
            step="0.1"
            min="0.5"
            placeholder="Например: 12.5"
            style={{ width: '100%', padding: '14px', fontSize: '16px', borderRadius: '10px', border: '1px solid #d1d5db' }}
          />
        </div>

        {totalPrice > 0 && (
          <div style={{ backgroundColor: '#f0f9ff', padding: '18px', borderRadius: '10px', border: '1px solid #bae6fd' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span>Бетон:</span>
              <strong>{concreteCost.toLocaleString('ru-RU')} ₽</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span>Доставка:</span>
              <strong>{deliveryCost.toLocaleString('ru-RU')} ₽</strong>
            </div>
            <div style={{ borderTop: '1px solid #7dd3fc', paddingTop: '10px', fontSize: '19px', fontWeight: '700', color: '#1e40af' }}>
              Итого: {totalPrice.toLocaleString('ru-RU')} ₽
            </div>
            <p style={{ fontSize: '13px', color: '#0369a1', marginTop: '8px' }}>{deliveryNote}</p>
          </div>
        )}

        {/* Остальные поля формы (дата, время, адрес, тип заказчика, ФИО/организация, телефон, комментарий) — оставляем как было */}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '15px' }}>Дата доставки</label>
            <input type="date" name="deliveryDate" value={form.deliveryDate} onChange={handleChange}
              style={{ width: '100%', padding: '14px', fontSize: '16px', borderRadius: '10px', border: '1px solid #d1d5db' }} />
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '15px' }}>Время доставки</label>
            <input type="time" name="deliveryTime" value={form.deliveryTime} onChange={handleChange}
              style={{ width: '100%', padding: '14px', fontSize: '16px', borderRadius: '10px', border: '1px solid #d1d5db' }} />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '15px' }}>Адрес доставки</label>
          <textarea name="address" value={form.address} onChange={handleChange} rows={3}
            placeholder="Город, улица, дом, подъезд, этаж..."
            style={{ width: '100%', padding: '14px', fontSize: '16px', borderRadius: '10px', border: '1px solid #d1d5db', resize: 'vertical' }} />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '600', fontSize: '15px' }}>Тип заказчика</label>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button type="button" onClick={() => handleCustomerTypeChange('physical')}
              style={{ flex: 1, padding: '16px', borderRadius: '10px', border: form.customerType === 'physical' ? '2px solid #2563eb' : '1px solid #d1d5db', backgroundColor: form.customerType === 'physical' ? '#f0f9ff' : 'white' }}>
              Физ. лицо
            </button>
            <button type="button" onClick={() => handleCustomerTypeChange('legal')}
              style={{ flex: 1, padding: '16px', borderRadius: '10px', border: form.customerType === 'legal' ? '2px solid #2563eb' : '1px solid #d1d5db', backgroundColor: form.customerType === 'legal' ? '#f0f9ff' : 'white' }}>
              Юр. лицо
            </button>
          </div>
        </div>

        {form.customerType === 'physical' ? (
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '15px' }}>ФИО заказчика</label>
            <input type="text" name="fullName" value={form.fullName} onChange={handleChange}
              placeholder="Иванов Иван Иванович"
              style={{ width: '100%', padding: '14px', fontSize: '16px', borderRadius: '10px', border: '1px solid #d1d5db' }} />
          </div>
        ) : (
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '15px' }}>Название организации</label>
            <input type="text" name="organizationName" value={form.organizationName} onChange={handleChange}
              placeholder="ООО «БетонСтрой»"
              style={{ width: '100%', padding: '14px', fontSize: '16px', borderRadius: '10px', border: '1px solid #d1d5db' }} />
          </div>
        )}

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
            <label style={{ fontWeight: '600', fontSize: '15px' }}>Телефон для связи</label>
            <span 
              onClick={requestPhone}
              style={{ color: '#2563eb', fontSize: '15px', textDecoration: 'underline', cursor: 'pointer' }}
            >
              Запросить мой контакт
            </span>
          </div>
          <input type="tel" name="phone" value={form.phone} onChange={handleChange}
            placeholder="+7 (___) ___-__-__"
            style={{ width: '100%', padding: '14px', fontSize: '16px', borderRadius: '10px', border: '1px solid #d1d5db' }} />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', fontSize: '15px' }}>Комментарий</label>
          <textarea name="comment" value={form.comment} onChange={handleChange} rows={2}
            placeholder="Дополнительная информация (необязательно)"
            style={{ width: '100%', padding: '14px', fontSize: '16px', borderRadius: '10px', border: '1px solid #d1d5db', resize: 'vertical' }} />
        </div>

        <button 
          onClick={handleSubmit}
          disabled={isSubmitting}
          style={{ 
            marginTop: '10px',
            width: '100%', 
            padding: '18px', 
            fontSize: '18px', 
            backgroundColor: isSubmitting ? '#9ca3af' : '#2563eb',
            color: 'white', 
            border: 'none', 
            borderRadius: '12px',
            fontWeight: '600'
          }}
        >
          {isSubmitting ? 'Отправляем...' : 'Отправить заявку'}
        </button>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: '40px', opacity: 0.75 }}>
          <Image 
            src="/logo.jpg" 
            alt="Логотип" 
            width={130} 
            height={65}
            style={{ objectFit: 'contain' }} 
          />
        </div>
      </div>
    </div>
  );
}