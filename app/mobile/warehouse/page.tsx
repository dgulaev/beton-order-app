'use client';

import { useState, useEffect, useCallback } from 'react';
import MobileExitButton from '../components/MobileExitButton';
import { useRealtimeBroadcast } from '@/hooks/useRealtimeBroadcast';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import {
  findRecipeByGrade,
  calculateAdditiveUsage,
  calculateCementUsageKg,
} from '@/lib/recipeAdditives';

// ==================== ВСПОМОГАТЕЛЬНЫЕ КОМПОНЕНТЫ ====================

function KpiCard({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div style={{ background: '#1E2937', borderRadius: '16px', padding: '16px', flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: '12px', color: '#94A3B8', marginBottom: '6px', lineHeight: 1.3 }}>{label}</div>
      <div style={{ fontSize: '26px', fontWeight: '700', color, lineHeight: 1 }}>
        {value} <span style={{ fontSize: '14px', color: '#64748B', fontWeight: 400 }}>{unit}</span>
      </div>
    </div>
  );
}

function ProgressBar({ current, max, color }: { current: number; max: number; color: string }) {
  const pct = Math.min(Math.max((current / Math.max(max, 1)) * 100, 0), 100);
  const low = pct < 30;
  return (
    <div style={{ background: '#0F172A', borderRadius: '9999px', height: '12px', overflow: 'hidden' }}>
      <div style={{
        height: '100%',
        width: `${pct}%`,
        background: low ? '#F59E0B' : color,
        borderRadius: '9999px',
        transition: 'width 0.4s ease',
      }} />
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
        style={{ background: '#1E2937', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '380px' }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ fontSize: '17px', fontWeight: '600', color: '#fff', marginBottom: '16px' }}>{title}</div>
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
            style={{
              flex: 1,
              padding: '14px',
              background: '#25334A',
              border: 'none',
              borderRadius: '12px',
              color: '#fff',
              fontSize: '20px',
              textAlign: 'right',
              outline: 'none',
            }}
          />
          <span style={{ color: '#94A3B8', fontSize: '16px', flexShrink: 0 }}>{unit}</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: '14px', background: 'transparent', border: '1px solid #47556930', borderRadius: '12px', color: '#94A3B8', fontSize: '16px', cursor: 'pointer' }}
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
  const [silos, setSilos] = useState<any[]>([]);
  const [additives, setAdditives] = useState<any[]>([]);
  const [fbsBlocks, setFbsBlocks] = useState<any[]>([]);
  const [availableFBS, setAvailableFBS] = useState<any[]>([]);
  const [recipes, setRecipes] = useState<any[]>([]);
  const [todayConsumption, setTodayConsumption] = useState({ cement: 0, pfm: 0, linomix: 0 });
  const [loading, setLoading] = useState(true);

  // Модалка ввода: { title, unit, onConfirm } или null
  const [inputModal, setInputModal] = useState<{ title: string; unit: string; onConfirm: (v: number) => void } | null>(null);

  // ==================== ЗАГРУЗКА ДАННЫХ ====================

  const loadWarehouse = useCallback(async () => {
    try {
      const [warehouseRes, recipesRes] = await Promise.all([
        fetch('/api/adminCifra/warehouse', { cache: 'no-store' }),
        fetch('/api/adminCifra/recipes', { cache: 'no-store' }),
      ]);

      if (warehouseRes.ok) {
        const data = await warehouseRes.json();
        setSilos(data.silos || []);
        setAdditives(
          (data.additives || data.warehouse_additives || []).map((a: any) => ({
            ...a,
            id: a.id || a.additive_id,
            current: Number(a.current || 0),
            max: Number(a.max || 9000),
          }))
        );
      }

      if (recipesRes.ok) {
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
    } catch (err) {
      console.error('Ошибка загрузки склада:', err);
    }
  }, []);

  const loadFBS = useCallback(async (available: any[]) => {
    if (!available.length) return;
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
      );
      const { data } = await sb.from('fbs_blocks').select('*').order('name');
      const merged = available.map((r: any) => {
        const ex = (data || []).find((b: any) => b.name === r.name || b.name === r.code);
        return { ...r, id: ex?.id || r.id, name: r.name || r.code, current: Number(ex?.current || 0) };
      });
      setFbsBlocks(merged);
    } catch (err) {
      console.error('Ошибка загрузки ФБС:', err);
    }
  }, []);

  const loadTodayConsumption = useCallback(async (recipeList: any[]) => {
    try {
      const res = await fetch('/api/adminCifra/production-log?today=true', {
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) return;
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
  // Realtime: миксер разгружен → обновить остатки добавок
  useRealtimeBroadcast({
    topic: 'order_mixers:all',
    onUpdate: (r: any) => { if (r?.status === 'Разгружен') loadWarehouse(); },
  });

  // ==================== СОХРАНЕНИЕ В БД ====================

  const save = async (s?: any[], a?: any[], f?: any[]) => {
    try {
      await fetch('/api/adminCifra/warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          silos: (s || silos).map((x: any) => ({ silo_id: Number(x.silo_id), current: Number(x.current || 0) })),
          additives: (a || additives).map((x: any) => ({ additive_id: Number(x.additive_id || x.id || 1), name: x.name, current: Number(x.current || 0), max: Number(x.max || 9000) })),
          fbs: (f || fbsBlocks).map((x: any) => ({ id: Number(x.id), name: x.name || x.code || '', current: Number(x.current || 0) })),
        }),
      });
    } catch (err) {
      console.error('Ошибка сохранения склада:', err);
    }
  };

  // ==================== ДЕЙСТВИЯ С СИЛОСАМИ ====================

  const siloAction = (siloId: number, delta: 1 | -1) => {
    const silo = silos.find(s => s.silo_id === siloId);
    if (!silo) return;
    const isAdd = delta > 0;
    setInputModal({
      title: isAdd ? `Внести в ${silo.name}` : `Списать из ${silo.name}`,
      unit: 'кг',
      onConfirm: (kg) => {
        setSilos(prev => {
          const updated = prev.map(s => s.silo_id === siloId
            ? { ...s, current: Math.max(-50, Number(s.current || 0) + delta * kg / 1000) }
            : s);
          save(updated);
          return updated;
        });
      },
    });
  };

  // ==================== ДЕЙСТВИЯ С ДОБАВКАМИ ====================

  const additiveAction = (idx: number, delta: 1 | -1) => {
    const add = additives[idx];
    if (!add) return;
    const isAdd = delta > 0;
    setInputModal({
      title: isAdd ? `Внести в ${add.name}` : `Списать из ${add.name}`,
      unit: 'л',
      onConfirm: (liters) => {
        setAdditives(prev => {
          const updated = prev.map((a, i) => i === idx
            ? { ...a, current: Math.max(0, Number(a.current || 0) + delta * liters) }
            : a);
          save(undefined, updated);
          return updated;
        });
      },
    });
  };

  // ==================== ДЕЙСТВИЯ С ФБС ====================

  const fbsAction = (blockId: number, delta: 1 | -1) => {
    const block = fbsBlocks.find(b => b.id === blockId);
    if (!block) return;
    setInputModal({
      title: delta > 0 ? `Добавить ${block.name}` : `Списать ${block.name}`,
      unit: 'шт',
      onConfirm: (qty) => {
        const n = Math.round(qty);
        setFbsBlocks(prev => {
          const updated = prev.map(b => b.id === blockId
            ? { ...b, current: Math.max(0, Number(b.current || 0) + delta * n) }
            : b);
          save(undefined, undefined, updated);
          return updated;
        });
      },
    });
  };

  // ==================== РЕНДЕР ====================

  if (loading) {
    return (
      <div style={{ padding: '16px', paddingBottom: '100px', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#64748B', fontSize: '16px' }}>Загрузка...</div>
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', paddingBottom: '100px', minHeight: '100vh' }}>

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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '28px' }}>
        {silos.map((silo: any) => {
          const current = Number(silo.current || 0);
          const max = Number(silo.max || 1);
          const pct = Math.min(Math.max((current / max) * 100, 0), 100);
          const low = pct < 30;
          const negative = current < 0;

          return (
            <div key={silo.silo_id} style={{ background: '#1E2937', borderRadius: '16px', padding: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' }}>
                <span style={{ fontWeight: '600', fontSize: '16px', color: '#E2E8F0' }}>{silo.name}</span>
                <span style={{ fontSize: '18px', fontWeight: '700', color: negative ? '#F87171' : low ? '#FBBF24' : '#34D399' }}>
                  {current.toFixed(2)} <span style={{ fontSize: '13px', color: '#64748B' }}>/ {silo.max} т</span>
                </span>
              </div>
              <ProgressBar current={current} max={max} color="#34D399" />
              <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px', textAlign: 'right' }}>
                {pct.toFixed(0)}%
                {low && <span style={{ color: '#F59E0B', marginLeft: '8px' }}>⚠ Низкий уровень</span>}
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
                <ActionBtn color="#3B82F6" onClick={() => siloAction(silo.silo_id, 1)}>+ Внести</ActionBtn>
                <ActionBtn color="#EF4444" onClick={() => siloAction(silo.silo_id, -1)}>− Списать</ActionBtn>
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

          return (
            <div key={add.id || idx} style={{ background: '#1E2937', borderRadius: '16px', padding: '16px' }}>
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
                <ActionBtn color="#3B82F6" onClick={() => additiveAction(idx, 1)}>+ Внести</ActionBtn>
                <ActionBtn color="#EF4444" onClick={() => additiveAction(idx, -1)}>− Списать</ActionBtn>
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
                <div key={block.id} style={{ background: '#1E2937', borderRadius: '16px', padding: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
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
      style={{
        flex: 1, padding: '12px', background: 'transparent',
        border: `1px solid ${color}40`, borderRadius: '12px',
        color, fontWeight: '600', fontSize: '15px', cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}
