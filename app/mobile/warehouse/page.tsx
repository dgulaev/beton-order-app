'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import MobileExitButton from '../components/MobileExitButton';
import { useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';
import { supabase } from '@/lib/supabaseClient';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import {
  findRecipeByGrade,
  calculateAdditiveUsage,
  calculateCementUsageKg,
  tonsToAdditiveLiters,
  getAdditiveDensity,
  densitiesFromLabSettings,
  type AdditiveDensities,
} from '@/lib/recipeAdditives';
import { CARD_BORDER, volumeCardSoftStyle, volumeCardStyle, volumeModalStyle } from '@/app/adminCifra/cardStyles';
import { useLowRateAlerts } from '@/app/adminCifra/components/useLowRateAlerts';
import { appAlert } from '@/app/adminCifra/components/appDialog';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { fetchWithTimeout, safeFetch } from '@/lib/fetchWithTimeout';
import type { LowRateAlertInfo } from '@/lib/siloConfig';
import { useUserRole } from '../../providers/UserRoleProvider';

// ==================== ВСПОМОГАТЕЛЬНЫЕ КОМПОНЕНТЫ ====================

function KpiCard({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div style={volumeCardSoftStyle({ padding: '16px', borderRadius: 16, flex: 1, minWidth: 0 })}>
      <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '6px', lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: '26px', fontWeight: '700', color, lineHeight: 1 }}>
        {value} <span style={{ fontSize: '14px', color: '#64748B', fontWeight: 400 }}>{unit}</span>
      </div>
    </div>
  );
}

function ProgressBar({ current, max, color }: { current: number; max: number; color: string }) {
  const pct = Math.min(Math.max((current / Math.max(max, 1)) * 100, 0), 100);
  const negative = current < 0;
  const low = !negative && pct < 30;
  const fill = negative ? '#F87171' : low ? '#F59E0B' : color;
  return (
    <div
      style={{
        background: 'rgba(2, 6, 23, 0.65)',
        borderRadius: 9999,
        height: 12,
        overflow: 'hidden',
        border: '1px solid rgba(148, 163, 184, 0.22)',
        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.35)',
      }}
    >
      <div
        style={{
          height: '100%',
          width: `${pct}%`,
          minWidth: pct > 0 ? 6 : 0,
          background: fill,
          borderRadius: 9999,
          transition: 'width 0.4s ease',
          boxShadow: pct > 0 ? `0 0 10px ${fill}55` : undefined,
        }}
      />
    </div>
  );
}

// ==================== МОДАЛКА ВВОДА ЧИСЛА (замена prompt) ====================

interface InputModalProps {
  title: string;
  unit: string;
  onConfirm: (value: number) => void;
  onClose: () => void;
}

function InputModal({ title, unit, onConfirm, onClose }: InputModalProps) {
  const [raw, setRaw] = useState('');
  useBodyScrollLock(true);

  const submit = () => {
    const n = parseFloat(raw.replace(',', '.'));
    if (!isNaN(n) && n > 0) { onConfirm(n); onClose(); }
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', zIndex: 200000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}
      onClick={onClose}
    >
      <div
        style={volumeModalStyle({ padding: '28px', width: '100%', maxWidth: '380px' })}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: '17px', fontWeight: '600', color: '#fff', marginBottom: '16px', whiteSpace: 'pre-line' }}>{title}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            autoFocus
            type="number"
            inputMode="decimal"
            min="0"
            value={raw}
            onChange={e => setRaw(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="0"
            style={volumeCardSoftStyle({
              flex: 1,
              padding: '14px',
              borderRadius: 12,
              color: '#fff',
              fontSize: '20px',
              textAlign: 'right',
              outline: 'none',
              colorScheme: 'dark',
            })}
          />
          <span style={{ color: '#94A3B8', fontSize: '16px', flexShrink: 0 }}>{unit}</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
          <button
            onClick={onClose}
            style={volumeCardSoftStyle({ flex: 1, padding: '14px', borderRadius: 12, color: '#94A3B8', fontSize: '16px', cursor: 'pointer', border: CARD_BORDER })}
          >
            Отмена
          </button>
          <button
            onClick={submit}
            disabled={!raw || isNaN(parseFloat(raw))}
            style={{
              flex: 1, padding: '14px', background: '#3B82F6', border: 'none', borderRadius: '12px',
              color: '#fff', fontSize: '16px', fontWeight: '600', cursor: 'pointer',
              opacity: !raw || isNaN(parseFloat(raw)) ? 0.4 : 1,
            }}
          >
            Подтвердить
          </button>
        </div>
      </div>
    </div>
  );
}

// ==================== ГЛАВНАЯ СТРАНИЦА ====================

export default function MobileWarehousePage() {
  const { user } = useUserRole();
  const actorName = user?.full_name || user?.username || 'Сотрудник';
  const [silos, setSilos] = useState<any[]>([]);
  const [additives, setAdditives] = useState<any[]>([]);
  const [fbsBlocks, setFbsBlocks] = useState<any[]>([]);
  const [availableFBS, setAvailableFBS] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [todayConsumption, setTodayConsumption] = useState({ cement: 0, pfm: 0, linomix: 0 });
  const [additiveDensities, setAdditiveDensities] = useState<AdditiveDensities>({});
  const [loading, setLoading] = useState(true);
  const [lowRateAlerts, setLowRateAlerts] = useState<LowRateAlertInfo[]>([]);
  const [activeSiloId, setActiveSiloId] = useState<number | null>(null);
  useLowRateAlerts(lowRateAlerts);

  // Модалка ввода: { title, unit, onConfirm } или null
  const [inputModal, setInputModal] = useState<{ title: string; unit: string; onConfirm: (v: number) => void } | null>(null);

  // ==================== ЗАГРУЗКА ДАННЫХ ====================

  const loadInFlightRef = useRef(false);

  const loadWarehouse = useCallback(async () => {
    // Не дёргаем сеть, пока вкладка в фоне — запросы всё равно отменят
    if (typeof document !== 'undefined' && document.hidden) return;
    // Не копим висящие poll'ы (15 с + wake) на плохой сети
    if (loadInFlightRef.current) return;
    loadInFlightRef.current = true;

    try {
      const [warehouseRes, recipesRes, labRes, shiftRes] = await Promise.all([
        safeFetch('/api/adminCifra/warehouse', { cache: 'no-store' }),
        safeFetch('/api/adminCifra/recipes', { cache: 'no-store' }),
        safeFetch('/api/adminCifra/lab-settings', {
          cache: 'no-store',
          headers: adminCifraAuthHeaders(),
        }),
        safeFetch('/api/adminCifra/operator-shift', {
          cache: 'no-store',
          headers: adminCifraAuthHeaders(),
        }),
      ]);

      try {
        if (warehouseRes?.ok) {
          const data = await warehouseRes.json();
          setSilos(data.silos || []);
          setLowRateAlerts(Array.isArray(data.lowRateAlerts) ? data.lowRateAlerts : []);
          setAdditives(
            (data.additives || data.warehouse_additives || []).map((a: any) => ({
              ...a,
              id: a.id || a.additive_id,
              current: Number(a.current || 0),
              max: Number(a.max || 9000),
            })),
          );
        }

        if (recipesRes?.ok) {
          const all = await recipesRes.json();
          setRecipes(all);
          const fbs = all
            .filter((r: any) => r.item_type === 'fbs')
            .map((r: any) => ({
              ...r,
              dimensions: (r.length_cm && r.width_cm && r.height_cm)
                ? `${r.length_cm}×${r.width_cm}×${r.height_cm} см`
                : null,
            }));
          setAvailableFBS(fbs);
        }

        if (labRes?.ok) {
          setAdditiveDensities(densitiesFromLabSettings(await labRes.json()));
        }

        if (shiftRes?.ok) {
          const shift = await shiftRes.json();
          const sid = shift?.active_silo_id != null ? Number(shift.active_silo_id) : null;
          setActiveSiloId(Number.isFinite(sid as number) ? sid : null);
        }
      } catch {
        // битый JSON / обрыв ответа — тихо, данные останутся прошлыми
      }
    } finally {
      loadInFlightRef.current = false;
    }
  }, []);

  const loadFBS = useCallback(async (available: any[]) => {
    if (!available.length) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const { data } = await supabase.from('fbs_blocks').select('*').order('name');
      const merged = available.map((r: any) => {
        const ex = (data || []).find((b: any) => b.name === r.name || b.name === r.code);
        return { ...r, id: ex?.id || r.id, name: r.name || r.code, current: Number(ex?.current || 0) };
      });
      setFbsBlocks(merged);
    } catch {
      /* тихо */
    }
  }, []);

  const loadTodayConsumption = useCallback(async (recipeList: any[]) => {
    if (typeof document !== 'undefined' && document.hidden) return;
    try {
      const res = await safeFetch('/api/adminCifra/production-log?today=true', {
        timeoutMs: 4000,
      });
      if (!res?.ok) return;
      const data = await res.json();
      const logs = data.logs || data || [];
      let cement = 0, pfm = 0, linomix = 0;
      logs.forEach((log: any) => {
        const volume = parseFloat(log.volume || log.qty || 0);
        if (isNaN(volume) || volume <= 0) return;
        const recipe = findRecipeByGrade(recipeList, log.concrete_grade);
        if (!recipe) return;
        cement += calculateCementUsageKg(recipe, volume);
        const usage = calculateAdditiveUsage(recipe, volume);
        if (usage?.additiveId === 1) pfm += usage.kg;
        else if (usage?.additiveId === 2) linomix += usage.kg;
      });
      setTodayConsumption({ cement: Math.round(cement / 1000), pfm: Math.round(pfm), linomix: Math.round(linomix) });
    } catch { /* тихо */ }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadWarehouse();
      setLoading(false);
    })();
  }, [loadWarehouse]);

  useEffect(() => {
    if (availableFBS.length > 0) loadFBS(availableFBS);
  }, [availableFBS, loadFBS]);

  useEffect(() => {
    if (recipes.length > 0) loadTodayConsumption(recipes);
  }, [recipes, loadTodayConsumption]);

  // Realtime: новая отгрузка → пересчитать расход
  useRealtimeBroadcast({ topic: 'production_logs:all', onInsert: () => loadTodayConsumption(recipes) });
  // Цемент списывается на «В пути», добавки — на «Разгружен»
  useRealtimeBroadcast({
    topic: 'order_mixers:all',
    onUpdate: (r: any) => {
      if (r?.status === 'В пути' || r?.status === 'Разгружен') void loadWarehouse();
    },
  });

  // Poll остатков/алертов — только когда вкладка видима; после возврата — сразу обновить
  useEffect(() => {
    let t: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (t) {
        clearInterval(t);
        t = null;
      }
    };
    const start = () => {
      stop();
      t = setInterval(() => {
        if (!document.hidden) void loadWarehouse();
      }, 15000);
    };

    const onVisibility = () => {
      if (document.hidden) {
        stop();
        return;
      }
      void loadWarehouse();
      start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadWarehouse]);

  // ==================== СОХРАНЕНИЕ В БД ====================
  // В payload — только явно переданные срезы (не затираем силосы при правке добавок).

  const save = async (s?: any[], a?: any[], f?: any[]): Promise<boolean> => {
    try {
      const payload: Record<string, unknown> = {};
      if (s !== undefined) {
        payload.silos = s.map((x: any) => ({
          silo_id: Number(x.silo_id),
          current: Number(x.current || 0),
          max: Number(x.max || 0),
          name: x.name,
        }));
      }
      if (a !== undefined) {
        payload.additives = a.map((x: any) => ({
          additive_id: Number(x.additive_id || x.id || 1),
          name: x.name,
          current: Number(x.current || 0),
          max: Number(x.max || 9000),
        }));
      }
      if (f !== undefined) {
        payload.fbs = f.map((x: any) => ({
          id: Number(x.id),
          name: x.name || x.code || '',
          current: Number(x.current || 0),
        }));
      }
      if (Object.keys(payload).length === 0) return true;

      const res = await fetchWithTimeout('/api/adminCifra/warehouse', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.error('Ошибка сохранения склада:', res.status, await res.text().catch(() => ''));
        return false;
      }
      return true;
    } catch (err) {
      console.error('Ошибка сохранения склада:', err);
      return false;
    }
  };

  // ==================== ДЕЙСТВИЯ С СИЛОСАМИ ====================

  const siloAction = (siloId: number, delta: 1 | -1) => {
    const silo = silos.find((s) => s.silo_id === siloId);
    if (!silo) return;
    const isAdd = delta > 0;
    setInputModal({
      title: isAdd ? `Внести в ${silo.name}` : `Списать из ${silo.name}`,
      unit: 'кг',
      onConfirm: async (kg) => {
        if (isAdd) {
          try {
            const res = await fetchWithTimeout('/api/adminCifra/warehouse/silo-mutate', {
              method: 'POST',
              headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
              body: JSON.stringify({
                action: 'add',
                siloId,
                amountKg: kg,
                userName: actorName,
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
              await appAlert(data.error || 'Не удалось внести', { title: 'Ошибка', variant: 'danger' });
              return;
            }
            setSilos((prev) => prev.map((s) => (
              s.silo_id === siloId ? { ...s, current: Number(data.newCurrent ?? s.current) } : s
            )));
            if (Number(data.savingKg || 0) > 0) {
              await appAlert(
                `Зафиксирована экономия: ${Number(data.savingKg).toLocaleString('ru-RU')} кг`,
                { title: 'Экономия цемента', variant: 'success' },
              );
            }
            void loadWarehouse();
          } catch (err) {
            console.error(err);
            await appAlert('Ошибка внесения цемента', { title: 'Ошибка', variant: 'danger' });
          }
          return;
        }

        const snapshot = silos;
        const updated = silos.map((s) => {
          if (s.silo_id !== siloId) return s;
          const oldCurrent = Number(s.current || 0);
          const newCurrent = Math.max(-50, oldCurrent - kg / 1000);
          return { ...s, current: newCurrent };
        });
        setSilos(updated);
        const ok = await save(updated);
        if (!ok) {
          setSilos(snapshot);
          await appAlert('Не удалось списать цемент', { title: 'Ошибка', variant: 'danger' });
          return;
        }
        void loadWarehouse();
      },
    });
  };

  // ==================== ДЕЙСТВИЯ С ДОБАВКАМИ ====================
  // Поступление: тонны → литры. Ручное списание: литры.
  // Важно: работаем по id добавки, не по индексу после filter.

  const resolveAdditiveId = (add: any): 1 | 2 => {
    const id = Number(add?.additive_id ?? add?.id);
    if (id === 1 || id === 2) return id as 1 | 2;
    return 1;
  };

  const additiveAction = (add: any, delta: 1 | -1) => {
    if (!add) return;
    const isAdd = delta > 0;
    const additiveKey = Number(add.additive_id ?? add.id);
    const additiveId = resolveAdditiveId(add);
    const density = getAdditiveDensity(additiveId, additiveDensities);
    const litersPerTon = Math.round(tonsToAdditiveLiters(additiveId, 1, additiveDensities));

    setInputModal({
      title: isAdd
        ? `Внести в ${add.name}\n1 т ≈ ${litersPerTon} л (${density} кг/л)`
        : `Списать из ${add.name} (литры)`,
      unit: isAdd ? 'т' : 'л',
      onConfirm: async (value) => {
        const liters = isAdd
          ? Math.round(tonsToAdditiveLiters(additiveId, value, additiveDensities) * 10) / 10
          : value;
        const snapshot = additives;
        const updated = additives.map((a) =>
          Number(a.additive_id ?? a.id) === additiveKey
            ? { ...a, current: Math.max(0, Number(a.current || 0) + delta * liters) }
            : a,
        );
        setAdditives(updated);
        const ok = await save(undefined, updated);
        if (!ok) {
          setAdditives(snapshot);
          await appAlert('Не удалось сохранить добавку', { title: 'Ошибка', variant: 'danger' });
        }
      },
    });
  };

  // ==================== ДЕЙСТВИЯ С ФБС ====================

  const fbsAction = (blockId: number, delta: 1 | -1) => {
    const block = fbsBlocks.find((b) => b.id === blockId);
    if (!block) return;
    setInputModal({
      title: delta > 0 ? `Добавить ${block.name}` : `Списать ${block.name}`,
      unit: 'шт',
      onConfirm: async (qty) => {
        const n = Math.round(qty);
        const snapshot = fbsBlocks;
        const updated = fbsBlocks.map((b) =>
          b.id === blockId
            ? { ...b, current: Math.max(0, Number(b.current || 0) + delta * n) }
            : b,
        );
        setFbsBlocks(updated);
        const ok = await save(undefined, undefined, updated);
        if (!ok) {
          setFbsBlocks(snapshot);
          await appAlert('Не удалось сохранить ФБС', { title: 'Ошибка', variant: 'danger' });
        }
      },
    });
  };

  // ==================== РЕНДЕР ====================

  if (loading) {
    return (
      <div style={{ padding: '16px', paddingBottom: '100px', minHeight: '100vh', background: '#0F172A', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#64748B', fontSize: '16px' }}>Загрузка...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', paddingBottom: '100px', minHeight: '100vh', background: '#0F172A' }}>

      {/* ШАПКА */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
        <h1 style={{ fontSize: '26px', fontWeight: '700', margin: 0, color: '#fff' }}>Склад</h1>
        <MobileExitButton />
      </div>

      {/* КПИ РАСХОД СЕГОДНЯ */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '24px' }}>
        <KpiCard label="Цемент сегодня" value={todayConsumption.cement} unit="т" color="#10B981" />
        <KpiCard label="ПФМ-НЛК сегодня" value={todayConsumption.pfm} unit="кг" color="#C084FC" />
        <KpiCard label="Линомикс сегодня" value={todayConsumption.linomix} unit="кг" color="#60A5FA" />
      </div>

      {/* СИЛОСЫ ЦЕМЕНТА */}
      <SectionTitle>Силосы цемента</SectionTitle>
      {activeSiloId == null ? (
        <div style={{
          marginBottom: '12px', padding: '10px 12px', borderRadius: 12,
          background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.35)',
          color: '#FBBF24', fontSize: '13px', lineHeight: 1.35,
        }}>
          Рабочий силос сегодня не выбран — автосписание цемента при «В пути» не сработает. Выбери силос на десктопе у оператора.
        </div>
      ) : (
        <div style={{
          marginBottom: '12px', padding: '10px 12px', borderRadius: 12,
          background: 'rgba(16,185,129,0.12)', border: '1px solid rgba(52,211,153,0.35)',
          color: '#6EE7B7', fontSize: '13px', lineHeight: 1.35, fontWeight: 600,
        }}>
          Автосписание идёт с силоса №{activeSiloId}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '28px' }}>
        {silos.map((silo: any) => {
          const current = Number(silo.current || 0);
          const max = Number(silo.max || 1);
          const pct = Math.min(Math.max((current / max) * 100, 0), 100);
          const low = pct < 30 || current < 0;
          const negative = current < 0;
          const isActive = Number(silo.silo_id) === activeSiloId;

          // Важно: не передавать background/border/boxShadow: undefined —
          // в volumeCardStyle это затирает базовую плашку (React пропускает undefined).
          return (
            <div
              key={silo.silo_id}
              style={volumeCardStyle({
                padding: '16px',
                borderRadius: 16,
                position: 'relative',
                overflow: 'hidden',
                ...(isActive
                  ? {
                      border: '1px solid rgba(52,211,153,0.55)',
                      background:
                        'linear-gradient(165deg, rgba(16,185,129,0.28) 0%, #1E2937 42%, #0F172A 100%)',
                      boxShadow:
                        '0 12px 28px rgba(0,0,0,0.34), 0 0 0 1px rgba(52,211,153,0.14), 0 10px 28px rgba(16,185,129,0.18), inset 0 1px 0 rgba(255,255,255,0.12)',
                    }
                  : {}),
              })}
            >
              {isActive && (
                <div
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: 4,
                    background: 'linear-gradient(180deg, #34D399 0%, #059669 100%)',
                  }}
                />
              )}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 10,
                  gap: 8,
                  paddingLeft: isActive ? 6 : 0,
                }}
              >
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 16,
                    color: isActive ? '#A7F3D0' : '#E2E8F0',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    flexWrap: 'wrap',
                  }}
                >
                  {silo.name}
                  {isActive && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 800,
                        color: '#ECFDF5',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        padding: '3px 9px',
                        borderRadius: 999,
                        background: 'linear-gradient(135deg, #059669 0%, #10B981 100%)',
                        boxShadow: '0 3px 10px rgba(16,185,129,0.4)',
                      }}
                    >
                      Рабочий
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontSize: 18,
                    fontWeight: 700,
                    color: negative ? '#F87171' : low ? '#FBBF24' : '#34D399',
                    flexShrink: 0,
                  }}
                >
                  {current.toFixed(2)}{' '}
                  <span style={{ fontSize: 13, color: '#64748B' }}>/ {silo.max} т</span>
                </span>
              </div>
              <div style={{ paddingLeft: isActive ? 6 : 0 }}>
                <ProgressBar current={current} max={max} color="#34D399" />
                <div
                  style={{
                    fontSize: 12,
                    color: isActive ? '#6EE7B7' : '#64748B',
                    marginTop: 6,
                    textAlign: 'right',
                  }}
                >
                  {pct.toFixed(0)}%
                  {isActive && <span style={{ marginLeft: 8 }}>· с него списывается</span>}
                  {low && (
                    <span style={{ color: '#F59E0B', marginLeft: 8 }}>⚠ Низкий уровень</span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
                  <ActionBtn color="#3B82F6" onClick={() => siloAction(silo.silo_id, 1)}>
                    + Внести
                  </ActionBtn>
                  <ActionBtn color="#EF4444" onClick={() => siloAction(silo.silo_id, -1)}>
                    − Списать
                  </ActionBtn>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* ДОБАВКИ */}
      <SectionTitle>Ёмкости добавок</SectionTitle>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '28px' }}>
        {additives.filter((add: any) => (add.name || '').toLowerCase() !== 'добавка 3').map((add: any, idx: number) => {
          const current = Number(add.current || 0);
          const max = Number(add.max || 9000);
          const pct = Math.min(Math.max((current / max) * 100, 0), 100);
          const low = pct < 30;
          const barColor = idx === 0 ? '#8B5CF6' : '#F59E0B';
          const addKey = Number(add.additive_id ?? add.id ?? idx);

          return (
            <div key={addKey} style={volumeCardStyle({ padding: '16px', borderRadius: 16 })}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                <span style={{ fontWeight: '600', fontSize: '16px', color: '#E2E8F0' }}>{add.name}</span>
                <span style={{ fontSize: '18px', fontWeight: '700', color: low ? '#FBBF24' : barColor }}>
                  {current.toFixed(0)} <span style={{ fontSize: '13px', color: '#64748B' }}>/ {max} л</span>
                </span>
              </div>
              <ProgressBar current={current} max={max} color={barColor} />
              <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px', textAlign: 'right' }}>
                {pct.toFixed(0)}%
                {low && <span style={{ color: '#F59E0B', marginLeft: '8px' }}>⚠ Низкий уровень</span>}
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <ActionBtn color="#3B82F6" onClick={() => additiveAction(add, 1)}>+ Внести (т)</ActionBtn>
                <ActionBtn color="#EF4444" onClick={() => additiveAction(add, -1)}>− Списать (л)</ActionBtn>
              </div>
            </div>
          );
        })}
      </div>

      {/* БЛОКИ ФБС */}
      {fbsBlocks.length > 0 && (
        <>
          <SectionTitle>Блоки ФБС</SectionTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '28px' }}>
            {fbsBlocks.map((block: any) => {
              const qty = Number(block.current || 0);
              return (
                <div key={block.id} style={volumeCardStyle({ padding: '16px', borderRadius: 16, display: 'flex', alignItems: 'center', gap: '12px' })}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: '600', fontSize: '15px', color: '#E2E8F0' }}>{block.name}</div>
                    {block.dimensions && <div style={{ fontSize: '12px', color: '#64748B', marginTop: '2px' }}>{block.dimensions}</div>}
                  </div>
                  <div style={{ fontSize: '28px', fontWeight: '700', color: qty > 0 ? '#60A5FA' : '#475569', minWidth: '56px', textAlign: 'right' }}>
                    {qty}<span style={{ fontSize: '13px', fontWeight: 400, color: '#64748B', marginLeft: '2px' }}>шт</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <button
                      onClick={() => fbsAction(block.id, 1)}
                      style={{ padding: '8px 14px', background: '#10B981', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: '600', fontSize: '14px', cursor: 'pointer' }}
                    >+</button>
                    <button
                      onClick={() => fbsAction(block.id, -1)}
                      disabled={qty <= 0}
                      style={{ padding: '8px 14px', background: qty > 0 ? '#EF4444' : '#334155', border: 'none', borderRadius: '10px', color: '#fff', fontWeight: '600', fontSize: '14px', cursor: qty > 0 ? 'pointer' : 'not-allowed' }}
                    >−</button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* МОДАЛКА ВВОДА */}
      {inputModal && (
        <InputModal
          title={inputModal.title}
          unit={inputModal.unit}
          onConfirm={inputModal.onConfirm}
          onClose={() => setInputModal(null)}
        />
      )}
    </div>
  );
}

// ==================== МЕЛКИЕ ХЕЛПЕРЫ ====================

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{ fontSize: '18px', fontWeight: '600', color: '#94A3B8', margin: '0 0 12px 2px' }}>
      {children}
    </h2>
  );
}

function ActionBtn({ color, onClick, children }: { color: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={volumeCardSoftStyle({
        flex: 1,
        padding: '12px',
        borderRadius: 12,
        border: `1px solid ${color}55`,
        background: `linear-gradient(165deg, ${color}22 0%, rgba(15,23,42,0.92) 70%)`,
        color,
        fontWeight: 600,
        fontSize: 15,
        cursor: 'pointer',
      })}
    >
      {children}
    </button>
  );
}
