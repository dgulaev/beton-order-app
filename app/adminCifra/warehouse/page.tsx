'use client';

import { useState, useEffect } from 'react';

export default function WarehousePage() {

  // ==================== 1. СОСТОЯНИЕ ====================
  const [silos, setSilos] = useState<any[]>([]);
  const [additives, setAdditives] = useState<any[]>([]);
  const [todayConsumption, setTodayConsumption] = useState({ cement: 0, additive: 0 });

  // ==================== 2. ЗАГРУЗКА ДАННЫХ ====================
  const loadWarehouse = async () => {
    try {
      const res = await fetch('/api/adminCifra/warehouse');
      if (res.ok) {
        const data = await res.json();
        setSilos(data.silos || []);
        setAdditives(data.additives || []);
      }
    } catch (err) {
      console.error('Ошибка загрузки склада:', err);
    }
  };

  const loadTodayConsumption = async () => {
    try {
      const res = await fetch('/api/adminCifra/production-log?today=true');
      if (res.ok) {
        const data = await res.json();
        let cementTotal = 0;
        let additiveTotal = 0;

        data.forEach((log: any) => {
          const volume = parseFloat(log.volume || 0);
          cementTotal += volume * 350;
          additiveTotal += volume * 4.5;
        });

        setTodayConsumption({
          cement: Math.round(cementTotal / 1000),
          additive: Math.round(additiveTotal)
        });
      }
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadWarehouse();
    loadTodayConsumption();
  }, []);

                    // ==================== 3. СОХРАНЕНИЕ В БАЗУ ====================
  const saveToDatabase = async (silosToSave?: any[]) => {
    try {
      const data = silosToSave || silos;

      const response = await fetch('/api/adminCifra/warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          silos: data.map(s => ({
            silo_id: s.silo_id,
            name: s.name,
            current: Number(s.current),
            max: s.max,
            nominal: s.nominal
          }))
        })
      });

      if (response.ok) {
        console.log('✅ Успешно сохранено в базу');
      } else {
        console.error('❌ Сервер вернул ошибку');
      }
    } catch (err) {
      console.error('Ошибка сохранения:', err);
    }
  };

      // ==================== 4. ВНЕСТИ ЦЕМЕНТ ====================
  const handleAddCement = (id: number) => {
    const input = prompt(`Введите количество цемента (в килограммах) для силоса №${id}:`);
    if (input === null) return;

    const kg = parseFloat(input);
    if (isNaN(kg)) {
      alert('Введите число');
      return;
    }

    const tons = kg / 1000;

    setSilos(prev => {
      const updatedSilos = prev.map(s => 
        s.silo_id === id ? { ...s, current: Math.max(-50, s.current + tons) } : s
      );

      saveToDatabase(updatedSilos);
      return updatedSilos;
    });
  };

                    // ==================== 5. ОБНУЛЕНИЕ СИЛОСА ====================
  const resetSilo = (id: number) => {
    if (confirm(`Обнулить силос №${id}?`)) {
      setSilos(prev => {
        const updatedSilos = prev.map(s => 
          s.silo_id === id ? { ...s, current: 0 } : s
        );

        saveToDatabase(updatedSilos);   // Передаём свежее состояние
        return updatedSilos;
      });
    }
  };

  // ==================== 6. ФОРМАТИРОВАНИЕ ЦЕМЕНТА ====================
  const formatCement = (tons: number) => {
    return tons.toFixed(3) + ' т';
  };

  return (
    <div style={{ backgroundColor: '#0F172A', minHeight: '100vh', color: '#fff', padding: '20px' }}>
      <h1 style={{ fontSize: '28px', marginBottom: '24px' }}>Склад</h1>

      {/* ==================== 7. СТАТИСТИКА ==================== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <div style={{ background: '#1E2937', padding: '20px', borderRadius: '20px' }}>
          <div style={{ color: '#94A3B8' }}>Расход цемента сегодня</div>
          <div style={{ fontSize: '32px', fontWeight: '700', color: '#10B981' }}>
            {todayConsumption.cement} т
          </div>
        </div>
        <div style={{ background: '#1E2937', padding: '20px', borderRadius: '20px' }}>
          <div style={{ color: '#94A3B8' }}>Расход добавок сегодня</div>
          <div style={{ fontSize: '32px', fontWeight: '700', color: '#60A5FA' }}>
            {todayConsumption.additive} кг
          </div>
        </div>
      </div>

      {/* ==================== 8. СИЛОСЫ ЦЕМЕНТА ==================== */}
      <h2 style={{ marginBottom: '16px', fontSize: '22px' }}>Силосы цемента</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))', gap: '20px', marginBottom: '40px' }}>
        {silos.map(silo => {
          const percent = Math.min(Math.max((silo.current / silo.max) * 100, 0), 100);
          const isNegative = silo.current < 0;

          return (
            <div key={`silo-${silo.silo_id}`} style={{ background: '#1E2937', borderRadius: '20px', padding: '24px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                <h3>{silo.name}</h3>
                <div style={{ 
                  color: isNegative ? '#EF4444' : '#10B981', 
                  fontWeight: '600',
                  fontSize: '18px'
                }}>
                  {formatCement(silo.current)} / {silo.max} т
                </div>
              </div>

              <div style={{ height: '28px', background: '#334155', borderRadius: '9999px', overflow: 'hidden', marginBottom: '16px' }}>
                <div style={{
                  width: `${percent}%`,
                  height: '100%',
                  background: isNegative ? 'linear-gradient(90deg, #EF4444, #F87171)' : 'linear-gradient(90deg, #10B981, #34D399)',
                  transition: 'width 0.4s ease'
                }} />
              </div>

              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={() => handleAddCement(silo.silo_id)} style={{ padding: '8px 16px', background: '#3B82F6', border: 'none', borderRadius: '9999px', color: 'white', cursor: 'pointer' }}>
                  Внести цемент
                </button>
                <button onClick={() => {
                  const val = parseFloat(prompt('Списать цемент (тонн):') || '0');
                  if (val) handleAddCement(silo.silo_id);
                }} style={{ padding: '8px 16px', background: '#EF4444', border: 'none', borderRadius: '9999px', color: 'white', cursor: 'pointer' }}>
                  - Расход
                </button>
                <button onClick={() => resetSilo(silo.silo_id)} style={{ padding: '8px 16px', background: '#475569', border: 'none', borderRadius: '9999px', color: 'white', cursor: 'pointer' }}>
                  Обнулить
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ==================== 9. ЁМКОСТИ ДОБАВОК ==================== */}
      <h2 style={{ marginBottom: '16px', fontSize: '22px' }}>Ёмкости добавок</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
        {additives.map((add, index) => (
          <div key={`add-${add.additive_id}-${index}`} style={{ background: '#1E2937', padding: '20px', borderRadius: '20px' }}>
            <div style={{ fontWeight: '600', marginBottom: '12px' }}>{add.name}</div>
            <div style={{ height: '12px', background: '#334155', borderRadius: '9999px', marginBottom: '12px', overflow: 'hidden' }}>
              <div style={{ width: `${(add.current / add.max) * 100}%`, height: '100%', background: '#8B5CF6' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px' }}>
              <span>{Math.round(add.current)} кг</span>
              <span style={{ color: '#64748B' }}>/ {add.max} кг</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}