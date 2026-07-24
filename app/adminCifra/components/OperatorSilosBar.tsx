'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useUserRole } from '@/app/providers/UserRoleProvider';
import { SILO_SPEC } from '@/lib/siloConfig';
import { CARD_BORDER, volumeCardSoftStyle } from '../cardStyles';
import { appAlert, appConfirm, appPrompt } from './appDialog';

type SiloRow = {
  silo_id: number;
  name: string;
  current: number;
  max: number;
};

type Props = {
  activeSiloId: number | null;
  onActiveSiloChange: (siloId: number) => void;
  /** Подсветка-напоминание, если силос не выбран */
  highlightMissing: boolean;
  actorName?: string;
  style?: CSSProperties;
};

function adminAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (typeof window !== 'undefined') {
    const userId = localStorage.getItem('userId');
    if (userId) headers['x-user-id'] = userId;
  }
  return headers;
}

export default function OperatorSilosBar({
  activeSiloId,
  onActiveSiloChange,
  highlightMissing,
  actorName,
  style,
}: Props) {
  const { isAdmin } = useUserRole();
  const [silos, setSilos] = useState<SiloRow[]>([]);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);

  const loadSilos = useCallback(async () => {
    try {
      const res = await fetch('/api/adminCifra/warehouse', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const rows = (data.silos || []).map((s: any) => ({
        silo_id: Number(s.silo_id),
        name: String(s.name || `Силос ${s.silo_id}`),
        current: Number(s.current || 0),
        max: Number(s.max || 0),
      }));
      const ordered = SILO_SPEC.map((spec) => {
        const found = rows.find((r: SiloRow) => r.silo_id === spec.silo_id);
        return found || { silo_id: spec.silo_id, name: spec.name, current: 0, max: spec.max };
      });
      setSilos(ordered);
    } catch (err) {
      console.error('Не удалось загрузить силосы:', err);
    }
  }, []);

  useEffect(() => {
    loadSilos();
    const t = setInterval(loadSilos, 15000);
    return () => clearInterval(t);
  }, [loadSilos]);

  const persistSilos = async (next: SiloRow[]) => {
    setSilos(next);
    await fetch('/api/adminCifra/warehouse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        silos: next.map((s) => ({
          silo_id: s.silo_id,
          current: s.current,
          max: s.max,
          name: s.name,
        })),
      }),
    });
  };

  const logHistory = (
    operation_type: string,
    item_type: string,
    amount: number,
    old_value: number,
    new_value: number,
  ) => {
    fetch('/api/adminCifra/warehouse/history', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operation_type,
        item_type,
        amount,
        old_value,
        new_value,
        unit: 'кг',
        user_name: actorName || null,
      }),
    }).catch(() => {});
  };

  const handleAdd = async (siloId: number) => {
    const input = await appPrompt(`Сколько цемента внести в силос №${siloId}?`, {
      title: 'Поступление цемента',
      okLabel: 'Внести',
      cancelLabel: 'Отмена',
      variant: 'info',
      placeholder: '0',
      inputMode: 'decimal',
      unit: 'кг',
    });
    if (input === null) return;
    const kg = parseFloat(String(input).replace(',', '.'));
    if (!Number.isFinite(kg) || kg === 0) {
      await appAlert('Введите корректное число кг', { title: 'Ошибка', variant: 'danger' });
      return;
    }

    setBusyId(siloId);
    try {
      const tons = kg / 1000;
      const next = silos.map((s) => {
        if (s.silo_id !== siloId) return s;
        const oldCurrent = s.current;
        const newCurrent = oldCurrent + tons;
        logHistory('add', s.name, Math.abs(kg), oldCurrent * 1000, newCurrent * 1000);
        return { ...s, current: newCurrent };
      });
      await persistSilos(next);
    } finally {
      setBusyId(null);
    }
  };

  const handleReset = async (siloId: number) => {
    if (!(await appConfirm(`Обнулить силос №${siloId}?`, { variant: 'danger', okLabel: 'Обнулить' }))) return;
    setBusyId(siloId);
    try {
      const next = silos.map((s) => {
        if (s.silo_id !== siloId) return s;
        logHistory('reset', s.name, s.current * 1000, s.current * 1000, 0);
        return { ...s, current: 0 };
      });
      await persistSilos(next);
    } finally {
      setBusyId(null);
    }
  };

  /** Admin: списать цемент по сегодняшним рейсам без cement_write_off. */
  const handleCementBackfill = async () => {
    if (activeSiloId == null) {
      await appAlert('Сначала выбери активный силос', {
        title: 'Списание задним числом',
        variant: 'warning',
      });
      return;
    }
    if (backfillBusy) return;

    setBackfillBusy(true);
    try {
      const previewRes = await fetch('/api/adminCifra/warehouse/cement-backfill', {
        headers: adminAuthHeaders(),
        cache: 'no-store',
      });
      const preview = await previewRes.json().catch(() => ({}));
      if (!previewRes.ok) {
        await appAlert(preview.error || 'Не удалось получить список рейсов', {
          title: 'Списание задним числом',
          variant: 'danger',
        });
        return;
      }

      if (!preview.tripCount) {
        await appAlert('Нет сегодняшних рейсов без списания цемента', {
          title: 'Списание задним числом',
          variant: 'info',
        });
        return;
      }

      const dateLabel = String(preview.date || '')
        .split('-')
        .reverse()
        .join('.');
      const confirmed = await appConfirm(
        `Списать цемент с «${preview.siloName}» только за ${dateLabel}?\n\n`
          + `Рейсов: ${preview.tripCount} · Сумма: ${preview.totalKg} кг\n\n`
          + 'Берутся заявки с датой доставки на этот день, статусы «В пути» / «На объекте» / «Разгружен» / «Возврат», '
          + 'у которых списание цемента ещё не записано.\n'
          + 'Рейсы, которые уже списались при «Загружен», повторно не списываются.',
        {
          title: 'Списание задним числом',
          okLabel: 'Списать',
          cancelLabel: 'Отмена',
          variant: 'warning',
        },
      );
      if (!confirmed) return;

      const postRes = await fetch('/api/adminCifra/warehouse/cement-backfill', {
        method: 'POST',
        headers: adminAuthHeaders(),
        body: JSON.stringify({}),
      });
      const result = await postRes.json().catch(() => ({}));
      if (!postRes.ok) {
        await appAlert(result.error || 'Не удалось списать', {
          title: 'Ошибка',
          variant: 'danger',
        });
        return;
      }

      await loadSilos();

      const errNote = Array.isArray(result.errors) && result.errors.length
        ? `\n\nОшибки:\n${result.errors.slice(0, 5).join('\n')}`
        : '';
      await appAlert(
        `Списано: ${result.writtenOff || 0} рейсов, ${result.totalKg || 0} кг\n`
          + `Силос: ${result.siloName || preview.siloName}${errNote}`,
        {
          title: 'Готово',
          variant: result.errors?.length ? 'warning' : 'success',
          okLabel: 'Ок',
        },
      );
    } catch (err) {
      console.error(err);
      await appAlert('Ошибка списания задним числом', {
        title: 'Ошибка',
        variant: 'danger',
      });
    } finally {
      setBackfillBusy(false);
    }
  };

  return (
    <div
      style={{
        ...volumeCardSoftStyle({
          borderRadius: 16,
          padding: '10px 12px',
          height: '100%',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          minWidth: 0,
        }),
        border: highlightMissing
          ? '1px solid rgba(251, 191, 36, 0.65)'
          : CARD_BORDER,
        boxShadow: highlightMissing
          ? '0 0 0 1px rgba(251, 191, 36, 0.2), 0 0 28px rgba(251, 191, 36, 0.18), 0 8px 18px rgba(0,0,0,0.28)'
          : undefined,
        transition: 'border-color 0.25s ease, box-shadow 0.25s ease',
        ...style,
      }}
    >
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        gap: '8px',
        marginBottom: '8px',
        flexShrink: 0,
      }}>
        <div style={{ fontSize: '12px', fontWeight: 700, color: '#E2E8F0', letterSpacing: '0.02em' }}>
          Рабочий силос
        </div>
        {highlightMissing ? (
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#FBBF24', textAlign: 'right' }}>
            Выбери силос — списание при «Загружен»
          </div>
        ) : null}
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
        gap: '8px',
        flex: 1,
        minHeight: 0,
      }}>
        {silos.map((silo) => {
          const active = activeSiloId === silo.silo_id;
          const pct = silo.max > 0 ? Math.min(100, Math.max(0, (silo.current / silo.max) * 100)) : 0;
          const negative = silo.current < 0;
          const low = !negative && pct < 30;
          const stockColor = negative ? '#F87171' : low ? '#FBBF24' : '#34D399';

          return (
            <button
              key={silo.silo_id}
              type="button"
              onClick={() => onActiveSiloChange(silo.silo_id)}
              disabled={busyId === silo.silo_id}
              style={{
                textAlign: 'left',
                cursor: 'pointer',
                borderRadius: 12,
                padding: '8px 9px',
                border: active
                  ? '1px solid rgba(52, 211, 153, 0.55)'
                  : '1px solid rgba(148, 163, 184, 0.22)',
                background: active
                  ? 'linear-gradient(135deg, rgba(16, 185, 129, 0.16) 0%, rgba(15, 23, 42, 0.95) 55%)'
                  : 'rgba(15, 23, 42, 0.55)',
                boxShadow: active ? '0 0 16px rgba(16, 185, 129, 0.12)' : 'none',
                color: '#E2E8F0',
                display: 'flex',
                flexDirection: 'column',
                gap: '5px',
                minWidth: 0,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  aria-hidden
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    border: active ? '2px solid #34D399' : '2px solid #64748B',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {active ? (
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#34D399' }} />
                  ) : null}
                </span>
                <span style={{ fontWeight: 700, fontSize: '12px', whiteSpace: 'nowrap' }}>
                  {silo.name.replace('Силос ', 'С')}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#64748B' }}>
                  /{silo.max}
                </span>
              </div>

              <div style={{
                fontSize: '16px',
                fontWeight: 700,
                color: stockColor,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1.1,
              }}>
                {silo.current.toFixed(2)} т
              </div>

              <div style={{
                height: 4,
                borderRadius: 999,
                background: '#1E2937',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  width: `${negative ? 100 : pct}%`,
                  background: stockColor,
                  transition: 'width 0.35s ease',
                }} />
              </div>

              <div
                style={{ display: 'flex', gap: '4px' }}
                onClick={(e) => e.stopPropagation()}
              >
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => handleAdd(silo.silo_id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(silo.silo_id); }}
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    padding: '4px 4px',
                    borderRadius: 7,
                    background: 'rgba(59, 130, 246, 0.2)',
                    color: '#93C5FD',
                    fontSize: '10.5px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  + Внести
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => handleReset(silo.silo_id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleReset(silo.silo_id); }}
                  style={{
                    flex: 1,
                    textAlign: 'center',
                    padding: '4px 4px',
                    borderRadius: 7,
                    background: 'rgba(100, 116, 139, 0.25)',
                    color: '#CBD5E1',
                    fontSize: '10.5px',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Обнул.
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {isAdmin ? (
        <button
          type="button"
          onClick={() => { void handleCementBackfill(); }}
          disabled={backfillBusy || activeSiloId == null || busyId != null}
          title={activeSiloId == null
            ? 'Сначала выбери активный силос'
            : 'Списать цемент по сегодняшним рейсам без списания'}
          style={{
            marginTop: '8px',
            width: '100%',
            padding: '7px 10px',
            borderRadius: 10,
            border: '1px solid rgba(251, 191, 36, 0.4)',
            background: backfillBusy || activeSiloId == null
              ? 'rgba(251, 191, 36, 0.08)'
              : 'rgba(251, 191, 36, 0.16)',
            color: activeSiloId == null ? '#64748B' : '#FBBF24',
            fontSize: '11.5px',
            fontWeight: 700,
            cursor: backfillBusy || activeSiloId == null ? 'not-allowed' : 'pointer',
            opacity: backfillBusy ? 0.75 : 1,
          }}
        >
          {backfillBusy ? 'Списание…' : 'Списать задним числом'}
        </button>
      ) : null}
    </div>
  );
}
