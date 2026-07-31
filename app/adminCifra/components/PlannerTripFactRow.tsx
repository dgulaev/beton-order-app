'use client';

import { GripVertical, Lock } from 'lucide-react';
import { appAlert } from './appDialog';
import DarkHoverTip from './DarkHoverTip';
import {
  PICKUP_MIXER_NUMBER,
  type PlannedTrip,
} from '@/lib/logisticsPlanner';
import {
  formatFactDeltaLabel,
  type PlanTripFact,
} from '@/lib/plannerFactMatch';

const STATUS_OPTIONS = [
  'Загрузка',
  'В пути',
  'На объекте',
  'Разгружен',
  'Возврат',
  'Проблема',
] as const;

type Props = {
  trip: PlannedTrip;
  fact: PlanTripFact;
  fs: (n: number) => number;
  sp: (n: number) => number;
  busy?: boolean;
  onPatched?: () => void;
  /** Фаза 4: можно сдвинуть плановое время загрузки → пересчёт хвоста */
  canShiftPlan?: boolean;
  onShiftLoadTime?: (tripId: string, loadHhMm: string) => void;
  /** Задержка диспетчера (+N мин разгрузки) → пересчёт хвоста */
  onTripDelayMin?: (tripId: string, delayMin: number) => void;
  /** Правка планового объёма → пересчёт хвоста и вместимости миксера */
  onPlanVolumeChange?: (tripId: string, volume: number) => void;
  /** Drag-and-drop рейса */
  canDrag?: boolean;
  dragOver?: boolean;
  onDragStartTrip?: (tripId: string) => void;
  onDragOverTrip?: (tripId: string) => void;
  onDropOnTrip?: (tripId: string) => void;
  onDragEndTrip?: () => void;
  /** Подсветка активной волны пересчёта */
  waveHighlight?: boolean;
};

function deltaColor(d: number | null): string {
  if (d == null) return '#64748B';
  if (d > 5) return '#FBBF24';
  if (d < -5) return '#6EE7B7';
  return '#94A3B8';
}

export default function PlannerTripFactRow({
  trip,
  fact,
  fs,
  sp,
  busy,
  onPatched,
  canShiftPlan,
  onShiftLoadTime,
  onTripDelayMin,
  onPlanVolumeChange,
  canDrag,
  dragOver,
  onDragStartTrip,
  onDragOverTrip,
  onDropOnTrip,
  onDragEndTrip,
  waveHighlight,
}: Props) {
  const isPu = Boolean(trip.pickup || trip.mixerNumber === PICKUP_MIXER_NUMBER);
  const canEdit = Boolean(fact.matchedTripId);
  const isUnloaded = fact.factStatus === 'Разгружен' || Boolean(trip.done);
  const showShift =
    Boolean(canShiftPlan && onShiftLoadTime) && !isUnloaded && !trip.done;
  const showDelay =
    Boolean(canShiftPlan && onTripDelayMin) && !isUnloaded && !trip.done && !isPu;
  const showPlanVolume =
    Boolean(canShiftPlan && onPlanVolumeChange) && !isUnloaded && !trip.done && !isPu;
  const allowDrag = Boolean(canDrag) && !isUnloaded && !trip.done && !isPu;
  const delayVal = Math.max(0, Math.round(Number(trip.delayMin) || 0));

  const headers = (): Record<string, string> => {
    const userId =
      typeof window !== 'undefined' ? localStorage.getItem('userId') : null;
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (userId) h['x-user-id'] = userId;
    return h;
  };

  const actor = () => {
    const userName =
      typeof window !== 'undefined' ? localStorage.getItem('userName') : null;
    const userRole =
      typeof window !== 'undefined' ? localStorage.getItem('userRole') : null;
    return {
      userName: userName || 'Диспетчер',
      userRole: userRole || undefined,
    };
  };

  const patchStatus = async (status: string) => {
    if (!fact.matchedTripId || !fact.factStatus || status === fact.factStatus) return;
    try {
      const res = await fetch('/api/adminCifra/order-mixers/status', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          id: fact.matchedTripId,
          status,
          expectedStatus: fact.factStatus,
          ...actor(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        await appAlert(data.message || data.error || 'Не удалось сменить статус', {
          title: 'Статус рейса',
          variant: 'danger',
        });
        return;
      }
      onPatched?.();
    } catch {
      await appAlert('Сеть недоступна', { title: 'Ошибка', variant: 'danger' });
    }
  };

  const patchTime = async (raw: string) => {
    if (!fact.matchedTripId) return;
    const time = raw.trim().slice(0, 5);
    if (!/^\d{1,2}:\d{2}$/.test(time)) return;
    if (time === fact.factPlanTime) return;
    try {
      const res = await fetch('/api/adminCifra/order-mixers/time', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ id: fact.matchedTripId, time }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        await appAlert(data.message || data.error || 'Не удалось сменить время', {
          title: 'Время рейса',
          variant: 'danger',
        });
        return;
      }
      onPatched?.();
    } catch {
      await appAlert('Сеть недоступна', { title: 'Ошибка', variant: 'danger' });
    }
  };

  const patchVolume = async (raw: string) => {
    if (!fact.matchedTripId) return;
    const volume = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(volume) || volume <= 0) return;
    if (fact.factVolume != null && Math.abs(volume - fact.factVolume) < 0.05) return;
    try {
      const res = await fetch('/api/adminCifra/order-mixers/volume', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          id: fact.matchedTripId,
          volume,
          ...actor(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.success === false) {
        await appAlert(data.message || data.error || 'Не удалось сменить объём', {
          title: 'Объём рейса',
          variant: 'danger',
        });
        return;
      }
      onPatched?.();
    } catch {
      await appAlert('Сеть недоступна', { title: 'Ошибка', variant: 'danger' });
    }
  };

  const deltaLoad = formatFactDeltaLabel(fact.deltaLoadMin);
  const deltaRel = formatFactDeltaLabel(fact.deltaReleaseMin);
  const showTime = fact.factPlanTime || '—';
  const showVol =
    fact.factVolume != null ? String(fact.factVolume) : String(trip.volume);

  const inputPad = `${Math.max(1, sp(1))}px ${sp(4)}px`;
  const controlFont = fs(11);

  return (
    <div
      draggable={allowDrag}
      onDragStart={(e) => {
        if (!allowDrag) return;
        e.dataTransfer.setData('text/plain', trip.id);
        e.dataTransfer.effectAllowed = 'move';
        onDragStartTrip?.(trip.id);
      }}
      onDragOver={(e) => {
        if (!allowDrag && !canShiftPlan) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        onDragOverTrip?.(trip.id);
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDropOnTrip?.(trip.id);
      }}
      onDragEnd={() => onDragEndTrip?.()}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: sp(8),
        flexWrap: 'nowrap',
        whiteSpace: 'nowrap',
        marginLeft: sp(28),
        padding: isUnloaded ? `${sp(2)}px ${sp(8)}px` : `${sp(3)}px ${sp(8)}px`,
        minHeight: isUnloaded ? sp(24) : sp(28),
        borderRadius: 8,
        background: isUnloaded
          ? 'rgba(16,185,129,0.07)'
          : trip.locked
            ? 'rgba(96,165,250,0.07)'
            : isPu
              ? 'rgba(251,146,60,0.07)'
              : 'linear-gradient(180deg, rgba(30,41,59,0.72) 0%, rgba(15,23,42,0.88) 100%)',
        border: dragOver
          ? '1px solid rgba(96,165,250,0.85)'
          : waveHighlight
            ? '1px solid rgba(96,165,250,0.55)'
            : '1px solid rgba(148,163,184,0.22)',
        boxShadow: dragOver
          ? '0 0 0 2px rgba(96,165,250,0.25), 0 1px 2px rgba(0,0,0,0.28)'
          : waveHighlight
            ? '0 0 0 1px rgba(96,165,250,0.2), inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.28)'
            : 'inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.28)',
        fontSize: fs(12),
        lineHeight: 1.2,
        color: '#E2E8F0',
        opacity: isUnloaded ? 0.78 : 1,
        overflowX: 'auto',
        cursor: allowDrag ? 'grab' : undefined,
      }}
    >
      {allowDrag ? (
        <DarkHoverTip tip="Перетащить рейс (внутри заявки или в другую)">
          <span
            style={{
              display: 'inline-flex',
              color: '#64748B',
              flexShrink: 0,
              marginLeft: -4,
            }}
          >
            <GripVertical size={14} strokeWidth={2} />
          </span>
        </DarkHoverTip>
      ) : null}
      <DarkHoverTip
        tip={
          isPu
            ? 'Самовывоз: слот на соске'
            : isUnloaded
              ? 'Рейс отработан'
              : trip.locked
                ? 'Зафиксирован: этап не пересчитает'
                : canEdit
                  ? 'Есть факт по рейсу — можно править статус, время и объём'
                  : 'Нет связи с рейсом в заявке — запиши план в заявки или сверь номера миксеров'
        }
        maxWidth={320}
      >
        <span style={{ fontWeight: 700, minWidth: sp(68), flexShrink: 0 }}>
          {isPu ? PICKUP_MIXER_NUMBER : trip.mixerNumber}
        </span>
      </DarkHoverTip>
      {showPlanVolume ? (
        <DarkHoverTip tip="Плановый объём рейса — при правке хвост дня и вместимость миксера пересчитаются">
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            color: '#10B981',
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          <input
            type="text"
            disabled={busy}
            defaultValue={String(trip.volume)}
            key={`pvol-${trip.id}-${trip.volume}`}
            onBlur={(e) => {
              const raw = e.target.value.trim().replace(',', '.');
              const n = Number(raw);
              if (!Number.isFinite(n) || n <= 0) {
                e.target.value = String(trip.volume);
                return;
              }
              const next = Math.round(n * 10) / 10;
              if (Math.abs(next - Number(trip.volume)) < 0.05) return;
              onPlanVolumeChange?.(trip.id, next);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            style={{
              width: 40,
              background: 'rgba(15,23,42,0.9)',
              color: '#6EE7B7',
              border: '1px solid rgba(16,185,129,0.45)',
              borderRadius: 6,
              fontSize: controlFont,
              padding: inputPad,
              fontWeight: 700,
            }}
          />
          м³
        </label>
        </DarkHoverTip>
      ) : (
        <span style={{ color: '#10B981', fontWeight: 700, flexShrink: 0 }}>
          {trip.volume} м³
        </span>
      )}
      {showShift ? (
        <DarkHoverTip tip="Сдвинуть план загрузки — хвост дня пересчитается">
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            color: '#FDE047',
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          план загр.
          <input
            type="text"
            disabled={busy}
            defaultValue={String(trip.loadTime || '').slice(0, 5)}
            key={`shift-${trip.id}-${trip.loadTime}`}
            onBlur={(e) => {
              const v = e.target.value.trim().slice(0, 5);
              if (!/^\d{1,2}:\d{2}$/.test(v)) return;
              if (v === String(trip.loadTime || '').slice(0, 5)) return;
              onShiftLoadTime?.(trip.id, v);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            style={{
              width: 48,
              background: 'rgba(15,23,42,0.9)',
              color: '#FDE047',
              border: '1px solid rgba(250,204,21,0.45)',
              borderRadius: 6,
              fontSize: controlFont,
              padding: inputPad,
            }}
          />
        </label>
        </DarkHoverTip>
      ) : (
        <DarkHoverTip tip="План: загрузка на БСУ">
          <span style={{ color: '#FDE047', flexShrink: 0 }}>
            план загр. {trip.loadTime}
          </span>
        </DarkHoverTip>
      )}
      {isPu ? (
        <DarkHoverTip tip="План: соска будет готова">
          <span style={{ color: '#FDBA74', flexShrink: 0 }}>
            соска {trip.arriveTime}
          </span>
        </DarkHoverTip>
      ) : (
        <>
          <span style={{ color: '#93C5FD', flexShrink: 0 }}>
            объект {trip.arriveTime}
          </span>
          <span style={{ color: '#94A3B8', flexShrink: 0 }}>
            обр. {trip.returnTime}
          </span>
        </>
      )}
      {showDelay ? (
        <DarkHoverTip
          tip="Задержка на объекте (мин). Пример: разгрузят 60 мин вместо 30 → поставь 30. Хвост дня пересчитается."
          maxWidth={340}
        >
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            color: delayVal > 0 ? '#FCA5A5' : '#94A3B8',
            fontWeight: 600,
            fontSize: controlFont,
            flexShrink: 0,
          }}
        >
          задержка
          <input
            type="number"
            min={0}
            max={240}
            step={5}
            disabled={busy}
            defaultValue={delayVal || ''}
            key={`delay-${trip.id}-${delayVal}`}
            placeholder="0"
            onBlur={(e) => {
              const raw = e.target.value.trim();
              const n = raw === '' ? 0 : Math.round(Number(raw));
              if (!Number.isFinite(n) || n < 0) return;
              const clamped = Math.min(240, n);
              if (clamped === delayVal) return;
              onTripDelayMin?.(trip.id, clamped);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
            }}
            style={{
              width: 42,
              background: 'rgba(15,23,42,0.9)',
              color: delayVal > 0 ? '#FCA5A5' : '#E2E8F0',
              border: `1px solid ${
                delayVal > 0
                  ? 'rgba(248,113,113,0.55)'
                  : 'rgba(71,85,105,0.9)'
              }`,
              borderRadius: 6,
              fontSize: controlFont,
              padding: inputPad,
            }}
          />
          <span style={{ fontWeight: 500 }}>мин</span>
        </label>
        </DarkHoverTip>
      ) : delayVal > 0 ? (
        <DarkHoverTip tip="Задержка диспетчера на разгрузке">
          <span
            style={{
              color: '#FCA5A5',
              fontWeight: 700,
              fontSize: controlFont,
              flexShrink: 0,
            }}
          >
            +{delayVal} мин
          </span>
        </DarkHoverTip>
      ) : null}
      {trip.locked && !isUnloaded ? (
        <DarkHoverTip tip="Зафиксирован: этап не пересчитает">
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              color: '#93C5FD',
              fontSize: controlFont,
              fontWeight: 700,
              flexShrink: 0,
            }}
          >
            <Lock size={fs(11)} /> фикс
          </span>
        </DarkHoverTip>
      ) : null}

      <span
        style={{
          width: 1,
          alignSelf: 'stretch',
          background: 'rgba(148,163,184,0.18)',
          flexShrink: 0,
          margin: `0 ${sp(2)}px`,
        }}
      />

      {!fact.hasMatch ? (
        <DarkHoverTip tip="В заявке нет подходящего рейса под этот слот плана">
          <span
            style={{ color: '#64748B', fontSize: controlFont, flexShrink: 0 }}
          >
            факта нет
          </span>
        </DarkHoverTip>
      ) : (
        <>
          <span
            style={{
              color: '#CBD5E1',
              fontWeight: 700,
              fontSize: controlFont,
              flexShrink: 0,
            }}
          >
            факт
            {!isUnloaded && fact.factStatus ? ` · ${fact.factStatus}` : ''}
          </span>
          {fact.factLoadStart ? (
            <DarkHoverTip tip="Старт загрузки на пульте">
              <span
                style={{ fontSize: controlFont, color: '#94A3B8', flexShrink: 0 }}
              >
                старт {fact.factLoadStart}
                {deltaLoad ? (
                  <span style={{ color: deltaColor(fact.deltaLoadMin), marginLeft: 3 }}>
                    ({deltaLoad})
                  </span>
                ) : null}
              </span>
            </DarkHoverTip>
          ) : null}
          {fact.factRelease ? (
            <DarkHoverTip tip="Выпуск с завода (лог оператора)">
              <span
                style={{ fontSize: controlFont, color: '#94A3B8', flexShrink: 0 }}
              >
                выпуск {fact.factRelease}
                {deltaRel ? (
                  <span style={{ color: deltaColor(fact.deltaReleaseMin), marginLeft: 3 }}>
                    ({deltaRel})
                  </span>
                ) : null}
              </span>
            </DarkHoverTip>
          ) : null}
          {fact.noOperatorRecord ? (
            <DarkHoverTip tip="Статус без записи оператора на пульте">
              <span
                style={{
                  padding: '0 6px',
                  borderRadius: 999,
                  background: 'rgba(248,113,113,0.15)',
                  color: '#FCA5A5',
                  fontWeight: 700,
                  fontSize: fs(10),
                  flexShrink: 0,
                }}
              >
                без пульта
              </span>
            </DarkHoverTip>
          ) : null}
        </>
      )}

      <span
        style={{
          marginLeft: 'auto',
          display: 'inline-flex',
          alignItems: 'center',
          gap: sp(6),
          flexWrap: 'nowrap',
          flexShrink: 0,
        }}
      >
        {isUnloaded && fact.hasMatch ? (
          <>
            <span
              style={{
                padding: `0 ${sp(6)}px`,
                borderRadius: 999,
                background: 'rgba(16,185,129,0.18)',
                color: '#6EE7B7',
                fontWeight: 700,
                fontSize: fs(10),
              }}
            >
              отработан
            </span>
            <DarkHoverTip tip="Время загрузки">
              <span style={{ color: '#FDE047', fontWeight: 600 }}>
                {showTime}
              </span>
            </DarkHoverTip>
            <DarkHoverTip tip="Объём рейса">
              <span style={{ color: '#6EE7B7', fontWeight: 600 }}>
                {showVol} м³
              </span>
            </DarkHoverTip>
          </>
        ) : canEdit ? (
          <>
            <DarkHoverTip tip="Статус рейса">
              <select
                disabled={busy}
                value={fact.factStatus || 'Загрузка'}
                onChange={(e) => void patchStatus(e.target.value)}
                style={{
                  background: 'rgba(15,23,42,0.9)',
                  color: '#E2E8F0',
                  border: '1px solid rgba(71,85,105,0.9)',
                  borderRadius: 6,
                  fontSize: controlFont,
                  padding: inputPad,
                  maxWidth: 118,
                }}
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </DarkHoverTip>
            <DarkHoverTip tip="Время загрузки рейса">
              <input
                type="text"
                disabled={busy}
                defaultValue={fact.factPlanTime || ''}
                key={`t-${fact.matchedTripId}-${fact.factPlanTime}`}
                onBlur={(e) => void patchTime(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                placeholder="ЧЧ:ММ"
                style={{
                  width: 52,
                  background: 'rgba(15,23,42,0.9)',
                  color: '#FDE047',
                  border: '1px solid rgba(71,85,105,0.9)',
                  borderRadius: 6,
                  fontSize: controlFont,
                  padding: inputPad,
                }}
              />
            </DarkHoverTip>
            <DarkHoverTip tip="Объём рейса">
              <input
                type="text"
                disabled={busy}
                defaultValue={
                  fact.factVolume != null ? String(fact.factVolume) : ''
                }
                key={`v-${fact.matchedTripId}-${fact.factVolume}`}
                onBlur={(e) => void patchVolume(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
                placeholder="м³"
                style={{
                  width: 42,
                  background: 'rgba(15,23,42,0.9)',
                  color: '#6EE7B7',
                  border: '1px solid rgba(71,85,105,0.9)',
                  borderRadius: 6,
                  fontSize: controlFont,
                  padding: inputPad,
                }}
              />
            </DarkHoverTip>
          </>
        ) : (
          <DarkHoverTip
            tip="Нет связи с рейсом в заявке — запиши план в заявки или сверь номера миксеров"
            maxWidth={320}
          >
            <span style={{ color: '#64748B', fontSize: fs(10) }}>
              нет в заявке
            </span>
          </DarkHoverTip>
        )}
      </span>
    </div>
  );
}
