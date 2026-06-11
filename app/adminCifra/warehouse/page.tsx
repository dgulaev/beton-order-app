'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';

export default function WarehousePage() {


    // ==================== 1. СОСТОЯНИЕ ====================
  const [silos, setSilos] = useState<any[]>([]);
  const [additives, setAdditives] = useState<any[]>([]);
  const [todayConsumption, setTodayConsumption] = useState({ 
    cement: 0, 
    pfm: 0, 
    linomix: 0 
  });
  const [operationHistory, setOperationHistory] = useState<any[]>([]);

  const isProcessingRef = useRef(false);

      // ==================== 2. ЗАГРУЗКА ДАННЫХ ====================
  const loadWarehouse = async () => {
    try {
      const res = await fetch('/api/adminCifra/warehouse', { 
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
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
      const res = await fetch('/api/adminCifra/production-log?today=true', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' }
      });

      if (res.ok) {
        const data = await res.json();
        let totalVolume = 0;

        const logs = data.logs || data || [];

        logs.forEach((log: any) => {
          const volume = parseFloat(log.volume || log.qty || 0);
          totalVolume += volume;
        });

        const newConsumption = {
          cement: Math.round(totalVolume * 350 / 1000),
          pfm: Math.round(totalVolume * 1.16),
          linomix: Math.round(totalVolume * 1.18)
        };

        setTodayConsumption(newConsumption);
        console.log('✅ Расход обновлён:', newConsumption, ' | Объём сегодня:', totalVolume.toFixed(2), 'м³');
      } else {
        console.warn('Не удалось получить данные production-log');
      }
    } catch (err) {
      console.error('Ошибка загрузки расхода сегодня:', err);
    }
  };

  const loadOperationHistory = async () => {
    try {
      const res = await fetch('/api/adminCifra/warehouse/history', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' }
      });
      if (res.ok) {
        const data = await res.json();
        setOperationHistory(data || []);
      }
    } catch (err) {
      console.error('Ошибка загрузки истории:', err);
    }
  };

           // ==================== 3. СОХРАНЕНИЕ В БАЗУ ====================
  const saveToDatabase = async (silosToSave?: any[], additivesToSave?: any[]) => {
    try {
      const currentSilos = silosToSave || silos;
      const currentAdditives = additivesToSave || additives;

      const payload = {
        silos: currentSilos.map((s: any) => ({
          silo_id: Number(s.silo_id),
          current: Number(s.current || 0)
        })),
        additives: currentAdditives.map((add: any, idx: number) => ({
          additive_id: idx + 1,
          current: Number(add?.current || 0)
        }))
      };

      const response = await fetch('/api/adminCifra/warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        console.log('✅ Данные успешно сохранены в базу');
      }
    } catch (err) {
      console.error('💥 Ошибка сохранения:', err);
    }
  };

     // ==================== 0. ЗАГРУЗКА ДАННЫХ И ИНИЦИАЛИЗАЦИЯ ====================
  useEffect(() => {
    loadWarehouse();
    loadTodayConsumption();

    (window as any).subtractAdditivesFromReport = subtractAdditivesFromReport;

    console.log('✅ WarehousePage загружен');

    // Обновление каждые 10 секунд
    const interval = setInterval(loadTodayConsumption, 10000);

    return () => clearInterval(interval);
  }, []);

       // ==================== 4. ВНЕСТИ ЦЕМЕНТ ====================
  const handleAddCement = (id: number) => {
    const input = prompt(`Введите количество цемента (в килограммах) для силоса №${id}:`);
    if (input === null) return;

    const kg = parseFloat(input);
    if (isNaN(kg) || kg <= 0) {
      alert('Введите положительное число');
      return;
    }

    const tons = kg / 1000;

    setSilos(prev => {
      const updatedSilos = prev.map(s => {
        if (s.silo_id === id) {
          const oldCurrent = Number(s.current || 0);
          const newCurrent = Math.max(-50, oldCurrent + tons);
          
          addToHistory('+ Внесено', s.name || `Силос №${id}`, kg, oldCurrent * 1000, newCurrent * 1000, 'кг');
          
          return { ...s, current: newCurrent };
        }
        return s;
      });

      saveToDatabase(updatedSilos);
      return updatedSilos;
    });
  };

  // ==================== 4.1 СПИСАТЬ ЦЕМЕНТ ====================
  const handleSubtractCement = (id: number) => {
    const input = prompt(`Введите количество цемента (в килограммах) для списания из силоса №${id}:`);
    if (input === null) return;

    const kg = parseFloat(input);
    if (isNaN(kg) || kg <= 0) {
      alert('Введите положительное число');
      return;
    }

    const tons = kg / 1000;

    setSilos(prev => {
      const updatedSilos = prev.map(s => {
        if (s.silo_id === id) {
          const oldCurrent = Number(s.current || 0);
          const newCurrent = Math.max(0, oldCurrent - tons);
          
          addToHistory('− Списано', s.name || `Силос №${id}`, kg, oldCurrent * 1000, newCurrent * 1000, 'кг');
          
          return { ...s, current: newCurrent };
        }
        return s;
      });

      saveToDatabase(updatedSilos);
      return updatedSilos;
    });
  };

  // ==================== 5. ОБНУЛЕНИЕ СИЛОСА ====================
  const resetSilo = (id: number) => {
    if (confirm(`Обнулить силос №${id}?`)) {
      setSilos(prev => {
        const updatedSilos = prev.map(s => {
          if (s.silo_id === id) {
            const oldCurrent = Number(s.current || 0);
            addToHistory('Обнулен', s.name || `Силос №${id}`, oldCurrent * 1000, oldCurrent * 1000, 0, 'кг');
            return { ...s, current: 0 };
          }
          return s;
        });

        saveToDatabase(updatedSilos);
        return updatedSilos;
      });
    }
  };

  // ==================== 6. ФОРМАТИРОВАНИЕ ЦЕМЕНТА ====================
  const formatCement = (tons: number) => {
    return tons.toFixed(3) + ' т';
  };

                           // ==================== 6.1 РАБОТА С ДОБАВКАМИ (ТОЧНО КАК ЦЕМЕНТ) ====================
  const handleAddAdditive = (index: number) => {
    const name = index === 0 ? 'ПФМ-НЛК' : 'Линомикс ТипР';
    const input = prompt(`Сколько литров добавить в ${name}?`);
    if (input === null) return;
    const liters = parseFloat(input);
    if (isNaN(liters) || liters <= 0) return alert('Введите положительное число');

    setAdditives(prev => {
      const updated = prev.map((add, i) => {
        if (i === index) {
          const oldCurrent = Number(add?.current || 0);
          const newCurrent = oldCurrent + liters;
          
          addToHistory('+ Внесено', name, liters, oldCurrent, newCurrent, 'л');
          
          return { ...add, current: newCurrent };
        }
        return add;
      });

      saveToDatabase(undefined, updated);   // silos = undefined, additives = updated
      return updated;
    });
  };

  const handleSubtractAdditive = (index: number) => {
    const name = index === 0 ? 'ПФМ-НЛК' : 'Линомикс ТипР';
    const input = prompt(`Сколько литров списать из ${name}?`);
    if (input === null) return;
    const liters = parseFloat(input);
    if (isNaN(liters) || liters <= 0) return alert('Введите положительное число');

    setAdditives(prev => {
      const updated = prev.map((add, i) => {
        if (i === index) {
          const oldCurrent = Number(add?.current || 0);
          const newCurrent = Math.max(0, oldCurrent - liters);
          
          addToHistory('− Списано', name, liters, oldCurrent, newCurrent, 'л');
          
          return { ...add, current: newCurrent };
        }
        return add;
      });

      saveToDatabase(undefined, updated);
      return updated;
    });
  };

  const resetAdditive = (index: number) => {
    const name = index === 0 ? 'ПФМ-НЛК' : 'Линомикс ТипР';
    if (confirm(`Обнулить ${name}?`)) {
      setAdditives(prev => {
        const updated = prev.map((add, i) => {
          if (i === index) {
            const oldCurrent = Number(add?.current || 0);
            addToHistory('Обнулен', name, oldCurrent, oldCurrent, 0, 'л');
            return { ...add, current: 0 };
          }
          return add;
        });

        saveToDatabase(undefined, updated);
        return updated;
      });
    }
  };

               // ==================== 6.2 ДОБАВИТЬ НОВЫЙ КУБИК ====================
  const addNewCube = (index: number) => {
    if (index !== 0) {
      alert('Пока добавление кубиков работает только для ПФМ-НЛК');
      return;
    }

    const now = Date.now();
    if ((window as any).lastCubeActionTime && now - (window as any).lastCubeActionTime < 400) {
      console.log('⛔ Слишком быстрое нажатие — игнорируем');
      return;
    }
    (window as any).lastCubeActionTime = now;

    setAdditives(prev => {
      const updated = [...prev];

      if (!updated[index]) {
        updated[index] = { current: 0, max: 9000, name: 'ПФМ-НЛК' };
      } else {
        updated[index].max = (updated[index].max || 9000) + 1000;
      }

      console.log(`✅ Добавлен новый кубик. Новый max = ${updated[index].max} л`);

      setTimeout(() => {
        saveToDatabase();
      }, 100);

      return updated;
    });
  };

  // ==================== 6.3 УДАЛИТЬ ПОСЛЕДНИЙ КУБИК ====================
  const removeLastCube = (index: number) => {
    if (index !== 0) return;

    const now = Date.now();
    if ((window as any).lastCubeActionTime && now - (window as any).lastCubeActionTime < 400) {
      console.log('⛔ Слишком быстрое нажатие — игнорируем');
      return;
    }
    (window as any).lastCubeActionTime = now;

    setAdditives(prev => {
      const updated = [...prev];
      if (!updated[index]) return prev;

      const currentMax = updated[index].max || 9000;
      if (currentMax <= 9000) {
        alert('Нельзя удалить кубик — уже минимальное количество (9)');
        return prev;
      }

      updated[index].max = currentMax - 1000;
      
      console.log(`🗑 Удалён последний кубик. Новый max = ${updated[index].max} л`);
      
      setTimeout(() => {
        saveToDatabase();
      }, 100);

      return updated;
    });
  };

      // ==================== 6.4 СПИСАНИЕ ДОБАВОК ПО ОТЧЁТУ ====================
  const subtractAdditivesFromReport = async (pfmLiters: number, linomixLiters: number) => {
    if (pfmLiters <= 0 && linomixLiters <= 0) {
      alert('Нет расхода добавок в отчёте');
      return;
    }

    if (!confirm(`Списать по отчёту:\n` +
                `ПФМ-НЛК: ${pfmLiters.toFixed(1)} л\n` +
                `Линомикс ТипР: ${linomixLiters.toFixed(1)} л ?`)) {
      return;
    }

    setAdditives(prev => {
      const updated = [...prev];

      // ПФМ-НЛК (index 0)
      if (updated[0] && pfmLiters > 0) {
        const old = Number(updated[0].current || 0);
        updated[0].current = Math.max(0, old - pfmLiters);
        console.log(`📉 Списано ${pfmLiters.toFixed(1)} л ПФМ-НЛК. Было: ${old.toFixed(1)} → Стало: ${updated[0].current.toFixed(1)}`);
      }

      // Линомикс (index 1)
      if (updated[1] && linomixLiters > 0) {
        const old = Number(updated[1].current || 0);
        updated[1].current = Math.max(0, old - linomixLiters);
        console.log(`📉 Списано ${linomixLiters.toFixed(1)} л Линомикс. Было: ${old.toFixed(1)} → Стало: ${updated[1].current.toFixed(1)}`);
      }

      // Сохраняем изменения
      saveToDatabase();
      return updated;
    });
  };

                                  // ==================== 7. ЛОГИРОВАНИЕ ОПЕРАЦИЙ ====================
  const addToHistory = (action: string, item: string, amount: number, oldValue: number, newValue: number, unit: string = 'л') => {
    const now = Date.now();
    const key = `history_${item}_${action}`;

    // Сильная защита от двойного вызова
    if ((window as any)[key] && now - (window as any)[key] < 1000) {
      console.log(`⛔ Дублирование заблокировано`);
      return;
    }
    (window as any)[key] = now;

    const entry = {
      action,
      operation_type: action.includes('Внес') || action.includes('Добав') ? 'add' : 
                      action.includes('Спис') ? 'subtract' : 'reset',
      item_type: item,
      amount: Number(amount),
      old_value: Number(oldValue),
      new_value: Number(newValue),
      unit: unit,
      time: new Date().toISOString()
    };

    setOperationHistory(prev => [entry, ...prev].slice(0, 20));
  }; 

  // ==================== 7. ОСНОВНОЙ РЕНДЕР ====================
  return (
    <div style={{ 
      backgroundColor: '#0F172A', 
      minHeight: '100vh', 
      color: '#E2E8F0', 
      padding: '24px',
      fontFamily: 'system-ui, sans-serif'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
      </div>

                 {/* ==================== МЕТРИКИ РАСХОДА СЕГОДНЯ ==================== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '20px', marginBottom: '48px' }}>
        
        {/* Цемент */}
        <div style={{ 
          background: '#1E2937', 
          padding: '28px 32px', 
          borderRadius: '20px',
          border: '1px solid #334155'
        }}>
          <div style={{ color: '#94A3B8', fontSize: '15px', marginBottom: '8px' }}>
            Расход цемента сегодня
          </div>
          <div style={{ fontSize: '52px', fontWeight: '700', color: '#10B981', lineHeight: '1' }}>
            {todayConsumption.cement} <span style={{ fontSize: '26px', color: '#64748B' }}>т</span>
          </div>
        </div>

        {/* ПФМ-НЛК */}
        <div style={{ 
          background: '#1E2937', 
          padding: '28px 32px', 
          borderRadius: '20px',
          border: '1px solid #334155'
        }}>
          <div style={{ color: '#94A3B8', fontSize: '15px', marginBottom: '8px' }}>
            Расход ПФМ-НЛК сегодня
          </div>
          <div style={{ fontSize: '52px', fontWeight: '700', color: '#C084FC', lineHeight: '1' }}>
            {todayConsumption.pfm} <span style={{ fontSize: '26px', color: '#64748B' }}>кг</span>
          </div>
        </div>

        {/* Линомикс ТипР */}
        <div style={{ 
          background: '#1E2937', 
          padding: '28px 32px', 
          borderRadius: '20px',
          border: '1px solid #334155'
        }}>
          <div style={{ color: '#94A3B8', fontSize: '15px', marginBottom: '8px' }}>
            Расход Линомикс ТипР сегодня
          </div>
          <div style={{ fontSize: '52px', fontWeight: '700', color: '#60A5FA', lineHeight: '1' }}>
            {todayConsumption.linomix} <span style={{ fontSize: '26px', color: '#64748B' }}>кг</span>
          </div>
        </div>

      </div>

            {/* ==================== 8. ВЕРТИКАЛЬНЫЕ СИЛОСЫ ==================== */}
      <h2 style={{ fontSize: '24px', marginBottom: '24px', color: '#CBD5E1' }}>Силосы цемента</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '32px' }}>
        {silos.map((silo: any) => {
          const current = Number(silo.current || 0);
          const max = Number(silo.max || 1);
          const percent = Math.min(Math.max((current / max) * 100, 0), 100);

          // Цветовая логика по вашему запросу
          let fillColor = '#22c55e'; // зелёный по умолчанию
          let textColor = '#34D399';

          if (current < 0) {
            fillColor = '#ef4444';   // красный
            textColor = '#F87171';
          } else if (percent < 30) {
            fillColor = '#f59e0b';   // оранжевый
            textColor = '#FBBF24';
          }

          // Делаем силос №3 шире
          const isLargeSilo = silo.silo_id === 3 || silo.name.toLowerCase().includes('3');
          const barrelWidth = isLargeSilo ? 190 : 160;
          const barrelHeight = isLargeSilo ? 340 : 320;

          return (
            <div key={silo.silo_id} style={{ textAlign: 'center' }}>
              <div style={{ 
                margin: '0 auto 16px', 
                width: `${barrelWidth}px`, 
                height: `${barrelHeight}px`, 
                position: 'relative',
                filter: 'drop-shadow(0 20px 30px rgba(0,0,0,0.6))'
              }}>
                {/* Крышка */}
                <div style={{
                  position: 'absolute',
                  top: '-20px',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: isLargeSilo ? '130px' : '110px',
                  height: '42px',
                  background: '#475569',
                  borderRadius: '50% 50% 0 0',
                  zIndex: 3,
                  border: '4px solid #64748B'
                }} />

                {/* Тело силоса */}
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  width: '100%',
                  height: `${barrelHeight - 20}px`,
                  background: '#1E2937',
                  border: '6px solid #64748B',
                  borderRadius: '24px 24px 10px 10px',
                  overflow: 'hidden',
                  boxShadow: 'inset 0 0 40px rgba(0,0,0,0.7)'
                }}>
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    width: '100%',
                    height: `${percent}%`,
                    background: fillColor,
                    transition: 'height 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)'
                  }} />
                </div>

                {/* Блик */}
                <div style={{
                  position: 'absolute',
                  top: '70px',
                  left: '24px',
                  width: '36px',
                  height: isLargeSilo ? '170px' : '140px',
                  background: 'linear-gradient(transparent, rgba(255,255,255,0.28), transparent)',
                  transform: 'rotate(12deg)',
                  zIndex: 2
                }} />
              </div>

              <h3 style={{ fontSize: '21px', marginBottom: '6px' }}>{silo.name}</h3>
              <div style={{ 
                fontSize: '26px', 
                fontWeight: '700', 
                color: textColor 
              }}>
                {formatCement(current)} / {silo.max} т
              </div>
              <div style={{ fontSize: '14px', color: '#64748B', marginTop: '4px' }}>
                {percent.toFixed(0)}% заполнено
              </div>

              <div style={{ marginTop: '20px', display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                <button onClick={() => handleAddCement(silo.silo_id)} 
                  style={{ padding: '12px 20px', background: '#3B82F6', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>
                  + Внести
                </button>
                <button onClick={() => handleSubtractCement(silo.silo_id)} 
                  style={{ padding: '12px 20px', background: '#EF4444', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>
                  − Списать
                </button>
                <button onClick={() => resetSilo(silo.silo_id)}
                  style={{ padding: '12px 20px', background: '#475569', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>
                  Обнулить
                </button>
              </div>
            </div>
          );
        })}
      </div>
                                {/* ==================== 9. ЁМКОСТИ ДОБАВОК ==================== */}
      <h2 style={{ fontSize: '24px', margin: '48px 0 24px', color: '#CBD5E1' }}>Ёмкости добавок</h2>

      {/* Добавка 1 — ПФМ-НЛК */}
      <div style={{ marginBottom: '48px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '22px', margin: 0, color: '#E2E8F0' }}>ПФМ-НЛК</h3>
          <div style={{ fontSize: '18px', color: '#94A3B8' }}>
            {(additives[0]?.current || 0).toFixed(0)} / {(additives[0]?.max || 9000)} литров
          </div>
          {((additives[0]?.current || 0) / (additives[0]?.max || 9000) * 100) < 30 && (
            <div style={{ color: '#F59E0B', fontWeight: '600' }}>⚠️ Низкий уровень</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {Array.from({ length: Math.max(9, Math.ceil((additives[0]?.max || 9000) / 1000)) }).map((_, idx) => {
            const current = additives[0]?.current || 0;
            const capacity = 1000;
            const fullCubes = Math.floor(current / capacity);
            const remainder = current % capacity;
            
            let fillPercent = 0;
            if (idx < fullCubes) fillPercent = 100;
            else if (idx === fullCubes && remainder > 0) fillPercent = (remainder / capacity) * 100;

            return (
              <div key={`pfm-${idx}`} style={{
                width: '130px',
                height: '130px',
                background: '#1E2937',
                border: '5px solid #64748B',
                borderRadius: '18px',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
                fontWeight: '700',
                color: fillPercent > 25 ? 'white' : '#94A3B8',
                boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
              }}>
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  width: '100%',
                  height: `${fillPercent}%`,
                  background: 'linear-gradient(180deg, #8B5CF6, #6D28D9)',
                  transition: 'height 0.5s ease'
                }} />
                <div style={{ position: 'relative', zIndex: 2 }}>{idx + 1}</div>
              </div>
            );
          })}
        </div>

        {/* Кнопки для ПФМ */}
        <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => handleAddAdditive(0)} style={{ padding: '12px 24px', background: '#3B82F6', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>+ Внести</button>
          <button onClick={() => handleSubtractAdditive(0)} style={{ padding: '12px 24px', background: '#EF4444', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>− Списать</button>
          <button onClick={() => resetAdditive(0)} style={{ padding: '12px 24px', background: '#475569', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>Обнулить</button>
          <button onClick={() => addNewCube(0)} style={{ padding: '12px 24px', background: '#10B981', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>+ Кубик</button>
          <button onClick={() => removeLastCube(0)} style={{ padding: '12px 24px', background: '#F59E0B', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>− Кубик</button>
        </div>
      </div>

      {/* Добавка 2 — Линомикс ТипР */}
      <div style={{ marginBottom: '48px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '20px' }}>
          <h3 style={{ fontSize: '22px', margin: 0, color: '#E2E8F0' }}>Линомикс ТипР</h3>
          <div style={{ fontSize: '18px', color: '#94A3B8' }}>
            {(additives[1]?.current || 0).toFixed(0)} / {(additives[1]?.max || 1000)} литров
          </div>
          {((additives[1]?.current || 0) / (additives[1]?.max || 1000) * 100) < 30 && (
            <div style={{ color: '#F59E0B', fontWeight: '600' }}>⚠️ Низкий уровень</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', justifyContent: 'center' }}>
          {Array.from({ length: Math.max(1, Math.ceil((additives[1]?.max || 1000) / 1000)) }).map((_, idx) => {
            const current = additives[1]?.current || 0;
            const capacity = 1000;
            const fullCubes = Math.floor(current / capacity);
            const remainder = current % capacity;
            
            let fillPercent = 0;
            if (idx < fullCubes) fillPercent = 100;
            else if (idx === fullCubes && remainder > 0) fillPercent = (remainder / capacity) * 100;

            return (
              <div key={`lin-${idx}`} style={{
                width: '130px',
                height: '130px',
                background: '#1E2937',
                border: '5px solid #64748B',
                borderRadius: '18px',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '28px',
                fontWeight: '700',
                color: fillPercent > 25 ? 'white' : '#94A3B8',
                boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
              }}>
                <div style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  width: '100%',
                  height: `${fillPercent}%`,
                  background: 'linear-gradient(180deg, #F59E0B, #D97706)',
                  transition: 'height 0.5s ease'
                }} />
                <div style={{ position: 'relative', zIndex: 2 }}>{idx + 1}</div>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: '24px', display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => handleAddAdditive(1)} style={{ padding: '12px 24px', background: '#3B82F6', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>+ Внести</button>
          <button onClick={() => handleSubtractAdditive(1)} style={{ padding: '12px 24px', background: '#EF4444', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>− Списать</button>
          <button onClick={() => resetAdditive(1)} style={{ padding: '12px 24px', background: '#475569', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>Обнулить</button>
        </div>
      </div>

                                                               {/* ==================== 10. ИСТОРИЯ ИЗМЕНЕНИЙ (закомментировано) ==================== */}
      {/* 
      <div style={{ marginTop: '60px' }}>
        <h2 style={{ fontSize: '24px', marginBottom: '20px', color: '#CBD5E1' }}>
          📋 История изменений склада
        </h2>

        <div style={{ 
          background: '#1E2937', 
          borderRadius: '20px', 
          padding: '20px',
          maxHeight: '420px',
          overflowY: 'auto'
        }}>
          {operationHistory.length === 0 ? (
            <div style={{ textAlign: 'center', color: '#64748B', padding: '40px 20px' }}>
              Пока нет операций
            </div>
          ) : (
            operationHistory.map((op, index) => {
              // Надёжное определение действия
              let displayAction = op.action;
              if (!displayAction) {
                if (op.operation_type === 'add') displayAction = '+ Внесено';
                else if (op.operation_type === 'subtract') displayAction = '− Списано';
                else displayAction = 'Операция';
              }

              const unit = op.unit || 'л';

              return (
                <div 
                  key={op.id || `history-${index}`} 
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '14px 20px',
                    borderBottom: '1px solid #334155',
                    background: (op.operation_type === 'add') ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                    borderRadius: '12px',
                    marginBottom: '8px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <div style={{ fontSize: '22px', width: '32px' }}>
                      {op.operation_type === 'add' ? '🟢' : '🔴'}
                    </div>
                    <div>
                      <div style={{ fontWeight: '600', color: '#E2E8F0' }}>
                        {displayAction} {op.item_type || 'Неизвестно'}
                      </div>
                      <div style={{ fontSize: '13px', color: '#94A3B8' }}>
                        {op.time || op.created_at ? new Date(op.time || op.created_at).toLocaleTimeString('ru-RU', { 
                          hour: '2-digit', 
                          minute: '2-digit' 
                        }) : '—'}
                      </div>
                    </div>
                  </div>

                  <div style={{ textAlign: 'right' }}>
                    <div style={{ 
                      fontSize: '18px', 
                      fontWeight: '700',
                      color: op.operation_type === 'add' ? '#4ADE80' : '#F87171'
                    }}>
                      {op.operation_type === 'add' ? '+' : '-'}
                      {Number(op.amount || 0).toFixed(0)} {unit}
                    </div>
                    <div style={{ fontSize: '13px', color: '#64748B' }}>
                      → {op.new_value !== undefined && op.new_value !== null 
                          ? Number(op.new_value).toFixed(0) 
                          : '—'} {unit}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      */}

      {/* Пустое место вместо истории */}
      <div style={{ marginTop: '60px' }}></div>

    </div>
  );
}