'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';

import { supabase } from '@/lib/supabaseClient';
import { findRecipeByGrade, calculateAdditiveUsage, calculateCementUsageKg } from '@/lib/recipeAdditives';

interface WarehousePageProps {
  recipes?: any[];
}

export default function WarehousePage({ recipes = [] }: WarehousePageProps) {

    // ==================== 1. СОСТОЯНИЕ ====================
  const [silos, setSilos] = useState<any[]>([]);
  const [additives, setAdditives] = useState<any[]>([]);
  const [fbsBlocks, setFbsBlocks] = useState<any[]>([]);        // текущие остатки на складе
  const [availableFBS, setAvailableFBS] = useState<any[]>([]); // все доступные типы ФБС из рецептов
  const [selectedFBSId, setSelectedFBSId] = useState<number | null>(null);
  const [todayConsumption, setTodayConsumption] = useState({ 
    cement: 0, 
    pfm: 0, 
    linomix: 0 
  });
  const [operationHistory, setOperationHistory] = useState<any[]>([]);

  const isProcessingRef = useRef(false);

   // ==================== ЗАГРУЗКА ФБС ====================
  const loadFBS = async () => {
    try {
      console.log('🔍 Запрос к таблице fbs_blocks...');

      const { data: dbBlocks, error } = await supabase
        .from('fbs_blocks')
        .select('*')
        .order('name');

      if (error) {
        console.error('❌ Supabase ошибка:', error);
        return;
      }

      console.log('📊 Данные из БД fbs_blocks:', dbBlocks);

      if (!dbBlocks || dbBlocks.length === 0) {
        console.warn('⚠️ Таблица fbs_blocks пустая или нет прав на чтение');
      }

      const merged = availableFBS.map((recipe: any) => {
        const existing = dbBlocks?.find((b: any) => 
          b.name === recipe.name || 
          String(b.name).trim() === String(recipe.name || recipe.code).trim()
        );

        const currentValue = existing ? Number(existing.current || 0) : 0;

        return {
          ...recipe,
          id: existing?.id || recipe.id,
          name: recipe.name || recipe.code,
          current: currentValue
        };
      });

      console.log(`📦 ФИНАЛЬНЫЙ МЕРДЖ:`, 
        merged.map(m => `${m.name} → ${m.current} шт`));

      setFbsBlocks(merged);
    } catch (err) {
      console.error('💥 Критическая ошибка loadFBS:', err);
    }
  };

   // ==================== 2. ЗАГРУЗКА ДАННЫХ ====================
const loadWarehouse = async () => {
  try {
    const warehouseRes = await fetch('/api/adminCifra/warehouse', { 
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (warehouseRes.ok) {
      const data = await warehouseRes.json();
      
      setSilos(data.silos || []);

      const loadedAdditives = (data.additives || data.warehouse_additives || []).map((a: any) => ({
        ...a,
        id: a.id || a.additive_id,
        current: Number(a.current || 0),
        max: Number(a.max || 9000),
        name: a.name
      }));

      setAdditives(loadedAdditives);
      // console.log('📊 Загружены добавки из БД:', loadedAdditives); // убрали
    }

    // Рецепты ФБС
    const recipesRes = await fetch('/api/adminCifra/recipes', { 
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache' }
    });

    if (recipesRes.ok) {
      const allData = await recipesRes.json();
      const onlyFBS = allData.filter((r: any) => 
        r.item_type === 'fbs' || (r.code && r.code.startsWith('24-'))
      );
      
      setAvailableFBS(onlyFBS);
      // console.log(`📦 Загружено ФБС рецептов: ${onlyFBS.length} шт`); // убрали
    }
  } catch (err) {
    console.error('Ошибка загрузки склада:', err);
  }
};

    // ==================== 2.1 ЗАГРУЗКА РАСХОДА ЗА СЕГОДНЯ (ПО РЕАЛЬНЫМ РЕЦЕПТАМ) ====================
  // Раньше цемент считался как volume × 350 кг/м³, а добавка — как
  // volume × 1.16/1.18 по угадыванию "раствор или бетон" по подстроке в
  // марке (grade.includes('ТР'/'РАСТВОР'/...)). Это давало грубую оценку,
  // не совпадающую с реальной дозировкой конкретного рецепта (у нас марки
  // от 130 до 570 кг цемента на м³, добавка — от 0 до 9+ кг/м³). Теперь для
  // каждого рейса ищем реальный рецепт по марке (та же логика, что и в
  // /adminCifra/zayavki для планового расхода) и считаем по его составу.
const loadTodayConsumption = async () => {
  try {
    const res = await fetch('/api/adminCifra/production-log?today=true', {
      cache: 'no-store',
      headers: { 'Cache-Control': 'no-cache, no-store, must-revalidate' },
      // Добавили timeout, чтобы не висело вечно
      signal: AbortSignal.timeout(3000)
    });

    if (!res.ok) {
      // API пока не существует или возвращает ошибку — тихо ставим нули
      setTodayConsumption({ cement: 0, pfm: 0, linomix: 0 });
      return;
    }

    const data = await res.json();
    const logs = data.logs || data || [];

    let totalCementKg = 0;
    let totalPfmKg = 0;
    let totalLinomixKg = 0;

    logs.forEach((log: any) => {
      const volume = parseFloat(log.volume || log.qty || 0);
      if (isNaN(volume) || volume <= 0) return;

      const recipe = findRecipeByGrade(recipes, log.concrete_grade);
      if (!recipe) return; // рецепт не нашли — расход по нему не учитываем (лучше 0, чем случайная оценка)

      totalCementKg += calculateCementUsageKg(recipe, volume);

      const usage = calculateAdditiveUsage(recipe, volume);
      if (usage?.additiveId === 1) totalPfmKg += usage.kg;
      else if (usage?.additiveId === 2) totalLinomixKg += usage.kg;
    });

    const newConsumption = {
      cement: Math.round(totalCementKg / 1000),
      pfm: Math.round(totalPfmKg),
      linomix: Math.round(totalLinomixKg)
    };

    setTodayConsumption(newConsumption);

    // Оставили только один важный лог (можно закомментировать позже)
    // console.log(`✅ Расчёт: ${logs.length} записей | Цемент: ${newConsumption.cement}т | ПФМ: ${newConsumption.pfm}кг | Линомикс: ${newConsumption.linomix}кг`);

  } catch (err: any) {
    // Тихая обработка — не спамим ошибкой при каждом обновлении
    if (err.name !== 'AbortError' && err.name !== 'TypeError') {
      console.error('Ошибка загрузки расхода сегодня:', err);
    }
    setTodayConsumption({ cement: 0, pfm: 0, linomix: 0 });
  }
};

  // ==================== 2.2 ЗАГРУЗКА ИСТОРИИ ====================
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

  // ==================== 2.3 ЗАГРУЗКА ДАННЫХ И ИНИЦИАЛИЗАЦИЯ ====================
  useEffect(() => {
    loadWarehouse();
    loadTodayConsumption();
    loadOperationHistory();

    console.log('✅ WarehousePage загружен');
  }, []);

  // Рецепты в родителе (adminCifra/operator) грузятся отдельным запросом и
  // могут прилететь позже первого монтирования этой вкладки — пересчитываем
  // КПИ расхода, как только список рецептов действительно наполнился.
  useEffect(() => {
    if (recipes.length > 0) loadTodayConsumption();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes]);

  // Раньше здесь был setInterval(loadTodayConsumption, 8000) — опрос тяжёлого
  // JOIN-запроса каждые 8с на КАЖДОЙ открытой странице склада, постоянная
  // фоновая нагрузка на Vercel/Supabase. Теперь пересчитываем расход только
  // когда реально появляется новая запись отгрузки (INSERT в production_logs).
  useRealtimeBroadcast({
    topic: 'production_logs:all',
    onInsert: () => loadTodayConsumption(),
  });

  // ==================== REALTIME-СИНХРОНИЗАЦИЯ ОСТАТКОВ ДОБАВОК ====================
  // Реальное списание добавки при разгрузке рейса (см. lib/orderMixers.ts)
  // теперь может произойти в любой момент — в том числе с ЧУЖОГО устройства
  // (диспетчер/водитель), пока эта вкладка открыта. saveToDatabase() ниже
  // отправляет ПОЛНЫЙ текущий снимок additives при любом ручном действии на
  // складе (внесение цемента, кубик и т.п.) — если снимок в памяти устареет
  // (кто-то списал добавку за рейс, а мы этого не увидели), такое ручное
  // действие может затереть уже списанный остаток обратно. Подписка держит
  // additives/silos свежими почти в реальном времени и убирает этот риск.
  useRealtimeBroadcast({
    topic: 'order_mixers:all',
    onUpdate: (record: any) => {
      if (record?.status === 'Разгружен') loadWarehouse();
    },
  });

    // ==================== АВТОМАТИЧЕСКАЯ ЗАГРУЗКА ФБС ====================
  useEffect(() => {
    if (availableFBS.length > 0) {
      loadFBS();
    }
  }, [availableFBS]);   // ← срабатывает каждый раз, когда availableFBS меняется

  // ==================== 3. СОХРАНЕНИЕ В БАЗУ ====================
const saveToDatabase = async (silosToSave?: any[], additivesToSave?: any[], fbsToSave?: any[]) => {
  try {
    const currentSilos = silosToSave || silos;
    const currentAdditives = additivesToSave || additives;
    const currentFBS = fbsToSave || fbsBlocks;

    const payload = {
      silos: currentSilos.map((s: any) => ({
        silo_id: Number(s.silo_id),
        current: Number(s.current || 0)
      })),
      additives: currentAdditives.map((add: any) => ({
        additive_id: Number(add.additive_id || add.id || 1),
        name: add.name,
        current: Number(add.current || 0),
        max: Number(add.max || 9000)        // ← ДОБАВИЛИ max!
      })),
      fbs: currentFBS.map((block: any) => ({
        id: Number(block.id),
        name: block.name || block.code || '',
        current: Number(block.current || 0)
      }))
    };

    // console.log('📤 Отправляем в warehouse (additives с max):', payload.additives);

    const response = await fetch('/api/adminCifra/warehouse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    console.log('📥 Ответ от API:', result);

    if (response.ok) {
      // console.log('✅ Данные успешно сохранены (включая ФБС)');
      await loadFBS();
    }
  } catch (err) {
    console.error('💥 Ошибка сохранения:', err);
  }
};


  // ==================== 4. ВНЕСТИ ЦЕМЕНТ ====================
  const handleAddCement = (id: number) => {
    const input = prompt(`Введите количество цемента (в килограммах) для силоса №${id}:`);
    if (input === null) return;

    const kg = parseFloat(input);
    if (isNaN(kg)) {
      alert('❌ Введите корректное число');
      return;
    }

    // ✅ Разрешаем отрицательные значения для ВСЕХ силосов
    const tons = kg / 1000;

    setSilos(prev => {
      const updatedSilos = prev.map(s => {
        if (s.silo_id === id) {
          const oldCurrent = Number(s.current || 0);
          const newCurrent = Math.max(-50, oldCurrent + tons); // минимальный порог -50 тонн
          
          const action = kg >= 0 ? '+ Внесено' : '− Списано';
          addToHistory(action, s.name || `Силос №${id}`, kg, oldCurrent * 1000, newCurrent * 1000, 'кг');
          
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
    if (isNaN(kg)) {
      alert('❌ Введите корректное число');
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

 // ==================== 6.2 РАБОТА С БЛОКАМИ ФБС ====================
  const handleAddFBS = () => {
  if (!selectedFBSId) return alert('Выберите тип блока ФБС');

  const qty = parseInt(prompt('Сколько блоков внести?') || '0');
  if (!qty || qty <= 0) return;

  setFbsBlocks(prev => {
    let updated = [...prev];

    const existingIndex = updated.findIndex(b => b.id === selectedFBSId);

    if (existingIndex !== -1) {
      const oldCurrent = Number(updated[existingIndex].current || 0);
      updated[existingIndex].current = oldCurrent + qty;
      console.log(`✅ Добавлено ${qty} шт к существующему блоку`);
    } else {
      // Если блока ещё нет в fbsBlocks — добавляем
      const recipe = availableFBS.find(r => r.id === selectedFBSId);
      if (recipe) {
        updated.push({
          ...recipe,
          id: recipe.id,
          name: recipe.name,
          current: qty
        });
        console.log(`✅ Добавлен новый тип блока: ${recipe.name}`);
      }
    }

    saveToDatabase(undefined, undefined, updated);
    return updated;
  });
};

  const handleSubtractFBS = (id: number) => {
    const qty = parseInt(prompt('Сколько блоков списать?') || '0');
    if (!qty || qty <= 0) return;

    setFbsBlocks(prev => {
      const updated = prev.map(block => {
        if (block.id === id) {
          const oldCurrent = Number(block.current || 0);
          const newCurrent = Math.max(0, oldCurrent - qty);
          return { ...block, current: newCurrent };
        }
        return block;
      });

      saveToDatabase(undefined, undefined, updated);
      return updated;
    });
  };

// ==================== 6.3 ДОБАВЛЕНИЕ ОДНОГО ТИПА ФБС ====================
const handleAddFBSBlock = (id: number) => {
  const qty = parseInt(prompt('Сколько блоков добавить?') || '0');
  if (!qty || qty <= 0) return;

  setFbsBlocks(prev => {
    const updated = prev.map(block => {
      if (block.id === id) {
        const old = Number(block.current || 0);
        return { ...block, current: old + qty };
      }
      return block;
    });

    saveToDatabase(undefined, undefined, updated);
    return updated;
  });
};


 // ==================== 6.4 ДОБАВИТЬ НОВЫЙ ПУСТОЙ КУБИК ====================
const addNewCube = (index: number) => {
  if (index !== 0) {
    alert('Пока добавление кубиков работает только для ПФМ-НЛК');
    return;
  }

  const additive = additives[index];
  if (!additive) return;

  const oldMax = Number(additive.max || 9000);
  const newMax = oldMax + 1000;
  const current = Number(additive.current || 0);

  // Защита от двойного клика
  const now = Date.now();
  if ((window as any).lastCubeActionTime && now - (window as any).lastCubeActionTime < 500) {
    console.log('⛔ Слишком быстрое нажатие — игнорируем');
    return;
  }
  (window as any).lastCubeActionTime = now;

  setAdditives(prev => {
    const updated = prev.map((add, i) =>
      i === index 
        ? { ...add, max: newMax, current: current } 
        : add
    );

    console.log(`✅ +1 пустой кубик → max = ${newMax} л (current = ${current} л)`);

    saveToDatabase(undefined, updated);
    addToHistory('+ Кубик', 'ПФМ-НЛК', 1000, oldMax, newMax, 'л (ёмкость)');

    return updated;
  });
};

// ==================== 6.5 УДАЛИТЬ ПОСЛЕДНИЙ КУБИК ====================
const removeLastCube = (index: number) => {
  if (index !== 0) return;

  const additive = additives[index];
  if (!additive) return;

  const oldMax = Number(additive.max || 9000);
  const current = Number(additive.current || 0);

  if (oldMax <= 9000) {
    alert('Нельзя удалить кубик — уже минимальное количество (9 кубиков)');
    return;
  }

  const newMax = oldMax - 1000;

  // Защита от двойного клика
  const now = Date.now();
  if ((window as any).lastCubeActionTime && now - (window as any).lastCubeActionTime < 500) {
    console.log('⛔ Слишком быстрое нажатие — игнорируем');
    return;
  }
  (window as any).lastCubeActionTime = now;

  setAdditives(prev => {
    const updated = prev.map((add, i) =>
      i === index 
        ? { ...add, max: newMax } 
        : add
    );

    console.log(`🗑 -1 кубик → max = ${newMax} л`);

    saveToDatabase(undefined, updated);
    addToHistory('− Кубик', 'ПФМ-НЛК', 1000, oldMax, newMax, 'л (ёмкость)');

    return updated;
  });
};


  // ==================== 6.6 ЛОГИРОВАНИЕ ОПЕРАЦИЙ ====================
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
      color: '#E2E8F0', 
      padding: '0 0 24px 0',
      fontFamily: 'system-ui, sans-serif'
    }}>

                 {/* ==================== МЕТРИКИ РАСХОДА СЕГОДНЯ ==================== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        
        {/* Цемент */}
        <div style={{ 
          background: '#1E2937', 
          padding: '18px 22px', 
          borderRadius: '18px',
          border: '1px solid #334155'
        }}>
          <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px' }}>
            Расход цемента сегодня
          </div>
          <div style={{ fontSize: '38px', fontWeight: '700', color: '#10B981', lineHeight: '1' }}>
            {todayConsumption.cement} <span style={{ fontSize: '20px', color: '#64748B' }}>т</span>
          </div>
        </div>

        {/* ПФМ-НЛК */}
        <div style={{ 
          background: '#1E2937', 
          padding: '18px 22px', 
          borderRadius: '18px',
          border: '1px solid #334155'
        }}>
          <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px' }}>
            Расход ПФМ-НЛК сегодня
          </div>
          <div style={{ fontSize: '38px', fontWeight: '700', color: '#C084FC', lineHeight: '1' }}>
            {todayConsumption.pfm} <span style={{ fontSize: '20px', color: '#64748B' }}>кг</span>
          </div>
        </div>

        {/* Линомикс ТипР */}
        <div style={{ 
          background: '#1E2937', 
          padding: '18px 22px', 
          borderRadius: '18px',
          border: '1px solid #334155'
        }}>
          <div style={{ color: '#94A3B8', fontSize: '14px', marginBottom: '6px' }}>
            Расход Линомикс ТипР сегодня
          </div>
          <div style={{ fontSize: '38px', fontWeight: '700', color: '#60A5FA', lineHeight: '1' }}>
            {todayConsumption.linomix} <span style={{ fontSize: '20px', color: '#64748B' }}>кг</span>
          </div>
        </div>

      </div>

            {/* ==================== 8. ВЕРТИКАЛЬНЫЕ СИЛОСЫ ==================== */}
      <h2 style={{ fontSize: '20px', marginBottom: '16px', color: '#CBD5E1' }}>Силосы цемента</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px' }}>
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

              <h3 style={{ fontSize: '19px', marginBottom: '4px' }}>{silo.name}</h3>
              <div style={{ 
                fontSize: '23px', 
                fontWeight: '700', 
                color: textColor 
              }}>
                {formatCement(current)} / {silo.max} т
              </div>
              <div style={{ fontSize: '13px', color: '#64748B', marginTop: '4px' }}>
                {percent.toFixed(0)}% заполнено
              </div>

              <div style={{ marginTop: '14px', display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
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
      <h2 style={{ fontSize: '20px', margin: '28px 0 16px', color: '#CBD5E1' }}>Ёмкости добавок</h2>

      {/* Добавка 1 — ПФМ-НЛК */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px' }}>
          <h3 style={{ fontSize: '19px', margin: 0, color: '#E2E8F0' }}>ПФМ-НЛК</h3>
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
                width: '104px',
                height: '104px',
                background: '#1E2937',
                border: '4px solid #64748B',
                borderRadius: '16px',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
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
        <div style={{ marginTop: '16px', display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => handleAddAdditive(0)} style={{ padding: '12px 24px', background: '#3B82F6', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>+ Внести</button>
          <button onClick={() => handleSubtractAdditive(0)} style={{ padding: '12px 24px', background: '#EF4444', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>− Списать</button>
          <button onClick={() => resetAdditive(0)} style={{ padding: '12px 24px', background: '#475569', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>Обнулить</button>
          <button onClick={() => addNewCube(0)} style={{ padding: '12px 24px', background: '#10B981', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>+ Кубик</button>
          <button onClick={() => removeLastCube(0)} style={{ padding: '12px 24px', background: '#F59E0B', border: 'none', borderRadius: '12px', color: 'white', fontWeight: '600', cursor: 'pointer' }}>− Кубик</button>
        </div>
      </div>

      {/* Добавка 2 — Линомикс ТипР */}
      <div style={{ marginBottom: '28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '14px' }}>
          <h3 style={{ fontSize: '19px', margin: 0, color: '#E2E8F0' }}>Линомикс ТипР</h3>
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
                width: '104px',
                height: '104px',
                background: '#1E2937',
                border: '4px solid #64748B',
                borderRadius: '16px',
                position: 'relative',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '22px',
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

        <div style={{ marginTop: '16px', display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
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

   {/* ==================== БЛОКИ ФБС НА СКЛАДЕ ==================== */}
<div className="mt-4">
  <h2 className="text-xl font-semibold text-white mb-4">Блоки ФБС на складе</h2>

  {/* Кнопка Добавить выше с нормальным отступом */}
  <div style={{ marginBottom: '20px' }}>
    <select 
      value={selectedFBSId || ''} 
      onChange={(e) => setSelectedFBSId(Number(e.target.value))}
      style={{
        backgroundColor: '#1F2937',
        color: 'white',
        border: '1px solid #374151',
        borderRadius: '8px',
        padding: '12px 16px',
        marginRight: '12px',
        minWidth: '280px'
      }}
    >
      <option value="">Выберите тип ФБС...</option>
      {availableFBS.map((r: any) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </select>

    <button
      onClick={handleAddFBS}
      style={{
        backgroundColor: '#10B981',
        color: 'white',
        padding: '12px 24px',
        borderRadius: '8px',
        fontWeight: '600',
        border: 'none',
        cursor: 'pointer'
      }}
    >
      + Добавить на склад
    </button>
  </div>

  {/* Карточки в одну линию */}
<div className="scroll-hidden" style={{ 
  display: 'flex', 
  gap: '20px', 
  overflowX: 'auto', 
  paddingBottom: '8px' 
}}>
  {fbsBlocks.map((block: any) => {
    const qty = Number(block.current || 0);

    return (
      <div 
        key={block.id} 
        style={{
          backgroundColor: '#1F2937',
          border: '1px solid #374151',
          borderRadius: '12px',
          padding: '20px',
          width: '260px',
          minWidth: '260px',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
          transition: 'all 0.2s ease',
        }}
        onMouseOver={(e) => {
          e.currentTarget.style.borderColor = '#60A5FA';
          e.currentTarget.style.transform = 'translateY(-4px)';
        }}
        onMouseOut={(e) => {
          e.currentTarget.style.borderColor = '#374151';
          e.currentTarget.style.transform = 'translateY(0)';
        }}
      >
        <div style={{ fontSize: '17px', fontWeight: '600', color: 'white', marginBottom: '6px' }}>
          {block.name}
        </div>
        
        <div style={{ fontSize: '13px', color: '#9CA3AF', marginBottom: '16px' }}>
          {(block.length_cm && block.width_cm && block.height_cm)
            ? `${block.length_cm} × ${block.width_cm} × ${block.height_cm} см`
            : (block.dimensions || '—')}
        </div>

        {/* Количество */}
        <div style={{ 
          fontSize: '42px', 
          fontWeight: '700', 
          color: qty > 0 ? '#3B82F6' : '#6B7280',
          lineHeight: '1',
          marginBottom: '20px'
        }}>
          {qty} <span style={{ fontSize: '18px', fontWeight: '500' }}>шт</span>
        </div>

        {/* Кнопки действий */}
        <div style={{ display: 'flex', gap: '10px' }}>
          {/* Кнопка + Добавить */}
          <button
            onClick={() => handleAddFBSBlock(block.id)}
            style={{
              flex: 1,
              backgroundColor: '#10B981',
              color: 'white',
              padding: '12px',
              borderRadius: '8px',
              fontWeight: '600',
              border: 'none',
              cursor: 'pointer',
              transition: 'all 0.2s ease'
            }}
            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#34D399'}
            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#10B981'}
          >
            + Добавить
          </button>

          {/* Кнопка − Списать */}
          <button
            onClick={() => handleSubtractFBS(block.id)}
            disabled={qty <= 0}
            style={{
              flex: 1,
              backgroundColor: qty > 0 ? '#EF4444' : '#4B5563',
              color: 'white',
              padding: '12px',
              borderRadius: '8px',
              fontWeight: '600',
              border: 'none',
              cursor: qty > 0 ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s ease'
            }}
          >
            − Списать
          </button>
        </div>
      </div>
    );
  })}
</div>
</div>
      

    </div>
  );
}