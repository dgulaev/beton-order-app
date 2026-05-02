'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';

declare const WebApp: any;

export default function ConcreteOrderPage() {
  const [isVerified, setIsVerified] = useState(false);
  const [phone, setPhone] = useState('');

  const [activeTab, setActiveTab] = useState<'new' | 'history' | 'referral'>('new');
  const [currentScreen, setCurrentScreen] = useState<'form' | 'success'>('form');
  const [orderId, setOrderId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

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

  const [userId, setUserId] = useState<number | null>(null);
  const [referralCode, setReferralCode] = useState<string>('Загрузка...');
  const [balance, setBalance] = useState(0);
  const [referredBy, setReferredBy] = useState<number | null>(null);

  const [orders, setOrders] = useState<any[]>([]);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [loadingReferrals, setLoadingReferrals] = useState(false);

  // ==================== ИНИЦИАЛИЗАЦИЯ РЕФЕРАЛЬНОЙ СИСТЕМЫ ====================
  const initializeUser = async (uid: number) => {
    console.log(`📡 Запрос к /api/user/init с uid=${uid}`);
    try {
      const res = await fetch('/api/user/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: uid }),
      });

      console.log(`📨 Ответ сервера: ${res.status}`);
      const data = await res.json();
      console.log('📦 Данные от сервера:', data);

      if (data.referralCode) {
        setReferralCode(data.referralCode);
        setBalance(data.balance || 0);
        console.log('✅ Код установлен:', data.referralCode);
      } else {
        setReferralCode('Нет кода в ответе');
      }
    } catch (e) {
      console.error('💥 Ошибка инициализации:', e);
      setReferralCode('Ошибка соединения');
    }
  };

  const volume = parseFloat(form.volume) || 0;
  const pricePerCubic: Record<string, number> = {
    'М100': 6380, 'М150': 6500, 'М200': 6600, 'М250': 6950,
    'М300': 7230, 'М350': 7400, 'М400': 8050, 'М450': 8350, 'М500': 8700,
  };

  const concreteCost = volume > 0 ? Math.round(volume * (pricePerCubic[form.grade] || 7230)) : 0;
  let deliveryCost = 0;
  let deliveryNote = '';

  if (volume > 0) {
    if (volume <= 10) { deliveryCost = 6000; deliveryNote = '6000 ₽ за рейс (до 10 м³)'; }
    else if (volume <= 12) { deliveryCost = 7500; deliveryNote = '7500 ₽ за рейс (12 м³)'; }
    else if (volume <= 50) { deliveryCost = Math.ceil(volume / 10) * 6000; deliveryNote = `${Math.ceil(volume / 10)} рейса × 6000 ₽`; }
    else { deliveryCost = Math.round(volume * 600); deliveryNote = '600 ₽ за 1 м³'; }
  }
  const totalPrice = concreteCost + deliveryCost;

  const handleChange = (e: React.ChangeEvent<any>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleCustomerTypeChange = (type: 'physical' | 'legal') => {
    setForm(prev => ({ ...prev, customerType: type }));
  };

  const requestPhone = async () => {
    try {
      const result = await (window as any).WebApp.requestContact();
      if (result && result.phone) {
        await registerByPhone(result.phone);
      } else {
        alert('Вы не поделились номером телефона');
      }
    } catch (e) {
      alert('Не удалось запросить контакт');
    }
  };

  const registerByPhone = async (phoneNumber: string) => {
    try {
      const res = await fetch('/api/user/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneNumber }),
      });

      const data = await res.json();
      if (data.success) {
        setUserId(data.userId);
        setPhone(phoneNumber);
        setIsVerified(true);

        localStorage.setItem('userPhone', phoneNumber);
        localStorage.setItem('userId', data.userId.toString());

        console.log('✅ Пользователь верифицирован по телефону:', phoneNumber);
      } else {
        alert('Ошибка регистрации: ' + (data.message || 'Неизвестная ошибка'));
      }
    } catch (e) {
      alert('Ошибка соединения с сервером');
    }
  };

  // Проверка при загрузке (localStorage)
  useEffect(() => {
    const savedPhone = localStorage.getItem('userPhone');
    const savedUserId = localStorage.getItem('userId');

    if (savedPhone && savedUserId) {
      setPhone(savedPhone);
      setUserId(parseInt(savedUserId));
      setIsVerified(true);
      console.log('✅ Загружено из localStorage, userId =', savedUserId);
    }
  }, []);

  // Основной useEffect для Telegram WebApp
  useEffect(() => {
    if (!isVerified) return;

    const wa = (window as any).WebApp;
    if (wa) {
      wa.ready();
      wa.expand();
      wa.enableClosingConfirmation();

      const uid = wa.initDataUnsafe?.user?.id || wa.initData?.user?.id;
      if (uid) {
        setUserId(uid);
      }

      const urlParams = new URLSearchParams(window.location.search);
      const ref = urlParams.get('ref');
      if (ref) setReferredBy(parseInt(ref));

      wa.MainButton.setText('Отправить заявку');
      wa.MainButton.show();
      wa.MainButton.onClick(handleSubmit);
    }
  }, [isVerified]);

  // Инициализация реферальной системы
  useEffect(() => {
    if (userId) {
      initializeUser(userId);
    }
  }, [userId]);

  const loadOrders = async () => {
    if (!userId) {
      console.log('❌ loadOrders: userId отсутствует');
      setLoadingHistory(false);
      return;
    }

    setLoadingHistory(true);
    try {
      console.log('📡 Загрузка истории для userId:', userId);
      const res = await fetch(`/api/orders?userId=${userId}`);
      console.log('📨 Статус ответа /api/orders:', res.status);
      const data = await res.json();
      console.log('📦 Получено заявок из базы:', data.orders?.length || 0);
      console.log('📋 Данные заявок:', data.orders);
      setOrders(data.orders || []);
    } catch (e) {
      console.error('loadOrders error:', e);
    } finally {
      setLoadingHistory(false);
    }
  };

  const loadReferrals = async () => {
    if (!userId) return;
    setLoadingReferrals(true);
    try {
      const res = await fetch(`/api/referrals?userId=${userId}`);
      const data = await res.json();
      setReferrals(data.referrals || []);
    } catch (e) { console.error(e); } finally { setLoadingReferrals(false); }
  };

    const handleSubmit = async () => {
    const wa = (window as any).WebApp;
    const showAlert = wa?.showAlert || alert;

    if (!form.volume || !form.address || !form.phone) {
      showAlert('Пожалуйста, заполните обязательные поля!');
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
      userId: userId,
      referred_by: referredBy,
    };

    try {
      const response = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (data.success) {
        console.log('✅ Заявка отправлена, переключаем на success screen');
        setOrderId(data.orderId);
        setCurrentScreen('success');
        setForm({
          grade: 'М300',
          volume: '',
          deliveryDate: new Date().toISOString().split('T')[0],
          deliveryTime: '10:00',
          address: '',
          customerType: 'physical',
          organizationName: '',
          fullName: '',
          phone: '',
          comment: '',
        });
      } 
      else if (response.status === 409) {
        // === КРАСИВОЕ УВЕДОМЛЕНИЕ О КОНФЛИКТЕ ===
        const errorMessage = data.message || 'На выбранное время уже запланирована отгрузка бетона.';

        if (wa && typeof wa.showPopup === 'function') {
          // Красивое native popup в MAX / Telegram Mini App
          wa.showPopup({
            title: '⏰ Время занято',
            message: errorMessage,
            buttons: [
              { id: 'ok', type: 'default', text: 'Понятно' }
            ]
          });
        } else {
          // Красивый fallback для браузера / localhost
          showAlert('⏰ Время занято\n\n' + errorMessage);
        }
      } 
      else {
        showAlert('Ошибка при отправке: ' + (data.message || 'Неизвестная ошибка'));
      }
    } catch (error) {
      console.error('Submit error:', error);
      showAlert('Ошибка соединения. Попробуйте ещё раз.');
    } finally {
      setIsSubmitting(false);
      if (wa?.MainButton) wa.MainButton.hideProgress();
    }
  };

  // Экран верификации телефона
  if (!isVerified) {
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
          Поделиться моим номером
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
          onClick={() => phone && registerByPhone(phone)}
          disabled={!phone}
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

  // Экран успешной отправки заявки
  if (currentScreen === 'success') {
    return (
      <div style={{ 
        padding: '40px 20px', 
        textAlign: 'center', 
        minHeight: '100vh', 
        backgroundColor: '#f8fafc' 
      }}>
        <div style={{ fontSize: '80px', marginBottom: '24px' }}>✅</div>
        <h2 style={{ fontSize: '28px', marginBottom: '16px' }}>Заявка отправлена!</h2>
        <p style={{ fontSize: '18px', color: '#444', marginBottom: '40px' }}>
          Номер заявки: <strong>#{orderId}</strong><br />
          Менеджер свяжется с вами в ближайшее время.
        </p>
        
        <button
          onClick={() => {
            setCurrentScreen('form');
            setActiveTab('new');
          }}
          style={{
            display: 'inline-block',
            minWidth: '260px',
            padding: '16px 32px',
            backgroundColor: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '12px',
            fontSize: '17px',
            fontWeight: '600',
            boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)'
          }}
        >
          Создать новую заявку
        </button>
      </div>
    );
  }

  // Основной интерфейс приложения
  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#f8fafc',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      padding: '16px'
    }}>
      <div style={{
        width: '100%',
        maxWidth: '560px',
        backgroundColor: 'white',
        borderRadius: '24px',
        boxShadow: '0 10px 30px rgba(0, 0, 0, 0.1)',
        overflow: 'hidden'
      }}>

        {/* Основное содержимое */}
        <div style={{ padding: '20px' }}>
          {activeTab === 'new' && (
  <div style={{ 
    maxWidth: '640px', 
    margin: '0 auto', 
    background: 'white', 
    borderRadius: '24px', 
    overflow: 'hidden',
    boxShadow: '0 4px 20px rgba(0,0,0,0.06)' 
  }}>

    {/* ====================== ХЕДЕР С ЗАГОЛОВКОМ И МЕНЮ ====================== */}
    <div style={{ 
      display: 'flex', 
      justifyContent: 'space-between', 
      alignItems: 'center', 
      padding: '20px 24px',
      borderBottom: '1px solid #f1f5f9'
    }}>
      
      {/* Главный заголовок */}
      <h1 style={{ 
        fontSize: '26px', 
        fontWeight: '700', 
        margin: 0, 
        color: '#1f2937' 
      }}>
        Заявка на отгрузку бетона
      </h1>

      {/* Меню (три полоски) */}
      <div style={{ position: 'relative' }}>
        <div 
          onClick={() => setMenuOpen(!menuOpen)} 
          style={{ 
            padding: '10px', 
            cursor: 'pointer' 
          }}
        >
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
        </div>

        {/* Выпадающее меню */}
        {menuOpen && (
          <div style={{
            position: 'absolute',
            top: '52px',
            right: '0',
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            padding: '8px 0',
            zIndex: 100,
            width: '220px'
          }}>
            <div onClick={() => { setActiveTab('new'); setMenuOpen(false); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Новая заявка</div>
            <div onClick={() => { setActiveTab('history'); setMenuOpen(false); loadOrders(); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Мои заявки</div>
            <div onClick={() => { setActiveTab('referral'); setMenuOpen(false); loadReferrals(); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Мои баллы</div>
          </div>
        )}
      </div>
    </div>

    {/* ====================== САМА ФОРМА ====================== */}
    <div style={{ padding: '28px' }}>
      <form onSubmit={(e) => { e.preventDefault(); handleSubmit(); }} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Марка бетона</label>
            <select
              value={form.grade}
              onChange={(e) => setForm({ ...form, grade: e.target.value })}
              style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '12px', fontSize: '16px' }}
            >
              <option value="М300">М300</option>
              <option value="М350">М350</option>
              <option value="М400">М400</option>
              <option value="М450">М450</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Объём (м³)</label>
            <input
              type="number"
              value={form.volume}
              onChange={(e) => setForm({ ...form, volume: e.target.value })}
              style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '12px', fontSize: '16px' }}
              placeholder="20"
              min="1"
              step="0.5"
            />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Дата и время доставки</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <input
              type="date"
              value={form.deliveryDate}
              onChange={(e) => setForm({ ...form, deliveryDate: e.target.value })}
              style={{ padding: '12px', border: '1px solid #d1d5db', borderRadius: '12px', fontSize: '16px' }}
            />
            <input
              type="time"
              value={form.deliveryTime}
              onChange={(e) => setForm({ ...form, deliveryTime: e.target.value })}
              style={{ padding: '12px', border: '1px solid #d1d5db', borderRadius: '12px', fontSize: '16px' }}
            />
          </div>
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Адрес доставки</label>
          <textarea
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            rows={2}
            style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '16px', resize: 'vertical', minHeight: '70px' }}
            placeholder="Укажите полный адрес"
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '8px', fontWeight: '500' }}>Тип заказчика</label>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button
              type="button"
              onClick={() => setForm({ ...form, customerType: 'physical' })}
              style={{ flex: 1, padding: '12px', borderRadius: '12px', fontWeight: '500', background: form.customerType === 'physical' ? '#2563eb' : '#f3f4f6', color: form.customerType === 'physical' ? 'white' : '#374151' }}
            >
              Физическое лицо
            </button>
            <button
              type="button"
              onClick={() => setForm({ ...form, customerType: 'legal' })}
              style={{ flex: 1, padding: '12px', borderRadius: '12px', fontWeight: '500', background: form.customerType === 'legal' ? '#2563eb' : '#f3f4f6', color: form.customerType === 'legal' ? 'white' : '#374151' }}
            >
              Юридическое лицо
            </button>
          </div>
        </div>

        {form.customerType === 'physical' ? (
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>ФИО</label>
            <input
              type="text"
              value={form.fullName}
              onChange={(e) => setForm({ ...form, fullName: e.target.value })}
              style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '12px' }}
              placeholder="Иванов Иван Иванович"
            />
          </div>
        ) : (
          <div>
            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Название организации</label>
            <input
              type="text"
              value={form.organizationName}
              onChange={(e) => setForm({ ...form, organizationName: e.target.value })}
              style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '12px' }}
              placeholder='ООО "Ваша организация"'
            />
          </div>
        )}

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Телефон для связи</label>
          <input
            type="tel"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '12px' }}
            placeholder="+7 (___) ___-__-__"
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500' }}>Комментарий</label>
          <textarea
            value={form.comment}
            onChange={(e) => setForm({ ...form, comment: e.target.value })}
            rows={3}
            style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '16px', resize: 'vertical' }}
            placeholder="Дополнительная информация (необязательно)"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          style={{ 
            width: '100%', 
            background: isSubmitting ? '#9ca3af' : '#2563eb', 
            color: 'white', 
            padding: '16px', 
            border: 'none', 
            borderRadius: '16px', 
            fontSize: '18px', 
            fontWeight: '600',
            marginTop: '12px'
          }}
        >
          {isSubmitting ? 'Отправляем...' : 'Отправить заявку'}
        </button>
      </form>
    </div>

    {/* ====================== ЛОГОТИП ВНИЗУ ====================== */}
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: '20px', paddingBottom: '28px', opacity: 0.75 }}>
      <Image 
        src="/logo.jpg" 
        alt="Логотип" 
        width={160} 
        height={65} 
        style={{ objectFit: 'contain' }} 
        loading="eager"
      />
    </div>
  </div>
)}

          {activeTab === 'history' && (
  <div>
    {/* Хедер с меню (только меню) */}
    <div style={{ 
      display: 'flex', 
      justifyContent: 'flex-end', 
      padding: '20px 24px',
      borderBottom: '1px solid #f1f5f9',
      backgroundColor: 'white'
    }}>
      <div style={{ position: 'relative' }}>
        <div 
          onClick={() => setMenuOpen(!menuOpen)} 
          style={{ padding: '10px', cursor: 'pointer' }}
        >
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
        </div>

        {menuOpen && (
          <div style={{
            position: 'absolute',
            top: '52px',
            right: '0',
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            padding: '8px 0',
            zIndex: 100,
            width: '220px'
          }}>
            <div onClick={() => { setActiveTab('new'); setMenuOpen(false); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Новая заявка</div>
            <div onClick={() => { setActiveTab('history'); setMenuOpen(false); loadOrders(); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Мои заявки</div>
            <div onClick={() => { setActiveTab('referral'); setMenuOpen(false); loadReferrals(); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Мои баллы</div>
          </div>
        )}
      </div>
    </div>

    {/* Содержимое вкладки "Мои заявки" */}
    <div style={{ padding: '24px' }}>
      <h2 style={{ marginBottom: '20px' }}>Мои заявки</h2>
      {loadingHistory ? (
        <p style={{ textAlign: 'center', padding: '60px 0' }}>Загрузка...</p>
      ) : orders.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '80px 20px', color: '#888' }}>Пока нет заявок</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {orders.map((order) => (
            <div key={order.id} style={{ background: 'white', padding: '20px', borderRadius: '16px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
              <strong>{order.grade} — {order.volume} м³</strong>
              <div style={{ color: '#555', margin: '8px 0' }}>{order.delivery_date} в {order.delivery_time}</div>
              <div style={{ color: '#666' }}>{order.address}</div>
              <div style={{ marginTop: '12px', fontSize: '19px', fontWeight: '700', color: '#2563eb' }}>
                {order.total_price?.toLocaleString('ru-RU')} ₽
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  </div>
)}

          {activeTab === 'referral' && (
  <div>
    {/* Хедер с меню (только меню) */}
    <div style={{ 
      display: 'flex', 
      justifyContent: 'flex-end', 
      padding: '20px 24px',
      borderBottom: '1px solid #f1f5f9',
      backgroundColor: 'white'
    }}>
      <div style={{ position: 'relative' }}>
        <div 
          onClick={() => setMenuOpen(!menuOpen)} 
          style={{ padding: '10px', cursor: 'pointer' }}
        >
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
          <div style={{ width: '26px', height: '3px', background: '#1f2937', margin: '5px 0', borderRadius: '2px' }}></div>
        </div>

        {menuOpen && (
          <div style={{
            position: 'absolute',
            top: '52px',
            right: '0',
            background: 'white',
            borderRadius: '12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.15)',
            padding: '8px 0',
            zIndex: 100,
            width: '220px'
          }}>
            <div onClick={() => { setActiveTab('new'); setMenuOpen(false); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Новая заявка</div>
            <div onClick={() => { setActiveTab('history'); setMenuOpen(false); loadOrders(); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Мои заявки</div>
            <div onClick={() => { setActiveTab('referral'); setMenuOpen(false); loadReferrals(); }} style={{ padding: '14px 20px', cursor: 'pointer' }}>Мои баллы</div>
          </div>
        )}
      </div>
    </div>

    {/* Содержимое вкладки "Мои баллы" */}
    <div style={{ padding: '24px', textAlign: 'center' }}>
      <h2 style={{ marginBottom: '8px' }}>Мои баллы</h2>
      <div style={{ fontSize: '64px', fontWeight: '700', color: '#2563eb', marginBottom: '8px' }}>
        {balance} ₽
      </div>
      <p style={{ color: '#666' }}>Баллы можно использовать как скидку</p>

      <div style={{ marginTop: '50px' }}>
        <h3 style={{ marginBottom: '12px' }}>Твой реферальный код</h3>
        <div style={{ backgroundColor: '#f1f5f9', padding: '20px', borderRadius: '12px', fontSize: '26px', fontWeight: '700', letterSpacing: '3px', marginBottom: '20px' }}>
          {referralCode}
        </div>
        <button 
          onClick={() => {
            const link = `https://beton-order-app-nlnv.vercel.app/?ref=${referralCode}`;
            navigator.clipboard.writeText(link);
            alert('Реферальная ссылка скопирована!');
          }} 
          style={{ padding: '14px 32px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '12px', fontSize: '16px' }}
        >
          Скопировать ссылку
        </button>
      </div>
    </div>
  </div>
)}
        </div>
      </div>
    </div>
  );
}