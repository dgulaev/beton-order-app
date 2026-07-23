'use client';

import { useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';
import { useUserRole } from '@/app/providers/UserRoleProvider';

import { supabase } from '@/lib/supabaseClient';
import {
  findRecipeByGrade,
  calculateAdditiveUsage,
  calculateCementUsageKg,
  tonsToAdditiveLiters,
  getAdditiveDensity,
  densitiesFromLabSettings,
  ADDITIVE_NAMES,
  type AdditiveDensities,
} from '@/lib/recipeAdditives';
import {
  CARD_BORDER,
  CARD_VOLUME,
  CARD_VOLUME_SOFT,
} from '../cardStyles';
import ModalSelect from '../components/ModalSelect';
import { appConfirm } from '../components/appDialog';

interface WarehousePageProps {
  recipes?: any[];
  /** Имя со смены оператора (Семён/Максим) или иное явное имя автора. */
  actorName?: string | null;
}

export default function WarehousePage({ recipes = [], actorName = null }: WarehousePageProps) {
  const { user } = useUserRole();
  // Приоритет: имя со смены (проп) → ФИО из роли → username → заглушка.
  const currentActorName =
    (actorName && String(actorName).trim()) ||
    user?.full_name ||
    user?.username ||
    'Сотрудник';

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
  /** Средний расход добавок за 7 дней (л/день) — для «хватит на ~N дней». */
  const [avgDailyLiters, setAvgDailyLiters] = useState({ pfm: 0, linomix: 0 });
  const [operationHistory, setOperationHistory] = useState<any[]>([]);
  /** Плотности из настроек лаборатории (т→л / кг→л). */
  const [additiveDensities, setAdditiveDensities] = useState<AdditiveDensities>({});

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
    const [warehouseRes, recipesRes, labRes] = await Promise.all([
      fetch('/api/adminCifra/warehouse', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      }),
      fetch('/api/adminCifra/recipes', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache' },
      }),
      fetch('/api/adminCifra/lab-settings', { cache: 'no-store' }),
    ]);

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
    }

    if (recipesRes.ok) {
      const allData = await recipesRes.json();
      const onlyFBS = allData.filter((r: any) => 
        r.item_type === 'fbs' || (r.code && r.code.startsWith('24-'))
      );
      
      setAvailableFBS(onlyFBS);
    }

    if (labRes.ok) {
      const lab = await labRes.json();
      setAdditiveDensities(densitiesFromLabSettings(lab));
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

  /** YYYY-MM-DD по Москве, со сдвигом дней назад. */
  const moscowDateOffset = (daysAgo: number): string => {
    const d = new Date(Date.now() - daysAgo * 86_400_000);
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Moscow',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  };

  // Средний расход добавок за 7 календарных дней (л/день) по production-log.
  const loadAvgDailyConsumption = async () => {
    if (!recipes.length) return;
    try {
      const dates = Array.from({ length: 7 }, (_, i) => moscowDateOffset(i));
      const results = await Promise.all(
        dates.map(async (date) => {
          try {
            const res = await fetch(`/api/adminCifra/production-log?date=${date}`, {
              cache: 'no-store',
              signal: AbortSignal.timeout(4000),
            });
            if (!res.ok) return { pfmKg: 0, linKg: 0 };
            const data = await res.json();
            const logs = data.logs || data || [];
            let pfmKg = 0;
            let linKg = 0;
            for (const log of logs) {
              const volume = parseFloat(log.volume || log.qty || 0);
              if (!volume || volume <= 0) continue;
              const recipe = findRecipeByGrade(recipes, log.concrete_grade);
              if (!recipe) continue;
              const usage = calculateAdditiveUsage(recipe, volume, additiveDensities);
              if (usage?.additiveId === 1) pfmKg += usage.kg;
              else if (usage?.additiveId === 2) linKg += usage.kg;
            }
            return { pfmKg, linKg };
          } catch {
            return { pfmKg: 0, linKg: 0 };
          }
        })
      );

      const sumPfm = results.reduce((s, r) => s + r.pfmKg, 0);
      const sumLin = results.reduce((s, r) => s + r.linKg, 0);
      const densPfm = getAdditiveDensity(1, additiveDensities);
      const densLin = getAdditiveDensity(2, additiveDensities);
      setAvgDailyLiters({
        pfm: densPfm > 0 ? sumPfm / densPfm / 7 : 0,
        linomix: densLin > 0 ? sumLin / densLin / 7 : 0,
      });
    } catch (err) {
      console.error('Ошибка среднего расхода добавок:', err);
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
    if (recipes.length > 0) {
      loadTodayConsumption();
      loadAvgDailyConsumption();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipes, additiveDensities]);

  // Раньше здесь был setInterval(loadTodayConsumption, 8000) — опрос тяжёлого
  // JOIN-запроса каждые 8с на КАЖДОЙ открытой странице склада, постоянная
  // фоновая нагрузка на Vercel/Supabase. Теперь пересчитываем расход только
  // когда реально появляется новая запись отгрузки (INSERT в production_logs).
  useRealtimeBroadcast({
    topic: 'production_logs:all',
    onInsert: () => {
      loadTodayConsumption();
      loadAvgDailyConsumption();
    },
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
  const resetSilo = async (id: number) => {
    if (await appConfirm(`Обнулить силос №${id}?`)) {
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

  const formatLiters = (n: number) =>
    Math.round(n).toLocaleString('ru-RU');

  /** Карточка добавки: крупные цифры, прогресс, плотность, запас дней, мини-кубы. */
  const renderAdditiveCard = (
    index: number,
    opts: {
      title: string;
      accent: string;
      accentSoft: string;
      gradient: string;
      todayKg: number;
      avgLitersPerDay: number;
      defaultMax: number;
      showCubeButtons?: boolean;
      minCubes?: number;
    }
  ) => {
    const additive = additives[index];
    const current = Number(additive?.current || 0);
    const max = Number(additive?.max || opts.defaultMax);
    const percent = max > 0 ? Math.min(Math.max((current / max) * 100, 0), 100) : 0;
    const low = percent < 30;
    const additiveId = (index === 0 ? 1 : 2) as 1 | 2;
    const density = getAdditiveDensity(additiveId, additiveDensities);
    const todayLiters = density > 0 ? opts.todayKg / density : 0;
    const daysLeft =
      opts.avgLitersPerDay > 0.5 ? Math.max(0, Math.floor(current / opts.avgLitersPerDay)) : null;
    const cubeCount = Math.max(opts.minCubes ?? 1, Math.ceil(max / 1000));

    const btnBase = {
      padding: '9px 12px',
      border: 'none',
      borderRadius: '10px',
      color: 'white',
      fontWeight: 600 as const,
      cursor: 'pointer' as const,
      fontSize: '12px',
      flex: '1 1 auto',
      minWidth: '88px',
    };

    return (
      <div
        key={opts.title}
        style={{
          background: 'linear-gradient(165deg, #1E2937 0%, #0F172A 100%)',
          border: `1px solid ${low ? '#F59E0B55' : 'rgba(148, 163, 184, 0.28)'}`,
          borderRadius: '18px',
          padding: '16px 16px 14px',
          boxShadow: CARD_VOLUME_SOFT,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          gap: '12px',
          flex: 1,
          minHeight: 0,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: '#F1F5F9' }}>
            {opts.title}
          </h3>
          <div
            style={{
              fontSize: '12px',
              fontWeight: 700,
              color: low ? '#FBBF24' : opts.accent,
              background: low ? '#F59E0B22' : opts.accentSoft,
              padding: '4px 10px',
              borderRadius: '999px',
              whiteSpace: 'nowrap',
            }}
          >
            {low ? '⚠ низкий' : `${percent.toFixed(0)}%`}
          </div>
        </div>

        <div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', lineHeight: 1 }}>
            <span
              style={{
                fontSize: '40px',
                fontWeight: 800,
                letterSpacing: '-0.03em',
                color: opts.accent,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {formatLiters(current)}
            </span>
            <span style={{ fontSize: '15px', color: '#64748B', fontWeight: 600 }}>л</span>
          </div>
          <div style={{ marginTop: '4px', fontSize: '13px', color: '#94A3B8' }}>
            из {formatLiters(max)} · {cubeCount}{' '}
            {cubeCount === 1 ? 'куб' : cubeCount < 5 ? 'куба' : 'кубов'}
          </div>
        </div>

        <div
          style={{
            height: '8px',
            borderRadius: '999px',
            background: '#0F172A',
            border: '1px solid #334155',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${percent}%`,
              background: opts.gradient,
              transition: 'width 0.5s ease',
              borderRadius: '999px',
            }}
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '6px 12px',
            fontSize: '12px',
          }}
        >
          <div>
            <div style={{ color: '#64748B', marginBottom: '2px' }}>Сегодня</div>
            <div style={{ color: '#E2E8F0', fontWeight: 600 }}>
              {opts.todayKg} кг
              <span style={{ color: '#64748B', fontWeight: 500 }}>
                {' '}
                · ≈{formatLiters(todayLiters)} л
              </span>
            </div>
          </div>
          <div>
            <div style={{ color: '#64748B', marginBottom: '2px' }}>Плотность</div>
            <div style={{ color: '#E2E8F0', fontWeight: 600 }}>{density.toFixed(2)} кг/л</div>
          </div>
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ color: daysLeft === null ? '#64748B' : opts.accent, fontWeight: 700, fontSize: '13px' }}>
              {daysLeft === null
                ? 'Запас: нет расхода за 7 дн.'
                : daysLeft === 0
                  ? 'Запас: меньше суток'
                  : `Запас: ~${daysLeft} дн.`}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {Array.from({ length: cubeCount }).map((_, idx) => {
            const capacity = 1000;
            const fullCubes = Math.floor(current / capacity);
            const remainder = current % capacity;
            let fillPercent = 0;
            if (idx < fullCubes) fillPercent = 100;
            else if (idx === fullCubes && remainder > 0) fillPercent = (remainder / capacity) * 100;

            return (
              <div
                key={`${opts.title}-cube-${idx}`}
                title={`Куб ${idx + 1}: ${fillPercent.toFixed(0)}%`}
                style={{
                  width: '34px',
                  height: '34px',
                  background: '#0F172A',
                  border: '2px solid #475569',
                  borderRadius: '8px',
                  position: 'relative',
                  overflow: 'hidden',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '11px',
                  fontWeight: 700,
                  color: fillPercent > 30 ? '#fff' : '#64748B',
                }}
              >
                <div
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    width: '100%',
                    height: `${fillPercent}%`,
                    background: opts.gradient,
                    transition: 'height 0.4s ease',
                  }}
                />
                <span style={{ position: 'relative', zIndex: 1 }}>{idx + 1}</span>
              </div>
            );
          })}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '2px' }}>
          <button onClick={() => handleAddAdditive(index)} style={{ ...btnBase, background: '#3B82F6' }}>
            + Внести (т)
          </button>
          <button onClick={() => handleSubtractAdditive(index)} style={{ ...btnBase, background: '#EF4444' }}>
            − Списать (л)
          </button>
          <button onClick={() => resetAdditive(index)} style={{ ...btnBase, background: '#475569' }}>
            Обнулить (л)
          </button>
          {opts.showCubeButtons && (
            <>
              <button onClick={() => addNewCube(index)} style={{ ...btnBase, background: '#10B981' }}>
                + Кубик
              </button>
              <button onClick={() => removeLastCube(index)} style={{ ...btnBase, background: '#F59E0B' }}>
                − Кубик
              </button>
            </>
          )}
        </div>
      </div>
    );
  };

 // ==================== 6.1 РАБОТА С ДОБАВКАМИ ====================
  // Поступление: тонны → литры (плотность в recipeAdditives).
  // Ручное списание / обнуление: литры. Автосписание с рейса — отдельно (кг→л).
  const handleAddAdditive = (index: number) => {
    const additiveId = (index === 0 ? 1 : 2) as 1 | 2;
    const name = ADDITIVE_NAMES[additiveId];
    const density = getAdditiveDensity(additiveId, additiveDensities);
    const litersPerTon = Math.round(tonsToAdditiveLiters(additiveId, 1, additiveDensities));
    const input = prompt(
      `Сколько тонн добавить в ${name}?\n(1 т ≈ ${litersPerTon} л при плотности ${density} кг/л — из настроек лаборатории)`
    );
    if (input === null) return;
    const tons = parseFloat(input.replace(',', '.'));
    if (isNaN(tons) || tons <= 0) return alert('Введите положительное число (тонны)');

    const liters = Math.round(tonsToAdditiveLiters(additiveId, tons, additiveDensities) * 10) / 10;

    setAdditives(prev => {
      const updated = prev.map((add, i) => {
        if (i === index) {
          const oldCurrent = Number(add?.current || 0);
          const newCurrent = oldCurrent + liters;

          addToHistory(
            `+ Внесено ${tons} т → ${liters} л`,
            name,
            liters,
            oldCurrent,
            newCurrent,
            'л'
          );

          return { ...add, current: newCurrent };
        }
        return add;
      });

      saveToDatabase(undefined, updated);
      return updated;
    });
  };

  const handleSubtractAdditive = (index: number) => {
    const additiveId = (index === 0 ? 1 : 2) as 1 | 2;
    const name = ADDITIVE_NAMES[additiveId];
    const input = prompt(`Сколько литров списать из ${name}?`);
    if (input === null) return;
    const liters = parseFloat(input.replace(',', '.'));
    if (isNaN(liters) || liters <= 0) return alert('Введите положительное число (литры)');

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

  const resetAdditive = async (index: number) => {
    const additiveId = (index === 0 ? 1 : 2) as 1 | 2;
    const name = ADDITIVE_NAMES[additiveId];
    if (await appConfirm(`Обнулить ${name}? (остаток в литрах станет 0)`)) {
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
      const newCurrent = oldCurrent + qty;
      const name = updated[existingIndex].name || 'ФБС';
      updated[existingIndex] = { ...updated[existingIndex], current: newCurrent };
      addToHistory('+ Внесено', name, qty, oldCurrent, newCurrent, 'шт');
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
        addToHistory('+ Внесено', recipe.name, qty, 0, qty, 'шт');
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
          addToHistory('− Списано', block.name || 'ФБС', qty, oldCurrent, newCurrent, 'шт');
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
        const next = old + qty;
        addToHistory('+ Внесено', block.name || 'ФБС', qty, old, next, 'шт');
        return { ...block, current: next };
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
  const resolveOperationType = (action: string): string => {
    if (action.includes('Кубик')) return action.includes('−') || action.includes('-') ? 'subtract' : 'add';
    if (action.includes('Внес') || action.includes('Добав')) return 'add';
    if (action.includes('Спис')) return 'subtract';
    if (action.includes('Обнул')) return 'reset';
    return 'unknown';
  };

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
      operation_type: resolveOperationType(action),
      item_type: item,
      amount: Number(amount),
      old_value: Number(oldValue),
      new_value: Number(newValue),
      unit: unit,
      user_name: currentActorName,
      created_at: new Date().toISOString(),
      time: new Date().toISOString(),
    };

    setOperationHistory(prev => [entry, ...prev].slice(0, 40));

    // Persist в БД (не блокируем UI)
    fetch('/api/adminCifra/warehouse/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation_type: entry.operation_type,
        item_type: entry.item_type,
        amount: entry.amount,
        old_value: entry.old_value,
        new_value: entry.new_value,
        unit: entry.unit,
        user_name: entry.user_name,
      }),
    }).catch((err) => console.error('Ошибка сохранения истории:', err));
  };

  const formatHistoryAmount = (n: number, unit: string) => {
    const abs = Math.abs(Number(n) || 0);
    const formatted =
      unit === 'кг' || unit === 'л'
        ? abs.toLocaleString('ru-RU', { maximumFractionDigits: 1 })
        : abs.toLocaleString('ru-RU', { maximumFractionDigits: 0 });
    return `${formatted} ${unit}`;
  };

  const formatHistoryTime = (raw: string | undefined) => {
    if (!raw) return '—';
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const historyLabel = (op: any) => {
    if (op.action) return op.action;
    if (op.operation_type === 'add') return '+ Внесено';
    if (op.operation_type === 'subtract') return '− Списано';
    if (op.operation_type === 'reset') return 'Обнулено';
    return 'Операция';
  }; 

  // ==================== 7. ОСНОВНОЙ РЕНДЕР ====================
  return (
    <div style={{ 
      color: '#E2E8F0', 
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-start',
      gap: '14px',
      paddingBottom: '16px',
      boxSizing: 'border-box',
      fontFamily: 'system-ui, sans-serif'
    }}>

      {/* ==================== МЕТРИКИ РАСХОДА СЕГОДНЯ ==================== */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '16px', flexShrink: 0 }}>
        
        {/* Цемент */}
        <div style={{ 
          background: 'linear-gradient(165deg, #1E2937 0%, #0F172A 72%, #0B1220 100%)', 
          padding: '14px 18px', 
          borderRadius: '18px',
          border: CARD_BORDER,
          boxShadow: CARD_VOLUME,
        }}>
          <div style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '6px' }}>
            Расход цемента сегодня
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#10B981', lineHeight: 1 }}>
            {todayConsumption.cement} <span style={{ fontSize: '14px', color: '#64748B' }}>т</span>
          </div>
        </div>

        {/* ПФМ-НЛК */}
        <div style={{ 
          background: 'linear-gradient(165deg, #1E2937 0%, #0F172A 72%, #0B1220 100%)', 
          padding: '14px 18px', 
          borderRadius: '18px',
          border: CARD_BORDER,
          boxShadow: CARD_VOLUME,
        }}>
          <div style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '6px' }}>
            Расход ПФМ-НЛК сегодня
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#C084FC', lineHeight: 1 }}>
            {todayConsumption.pfm} <span style={{ fontSize: '14px', color: '#64748B' }}>кг</span>
          </div>
        </div>

        {/* Линомикс ТипР */}
        <div style={{ 
          background: 'linear-gradient(165deg, #1E2937 0%, #0F172A 72%, #0B1220 100%)', 
          padding: '14px 18px', 
          borderRadius: '18px',
          border: CARD_BORDER,
          boxShadow: CARD_VOLUME,
        }}>
          <div style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '6px' }}>
            Расход Линомикс ТипР сегодня
          </div>
          <div style={{ fontSize: '28px', fontWeight: 700, color: '#60A5FA', lineHeight: 1 }}>
            {todayConsumption.linomix} <span style={{ fontSize: '14px', color: '#64748B' }}>кг</span>
          </div>
        </div>

      </div>

      {/* ==================== 8. СИЛОСЫ + ФБС | ДОБАВКИ (на всю высоту левой колонки) ==================== */}
      {/* Сетка: добавки занимают оба ряда слева — нижний край = низ ФБС. История ниже — на всю ширину. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 420px',
          columnGap: '16px',
          rowGap: '20px',
          alignItems: 'stretch',
          flexShrink: 0,
        }}
      >
          {/* Силосы — ряд 1, колонка 1 */}
          <div
            style={{
              gridColumn: 1,
              gridRow: 1,
              background: 'linear-gradient(165deg, #1E2937 0%, #0F172A 72%, #0B1220 100%)',
              border: CARD_BORDER,
              borderRadius: '22px',
              padding: '22px 20px 20px',
              boxShadow: CARD_VOLUME,
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <h2 style={{ fontSize: '18px', margin: '0 0 16px', color: '#E2E8F0', fontWeight: 700 }}>
              Силосы цемента
            </h2>
            <div
              style={{
                display: 'flex',
                gap: '8px',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'nowrap',
              }}
            >
              {silos.map((silo: any) => {
                const current = Number(silo.current || 0);
                const max = Number(silo.max || 1);
                const percent = Math.min(Math.max((current / max) * 100, 0), 100);

                let fillColor = '#22c55e';
                let textColor = '#34D399';
                if (current < 0) {
                  fillColor = '#ef4444';
                  textColor = '#F87171';
                } else if (percent < 30) {
                  fillColor = '#f59e0b';
                  textColor = '#FBBF24';
                }

                const isLargeSilo = silo.silo_id === 3 || String(silo.name || '').toLowerCase().includes('3');
                const barrelWidth = isLargeSilo ? 200 : 172;
                const barrelHeight = isLargeSilo ? 340 : 320;

                return (
                  <div
                    key={silo.silo_id}
                    style={{ textAlign: 'center', flex: '1 1 0', minWidth: 0 }}
                  >
                    <div
                      style={{
                        margin: '0 auto 14px',
                        width: `${barrelWidth}px`,
                        maxWidth: '100%',
                        height: `${barrelHeight}px`,
                        position: 'relative',
                        filter: 'drop-shadow(0 18px 28px rgba(0,0,0,0.55))',
                      }}
                    >
                      <div
                        style={{
                          position: 'absolute',
                          top: '-18px',
                          left: '50%',
                          transform: 'translateX(-50%)',
                          width: isLargeSilo ? '130px' : '114px',
                          height: '40px',
                          background: '#475569',
                          borderRadius: '50% 50% 0 0',
                          zIndex: 3,
                          border: '4px solid #64748B',
                        }}
                      />
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          width: '100%',
                          height: `${barrelHeight - 18}px`,
                          background: '#1E2937',
                          border: '6px solid #64748B',
                          borderRadius: '24px 24px 10px 10px',
                          overflow: 'hidden',
                          boxShadow: 'inset 0 0 40px rgba(0,0,0,0.7)',
                        }}
                      >
                        <div
                          style={{
                            position: 'absolute',
                            bottom: 0,
                            left: 0,
                            width: '100%',
                            height: `${percent}%`,
                            background: fillColor,
                            transition: 'height 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)',
                          }}
                        />
                      </div>
                      <div
                        style={{
                          position: 'absolute',
                          top: '70px',
                          left: '24px',
                          width: '34px',
                          height: isLargeSilo ? '160px' : '140px',
                          background: 'linear-gradient(transparent, rgba(255,255,255,0.28), transparent)',
                          transform: 'rotate(12deg)',
                          zIndex: 2,
                        }}
                      />
                    </div>

                    <h3 style={{ fontSize: '18px', marginBottom: '4px', fontWeight: 700 }}>{silo.name}</h3>
                    <div style={{ fontSize: '21px', fontWeight: 700, color: textColor }}>
                      {formatCement(current)} / {silo.max} т
                    </div>
                    <div style={{ fontSize: '13px', color: '#64748B', marginTop: '2px' }}>
                      {percent.toFixed(0)}% заполнено
                    </div>

                    <div
                      style={{
                        marginTop: '12px',
                        display: 'flex',
                        gap: '8px',
                        justifyContent: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      <button
                        onClick={() => handleAddCement(silo.silo_id)}
                        style={{
                          padding: '10px 16px',
                          background: '#3B82F6',
                          border: 'none',
                          borderRadius: '12px',
                          color: 'white',
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontSize: '13px',
                        }}
                      >
                        + Внести
                      </button>
                      <button
                        onClick={() => handleSubtractCement(silo.silo_id)}
                        style={{
                          padding: '10px 16px',
                          background: '#EF4444',
                          border: 'none',
                          borderRadius: '12px',
                          color: 'white',
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontSize: '13px',
                        }}
                      >
                        − Списать
                      </button>
                      <button
                        onClick={() => resetSilo(silo.silo_id)}
                        style={{
                          padding: '10px 16px',
                          background: '#475569',
                          border: 'none',
                          borderRadius: '12px',
                          color: 'white',
                          fontWeight: 600,
                          cursor: 'pointer',
                          fontSize: '13px',
                        }}
                      >
                        Обнулить
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ФБС — ряд 2, колонка 1 (под силосами) */}
          <div
            style={{
              gridColumn: 1,
              gridRow: 2,
              background: 'linear-gradient(165deg, #1E2937 0%, #0F172A 72%, #0B1220 100%)',
              border: CARD_BORDER,
              borderRadius: '20px',
              padding: '14px 14px 12px',
              boxShadow: CARD_VOLUME,
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '8px',
                flexWrap: 'wrap',
                marginBottom: '8px',
                flexShrink: 0,
              }}
            >
              <h2 style={{ fontSize: '15px', margin: 0, color: '#E2E8F0', fontWeight: 700 }}>
                Блоки ФБС
              </h2>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center' }}>
                <ModalSelect
                  value={selectedFBSId ? String(selectedFBSId) : ''}
                  onChange={(v) => setSelectedFBSId(v ? Number(v) : null)}
                  placeholder="Тип ФБС..."
                  minPopupWidth={160}
                  triggerStyle={{
                    background: '#0F172A',
                    color: '#E2E8F0',
                    border: '1px solid #475569',
                    borderRadius: 8,
                    padding: '6px 8px',
                    minWidth: 140,
                    fontSize: 12,
                    boxShadow: 'none',
                  }}
                  options={availableFBS.map((r: any) => ({
                    value: String(r.id),
                    label: r.name,
                    text: r.name,
                  }))}
                />
                <button
                  onClick={handleAddFBS}
                  style={{
                    background: '#10B981',
                    color: 'white',
                    padding: '6px 10px',
                    borderRadius: '8px',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    fontSize: '12px',
                  }}
                >
                  + На склад
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {fbsBlocks.length === 0 ? (
                <div style={{ color: '#64748B', fontSize: '12px', padding: '8px 2px' }}>
                  Нет типов ФБС — выбери из списка и добавь на склад
                </div>
              ) : (
                fbsBlocks.map((block: any) => {
                  const qty = Number(block.current || 0);
                  const empty = qty <= 0;
                  const dims =
                    block.length_cm && block.width_cm && block.height_cm
                      ? `${block.length_cm}×${block.width_cm}×${block.height_cm}`
                      : block.dimensions || '—';
                  const accent = empty ? '#64748B' : '#60A5FA';

                  return (
                    <div
                      key={block.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        background: 'linear-gradient(165deg, #1E2937 0%, #0F172A 100%)',
                        border: CARD_BORDER,
                        borderRadius: '12px',
                        padding: '7px 10px',
                        boxShadow: CARD_VOLUME_SOFT,
                        flexShrink: 0,
                      }}
                    >
                      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: '13px',
                            fontWeight: 700,
                            color: '#F1F5F9',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {block.name}
                          {empty ? (
                            <span style={{ marginLeft: '6px', color: '#64748B', fontWeight: 600, fontSize: '11px' }}>
                              · пусто
                            </span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: '11px', color: '#94A3B8' }}>{dims}</div>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: '4px',
                          flex: '0 0 auto',
                          minWidth: '56px',
                        }}
                      >
                        <span
                          style={{
                            fontSize: '24px',
                            fontWeight: 800,
                            letterSpacing: '-0.03em',
                            color: accent,
                            fontVariantNumeric: 'tabular-nums',
                            lineHeight: 1,
                          }}
                        >
                          {qty}
                        </span>
                        <span style={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>шт</span>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          gap: '5px',
                          flex: '0 0 auto',
                          marginLeft: 'auto',
                        }}
                      >
                        <button
                          onClick={() => handleAddFBSBlock(block.id)}
                          style={{
                            padding: '6px 10px',
                            background: '#3B82F6',
                            border: 'none',
                            borderRadius: '8px',
                            color: 'white',
                            fontWeight: 600,
                            cursor: 'pointer',
                            fontSize: '11px',
                          }}
                        >
                          + Добавить
                        </button>
                        <button
                          onClick={() => handleSubtractFBS(block.id)}
                          disabled={empty}
                          style={{
                            padding: '6px 10px',
                            background: empty ? '#334155' : '#EF4444',
                            border: 'none',
                            borderRadius: '8px',
                            color: 'white',
                            fontWeight: 600,
                            cursor: empty ? 'not-allowed' : 'pointer',
                            fontSize: '11px',
                            opacity: empty ? 0.7 : 1,
                          }}
                        >
                          − Списать
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Добавки — колонка 2, на оба ряда: низ = низ ФБС. Историю не сдвигает. */}
          <div
            style={{
              gridColumn: 2,
              gridRow: '1 / span 2',
              background: 'linear-gradient(165deg, #1E2937 0%, #0F172A 72%, #0B1220 100%)',
              border: CARD_BORDER,
              borderRadius: '22px',
              padding: '20px 18px',
              boxShadow: CARD_VOLUME,
              display: 'flex',
              flexDirection: 'column',
              boxSizing: 'border-box',
              minHeight: 0,
              height: '100%',
            }}
          >
            <h2 style={{ fontSize: '18px', margin: '0 0 14px', color: '#E2E8F0', fontWeight: 700, flexShrink: 0 }}>
              Ёмкости добавок
            </h2>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                flex: 1,
                minHeight: 0,
              }}
            >
              {renderAdditiveCard(0, {
                title: 'ПФМ-НЛК',
                accent: '#C084FC',
                accentSoft: '#8B5CF622',
                gradient: 'linear-gradient(180deg, #A78BFA, #7C3AED)',
                todayKg: todayConsumption.pfm,
                avgLitersPerDay: avgDailyLiters.pfm,
                defaultMax: 9000,
                showCubeButtons: true,
                minCubes: 9,
              })}
              {renderAdditiveCard(1, {
                title: 'Линомикс ТипР',
                accent: '#FBBF24',
                accentSoft: '#F59E0B22',
                gradient: 'linear-gradient(180deg, #FBBF24, #D97706)',
                todayKg: todayConsumption.linomix,
                avgLitersPerDay: avgDailyLiters.linomix,
                defaultMax: 1000,
                minCubes: 1,
              })}
            </div>
          </div>
      </div>

      {/* ==================== ЛЕНТА ОПЕРАЦИЙ — на всю ширину под сеткой ==================== */}
      <div
        style={{
          flexShrink: 0,
          width: '100%',
          background: 'linear-gradient(165deg, #1E2937 0%, #0F172A 72%, #0B1220 100%)',
          border: CARD_BORDER,
          borderRadius: '16px',
          padding: '10px 12px',
          boxShadow: CARD_VOLUME,
          maxHeight: '150px',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '10px',
            marginBottom: '6px',
            flexShrink: 0,
          }}
        >
          <h2 style={{ fontSize: '14px', margin: 0, color: '#E2E8F0', fontWeight: 700 }}>
            Лента операций
          </h2>
          <span style={{ fontSize: '11px', color: '#64748B' }}>
            последние {Math.min(operationHistory.length, 40)}
          </span>
        </div>

        {operationHistory.length === 0 ? (
          <div style={{ color: '#64748B', fontSize: '12px', padding: '8px 2px' }}>
            Пока нет операций — внесения и списания появятся здесь
          </div>
        ) : (
          <div
            className="scroll-hidden"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '4px',
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            {operationHistory.map((op, index) => {
              const type = op.operation_type || resolveOperationType(op.action || '');
              const isAdd = type === 'add';
              const isSub = type === 'subtract';
              const accent = isAdd ? '#34D399' : isSub ? '#F87171' : '#94A3B8';
              const bg = isAdd
                ? 'rgba(16, 185, 129, 0.10)'
                : isSub
                  ? 'rgba(239, 68, 68, 0.10)'
                  : 'rgba(100, 116, 139, 0.12)';
              const sign = isAdd ? '+' : isSub ? '−' : '';
              const unit = op.unit || 'л';
              const when = formatHistoryTime(op.created_at || op.time);

              return (
                <div
                  key={op.id || `op-${index}-${when}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    padding: '5px 8px',
                    borderRadius: '8px',
                    background: bg,
                    border: '1px solid #33415566',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                    <div
                      style={{
                        width: '7px',
                        height: '7px',
                        borderRadius: '50%',
                        background: accent,
                        flexShrink: 0,
                      }}
                    />
                    <div
                      style={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: '12px',
                        color: '#F1F5F9',
                        fontWeight: 600,
                      }}
                    >
                      {historyLabel(op)}
                      <span style={{ color: '#94A3B8', fontWeight: 500 }}> · {op.item_type || '—'}</span>
                      <span style={{ color: '#CBD5E1', fontWeight: 600 }}> · {op.user_name || '—'}</span>
                      <span style={{ color: '#64748B', fontWeight: 500 }}> · {when}</span>
                    </div>
                  </div>

                  <div
                    style={{
                      textAlign: 'right',
                      flex: '0 0 auto',
                      whiteSpace: 'nowrap',
                      fontSize: '12px',
                      fontWeight: 700,
                      color: accent,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {sign}
                    {formatHistoryAmount(op.amount, unit)}
                    <span style={{ color: '#64748B', fontWeight: 500, marginLeft: '8px' }}>
                      {Number(op.old_value ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })}
                      →
                      {Number(op.new_value ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

    </div>
  );
}