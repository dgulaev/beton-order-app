'use client';
// app/adminCifra/mixers/DeliverySettingsTab.tsx
// Вкладка «Тарифы доставки» на странице «Миксеры» — доступна только admin
// (проверка роли — в родителе, app/adminCifra/mixers/page.tsx, здесь сама
// вкладка ничего не проверяет). Редактирует единственную строку таблицы
// delivery_settings через /api/adminCifra/delivery-settings — эти же цифры
// читают ВСЕ формы создания заявки (десктоп, мобильная админка, клиентская
// страница заказа), см. lib/deliveryPricing.ts.

import { useEffect, useState } from 'react';
import { Truck, MapPin, Save, RotateCcw } from 'lucide-react';
import { DEFAULT_DELIVERY_SETTINGS, type DeliverySettings } from '@/lib/deliveryPricing';
import { volumeCardSoftStyle, volumeCardStyle } from '../cardStyles';
import { appConfirm } from '../components/appDialog';

const cardStyle: React.CSSProperties = volumeCardStyle({
  borderRadius: 22,
  padding: '24px 28px',
});

const inputStyle: React.CSSProperties = {
  width: '140px',
  padding: '12px 14px',
  background: '#25334A',
  border: 'none',
  borderRadius: '12px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 600,
  textAlign: 'right',
  boxSizing: 'border-box',
};

interface FieldRowProps {
  label: string;
  hint: string;
  value: number;
  suffix: string;
  onChange: (value: number) => void;
}

function FieldRow({ label, hint, value, suffix, onChange }: FieldRowProps) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '20px', padding: '14px 0', borderBottom: '1px solid #334155' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: '15.5px' }}>{label}</div>
        <div style={{ color: '#94A3B8', fontSize: '13px', marginTop: '3px' }}>{hint}</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
        <input
          type="number"
          min="0"
          step="1"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          style={inputStyle}
        />
        <span style={{ color: '#94A3B8', fontSize: '14px', whiteSpace: 'nowrap' }}>{suffix}</span>
      </div>
    </div>
  );
}

export default function DeliverySettingsTab() {
  const [settings, setSettings] = useState<DeliverySettings>(DEFAULT_DELIVERY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/adminCifra/delivery-settings');
        if (res.ok) {
          const data = await res.json();
          setSettings({
            price_tier_10: Number(data.price_tier_10) || DEFAULT_DELIVERY_SETTINGS.price_tier_10,
            price_tier_12: Number(data.price_tier_12) || DEFAULT_DELIVERY_SETTINGS.price_tier_12,
            price_tier_trip: Number(data.price_tier_trip) || DEFAULT_DELIVERY_SETTINGS.price_tier_trip,
            price_per_m3_over_50: Number(data.price_per_m3_over_50) || DEFAULT_DELIVERY_SETTINGS.price_per_m3_over_50,
            price_per_km: Number(data.price_per_km) || DEFAULT_DELIVERY_SETTINGS.price_per_km,
            road_curvature_coefficient: Number(data.road_curvature_coefficient) || DEFAULT_DELIVERY_SETTINGS.road_curvature_coefficient,
          });
        }
      } catch (e) {
        console.error('Ошибка загрузки тарифов доставки:', e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = (field: keyof DeliverySettings) => (value: number) => {
    setSettings((prev) => ({ ...prev, [field]: value }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/adminCifra/delivery-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        alert('✅ Тарифы доставки сохранены. Новые заявки будут считаться по обновлённым значениям.');
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error || 'Не удалось сохранить тарифы. Проверьте, что таблица delivery_settings создана в базе (см. scripts/delivery-settings-schema.sql).');
      }
    } catch (e) {
      alert('Ошибка соединения с сервером');
    } finally {
      setSaving(false);
    }
  };

  const resetToDefaults = async () => {
    if (await appConfirm('Вернуть исходные значения (до правок)? Изменения ещё не сохранены — можно просто продолжить редактировать.')) {
      setSettings(DEFAULT_DELIVERY_SETTINGS);
    }
  };

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '100px', color: '#94A3B8' }}>Загрузка тарифов...</div>;
  }

  return (
    <div className="scroll-hidden" style={{ flex: 1, minHeight: 0, overflowY: 'auto', maxWidth: '760px' }}>
      <div style={{ color: '#94A3B8', fontSize: '14.5px', marginBottom: '20px', lineHeight: 1.5 }}>
        Эти значения используются во всех формах создания заявки — в админке, мобильной версии и на клиентской странице заказа.
        Изменения применяются сразу после сохранения, к <b style={{ color: '#CBD5E1' }}>новым</b> заявкам — уже созданные заявки не пересчитываются.
      </div>

      {/* ==================== ДОСТАВКА В ЧЕРТЕ БРЯНСКА ==================== */}
      <div style={{ ...cardStyle, marginBottom: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <Truck size={20} color="#10B981" />
          <h3 style={{ margin: 0, fontSize: '17px' }}>Доставка в черте Брянска</h3>
        </div>
        <div style={{ color: '#64748B', fontSize: '13px', marginBottom: '8px' }}>
          Применяется, если в адресе указан сам Брянск — или город/посёлок не указан вовсе.
        </div>

        <FieldRow
          label="До 10 м³"
          hint="Один рейс стандартного миксера"
          value={settings.price_tier_10}
          suffix="₽ за рейс"
          onChange={update('price_tier_10')}
        />
        <FieldRow
          label="От 10 до 12 м³"
          hint="Один рейс более вместительного миксера"
          value={settings.price_tier_12}
          suffix="₽ за рейс"
          onChange={update('price_tier_12')}
        />
        <FieldRow
          label="От 12 до 50 м³"
          hint="Количество рейсов = округление вверх(объём ÷ 10)"
          value={settings.price_tier_trip}
          suffix="₽ за рейс"
          onChange={update('price_tier_trip')}
        />
        <div style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <FieldRow
            label="Более 50 м³"
            hint="Тариф за кубометр вместо тарифа за рейс"
            value={settings.price_per_m3_over_50}
            suffix="₽ за 1 м³"
            onChange={update('price_per_m3_over_50')}
          />
        </div>
      </div>

      {/* ==================== ДОСТАВКА ЗА ГОРОДОМ ==================== */}
      <div style={{ ...cardStyle, marginBottom: '24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <MapPin size={20} color="#3B82F6" />
          <h3 style={{ margin: 0, fontSize: '17px' }}>Доставка за пределами Брянска</h3>
        </div>
        <div style={{ color: '#64748B', fontSize: '13px', marginBottom: '8px' }}>
          Применяется, если в адресе явно указан другой населённый пункт или «Брянская область» — тогда тарифы выше не используются вовсе,
          стоимость считается только по километражу: расстояние (км) × ставка × количество рейсов.
        </div>

        <FieldRow
          label="Ставка за километр"
          hint="В одну сторону — умножается на количество рейсов миксера"
          value={settings.price_per_km}
          suffix="₽ за км"
          onChange={update('price_per_km')}
        />
        <div style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <FieldRow
            label="Коэффициент кривизны дорог"
            hint="Расстояние по прямой (координаты) умножается на него — приближение к реальной длине дороги"
            value={settings.road_curvature_coefficient}
            suffix="×"
            onChange={update('road_curvature_coefficient')}
          />
        </div>

        <div style={volumeCardSoftStyle({ marginTop: '16px', borderRadius: 12, padding: '14px 16px', color: '#94A3B8', fontSize: '13px', lineHeight: 1.5 })}>
          Пример: до пункта в Брянской области 130 км по прямой, коэффициент {settings.road_curvature_coefficient} → реальный путь ≈{' '}
          {Math.round(130 * settings.road_curvature_coefficient)} км. Один рейс: {Math.round(130 * settings.road_curvature_coefficient)} км ×{' '}
          {settings.price_per_km.toLocaleString('ru-RU')} ₽ ={' '}
          <b style={{ color: '#CBD5E1' }}>
            {Math.round(130 * settings.road_curvature_coefficient * settings.price_per_km).toLocaleString('ru-RU')} ₽
          </b>
          .
        </div>
      </div>

      {/* ==================== КНОПКИ ==================== */}
      <div style={{ display: 'flex', gap: '10px' }}>
        <button
          onClick={save}
          disabled={saving}
          style={volumeCardSoftStyle({
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '12px 26px',
            background: saving
              ? '#475569'
              : 'linear-gradient(165deg, #10B981 0%, #059669 100%)',
            border: '1px solid rgba(110,231,183,0.35)',
            borderRadius: 12,
            color: 'white',
            fontWeight: 700,
            fontSize: '14.5px',
            cursor: saving ? 'not-allowed' : 'pointer',
          })}
        >
          <Save size={16} />
          {saving ? 'Сохраняем...' : 'Сохранить тарифы'}
        </button>
        <button
          onClick={resetToDefaults}
          style={volumeCardSoftStyle({
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '12px 22px',
            borderRadius: 12,
            color: '#94A3B8',
            fontWeight: 600,
            fontSize: '14.5px',
            cursor: 'pointer',
          })}
        >
          <RotateCcw size={15} />
          Сбросить к исходным
        </button>
      </div>
    </div>
  );
}
