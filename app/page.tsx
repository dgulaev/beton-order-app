'use client';

import { useEffect, useState, useMemo } from 'react';
import Image from 'next/image';

declare const WebApp: any;

type Screen = 'form' | 'success';

const pricePerCubic: Record<string, number> = {
  'М100': 6380,
  'М150': 6500,
  'М200': 6600,
  'М250': 6950,
  'М300': 7230,
  'М350': 7400,
  'М400': 8050,
  'М450': 8350,
  'М500': 8700,
};

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

  const [currentScreen, setCurrentScreen] = useState<Screen>('form');
  const [orderId, setOrderId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Расчёт стоимости
  const calculations = useMemo(() => {
    const volume = parseFloat(form.volume) || 0;
    if (volume <= 0) return { concreteCost: 0, deliveryCost: 0, total: 0 };

    const concreteCost = Math.round(volume * (pricePerCubic[form.grade] || 7230));

    let deliveryCost = 0;

    if (volume <= 12) {
      deliveryCost = 7500;                    // один рейс 12 м³
    } 
    else if (volume <= 50) {
      const trips = Math.ceil(volume / 10);
      deliveryCost = trips * 6000;            // рейсы по 10 м³
    } 
    else {
      deliveryCost = Math.round(volume * 600); // больше 50 м³ — 600 ₽/м³
    }

    const total = concreteCost + deliveryCost;

    return { 
      concreteCost, 
      deliveryCost, 
      total,
      trips: volume > 12 && volume <= 50 ? Math.ceil(volume / 10) : 1
    };
  }, [form.volume, form.grade]);

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

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleCustomerTypeChange = (type: 'physical' | 'legal') => {
    setForm(prev => ({ ...prev, customerType: type }));
  };

  const requestPhone = async () => {
    try {
      const wa = (window as any).WebApp;
      if (wa) {
        const result = await wa.requestContact();
        if (result?.phone) setForm(prev => ({ ...prev, phone: result.phone }));
      }
    } catch (e) {}
  };

  const handleSubmit = async () => {
    const wa = (window as any).WebApp;
    const showAlert = wa?.showAlert || alert;

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
      volume: parseFloat(form.volume) || 0,
      concreteCost: calculations.concreteCost,
      deliveryCost: calculations.deliveryCost,
      totalPrice: calculations.total,
      customerType: form.customerType === 'legal' ? 'Юридическое лицо' : 'Физическое лицо',
      timestamp: new Date().toISOString(),
      userId: wa?.initDataUnsafe?.user?.id,
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
      console.error(error);
      showAlert('Ошибка отправки. Попробуйте ещё раз.');
    } finally {
      setIsSubmitting(false);
      if (wa?.MainButton) wa.MainButton.hideProgress();
    }
  };

  if (currentScreen === 'success') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-5">
        <div className="max-w-md text-center">
          <div className="text-7xl mb-6">✅</div>
          <h2 className="text-3xl font-bold text-gray-900 mb-3">Заявка отправлена!</h2>
          <p className="text-gray-600 mb-8">
            Номер заявки: <span className="font-medium">#{orderId}</span><br />
            Менеджер свяжется с вами в ближайшее время.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-blue-600 text-white py-4 rounded-2xl font-medium text-lg"
          >
            Создать новую заявку
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-28">
      <div className="max-w-xl mx-auto p-5">
        <div className="text-center mb-10 mt-6">
          <h1 className="text-3xl font-bold text-gray-900">Заявка на отгрузку бетона</h1>
          <p className="text-base text-gray-600 mt-2">Бетонный завод</p>
        </div>

        <div className="space-y-6">
          {/* Марка бетона */}
          <div>
            <label className="block text-sm font-medium mb-2">Марка бетона</label>
            <select 
              name="grade" 
              value={form.grade} 
              onChange={handleChange} 
              className="w-full p-4 border border-gray-300 rounded-2xl text-lg bg-white"
            >
              <option value="М100">М100 (B7.5) — 6380 ₽/м³</option>
              <option value="М150">М150 (B12.5) — 6500 ₽/м³</option>
              <option value="М200">М200 (B15) — 6600 ₽/м³</option>
              <option value="М250">М250 (B20) — 6950 ₽/м³</option>
              <option value="М300">М300 (B22.5) — 7230 ₽/м³</option>
              <option value="М350">М350 (B25) — 7400 ₽/м³</option>
              <option value="М400">М400 (B30) — 8050 ₽/м³</option>
              <option value="М450">М450 — 8350 ₽/м³</option>
              <option value="М500">М500 — 8700 ₽/м³</option>
            </select>
          </div>

          {/* Объём */}
          <div>
            <label className="block text-sm font-medium mb-2">Объём, м³</label>
            <input
              type="number"
              name="volume"
              value={form.volume}
              onChange={handleChange}
              step="0.1"
              min="0.5"
              placeholder="Например: 12.5"
              className="w-full p-4 border border-gray-300 rounded-2xl text-lg"
            />
          </div>

          {/* Блок стоимости */}
          {calculations.total > 0 && (
            <div className="bg-blue-50 border border-blue-200 p-5 rounded-2xl space-y-3">
              <div className="flex justify-between">
                <span className="text-gray-600">Стоимость бетона:</span>
                <span className="font-medium">{calculations.concreteCost.toLocaleString('ru-RU')} ₽</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Доставка миксером:</span>
                <span className="font-medium">{calculations.deliveryCost.toLocaleString('ru-RU')} ₽</span>
              </div>
              <div className="border-t pt-3 flex justify-between text-lg font-semibold text-blue-900">
                <span>Итого к оплате:</span>
                <span>{calculations.total.toLocaleString('ru-RU')} ₽</span>
              </div>
              
              <p className="text-xs text-blue-600 pt-1">
                {parseFloat(form.volume) <= 12 
                  ? "Доставка: 7500 ₽ за один рейс (миксер 12 м³)" 
                  : parseFloat(form.volume) <= 50 
                    ? `Доставка: ${calculations.trips} рейса × 6000 ₽` 
                    : "Доставка: 600 ₽ за 1 м³"}
              </p>
            </div>
          )}

          {/* Дата и время */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2">Дата доставки</label>
              <input type="date" name="deliveryDate" value={form.deliveryDate} onChange={handleChange} className="w-full p-4 border border-gray-300 rounded-2xl" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Время доставки</label>
              <input type="time" name="deliveryTime" value={form.deliveryTime} onChange={handleChange} className="w-full p-4 border border-gray-300 rounded-2xl" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Адрес доставки</label>
            <textarea name="address" value={form.address} onChange={handleChange} rows={3} placeholder="Город, улица, дом, подъезд, этаж..." className="w-full p-4 border border-gray-300 rounded-2xl resize-y" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-3">Тип заказчика</label>
            <div className="flex gap-3">
              <button type="button" onClick={() => handleCustomerTypeChange('physical')} className={`flex-1 py-4 rounded-2xl border font-medium ${form.customerType === 'physical' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300'}`}>Физическое лицо</button>
              <button type="button" onClick={() => handleCustomerTypeChange('legal')} className={`flex-1 py-4 rounded-2xl border font-medium ${form.customerType === 'legal' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300'}`}>Юридическое лицо</button>
            </div>
          </div>

          {form.customerType === 'physical' ? (
            <div>
              <label className="block text-sm font-medium mb-2">ФИО заказчика</label>
              <input type="text" name="fullName" value={form.fullName} onChange={handleChange} placeholder="Иванов Иван Иванович" className="w-full p-4 border border-gray-300 rounded-2xl" />
            </div>
          ) : (
            <div>
              <label className="block text-sm font-medium mb-2">Название организации</label>
              <input type="text" name="organizationName" value={form.organizationName} onChange={handleChange} placeholder="ООО «БетонСтрой»" className="w-full p-4 border border-gray-300 rounded-2xl" />
            </div>
          )}

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm font-medium">Телефон для связи</label>
              <button type="button" onClick={requestPhone} className="text-blue-600 text-sm font-medium">Запросить мой контакт</button>
            </div>
            <input type="tel" name="phone" value={form.phone} onChange={handleChange} placeholder="+7 (___) ___-__-__" className="w-full p-4 border border-gray-300 rounded-2xl" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">Комментарий</label>
            <textarea name="comment" value={form.comment} onChange={handleChange} rows={2} placeholder="Дополнительная информация (необязательно)" className="w-full p-4 border border-gray-300 rounded-2xl resize-y" />
          </div>

          <div className="pt-6">
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-400 text-white font-medium py-4 rounded-2xl text-lg transition-colors"
            >
              {isSubmitting ? 'Отправляем...' : 'Отправить заявку'}
            </button>
          </div>

          <div className="flex justify-center pt-12 pb-8">
            <div className="relative w-20 h-20 opacity-70">
              <Image src="/logo.jpg" alt="Логотип" fill className="object-contain" priority />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}