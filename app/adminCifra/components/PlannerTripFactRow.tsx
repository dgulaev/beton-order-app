'use client';

import type { CSSProperties } from 'react';
import { GripVertical, Lock } from 'lucide-react';
import { appAlert } from './appDialog';
import DarkHoverTip from './DarkHoverTip';
import {
  PICKUP_MIXER_NUMBER,
  type PlannedTrip,
} from '@/lib/logisticsPlanner';
import {
  formatFactDeltaLabel,
  mixerPlatesEqual,
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
  /** Снять фикс с рейса (клик по бейджу) */
  onUnlockTrip?: (tripId: string) => void;
};

function deltaColor(d: number | null): string {
  if (d == null) return '#64748B';
  if (d > 5) return '#FBBF24';
  if (d < -5) return '#6EE7B7';
  return '#94A3B8';
}

function cellStyle(extra?: CSSProperties): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
    overflow: 'hidden',
    ...extra,
  };
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
  onUnlockTrip,
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
  const liveMixer = fact.factMixerNumber || null;
  const mixerMismatch =
    Boolean(liveMixer) &&
    !isPu &&
    !mixerPlatesEqual(trip.mixerNumber, liveMixer);
  const displayMixer = isPu
    ? PICKUP_MIXER_NUMBER
    : liveMixer && canEdit
      ? liveMixer
      : trip.mixerNumber;

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

  const deltaLoad = formatFactDeltaLabel(fact.deltaLoadMin);
  const deltaRel = formatFactDeltaLabel(fact.deltaReleaseMin);
  const showTime = fact.factPlanTime || '—';
  const showVol =
    fact.factVolume != null ? String(fact.factVolume) : String(trip.volume);

  const inputPad = `0 ${sp(3)}px`;
  const controlFont = fs(11);
  const controlH = Math.max(18, sp(18));
  const muted = '#94A3B8';
  const inputBox: CSSProperties = {
    height: controlH,
    boxSizing: 'border-box',
    lineHeight: `${controlH - 2}px`,
    padding: inputPad,
    fontSize: controlFont,
    borderRadius: 5,
  };

  // Фиксированные колонки — и отработанные, и активные в одной сетке.
  const gridCols = [
    `${sp(18)}px`, // grip (всегда, чтобы не съезжало)
    `${sp(88)}px`, // миксер
    `${sp(56)}px`, // объём
    `${sp(112)}px`, // план загр.
    `${sp(88)}px`, // объект / соска
    `${sp(72)}px`, // обр.
    `${sp(108)}px`, // задержка + фикс
    `${sp(8)}px`, // разделитель
    `minmax(${sp(280)}px, 1.6fr)`, // факт (ярлык + старт + выпуск)
    `minmax(${sp(176)}px, max-content)`, // статус / действия («отработан» + время + м³)
  ].join(' ');

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
        display: 'grid',
        gridTemplateColumns: gridCols,
        alignItems: 'center',
        columnGap: sp(5),
        marginLeft: sp(28),
        padding: `${sp(1)}px ${sp(6)}px`,
        minHeight: controlH + sp(4),
        height: 'auto',
        borderRadius: 6,
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
        fontSize: controlFont,
        lineHeight: 1.15,
        color: '#E2E8F0',
        opacity: isUnloaded ? 0.82 : 1,
        overflowX: 'auto',
        overflowY: 'visible',
        cursor: allowDrag ? 'grab' : undefined,
      }}
    >
      {/* 1 grip */}
      <div style={cellStyle({ justifyContent: 'center' })}>
        {allowDrag ? (
          <DarkHoverTip tip="Перетащить: отпусти на строку — встанет после неё (или в другую заявку)">
            <span style={{ display: 'inline-flex', color: '#64748B' }}>
              <GripVertical size={14} strokeWidth={2} />
            </span>
          </DarkHoverTip>
        ) : (
          <span style={{ width: 14 }} />
        )}
      </div>

      {/* 2 mixer */}
      <div style={cellStyle()}>
        <DarkHoverTip
          tip={
            isPu
              ? 'Самовывоз: слот на соске'
              : mixerMismatch
                ? `В заявке: ${liveMixer} (в плане было ${trip.mixerNumber}) — подтягиваем live`
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
          <span
            style={{
              fontWeight: 700,
              color: mixerMismatch ? '#FDE047' : undefined,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              width: '100%',
            }}
          >
            {displayMixer}
          </span>
        </DarkHoverTip>
      </div>

      {/* 3 volume */}
      <div style={cellStyle({ color: '#10B981', fontWeight: 700 })}>
        {showPlanVolume ? (
          <DarkHoverTip tip="Объём в плане. Правка пересчитает хвост. Если диспетчер меняет объём в заявке вручную — план подтянет его сам. Обратно в заявку — через «Применить в заявки».">
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                color: '#10B981',
                fontWeight: 700,
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
                  ...inputBox,
                  width: 34,
                  background: 'rgba(15,23,42,0.9)',
                  color: '#6EE7B7',
                  border: '1px solid rgba(16,185,129,0.45)',
                  fontWeight: 700,
                }}
              />
              м³
            </label>
          </DarkHoverTip>
        ) : (
          <span style={{ whiteSpace: 'nowrap' }}>{trip.volume} м³</span>
        )}
      </div>

      {/* 4 plan load */}
      <div style={cellStyle({ color: '#FDE047', fontWeight: 600 })}>
        {showShift ? (
          <DarkHoverTip tip="Сдвинуть план загрузки — хвост дня пересчитается">
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 3,
                color: '#FDE047',
                fontWeight: 600,
                fontSize: controlFont,
              }}
            >
              <span style={{ color: muted, fontWeight: 500 }}>план</span>
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
                  ...inputBox,
                  width: 44,
                  background: 'rgba(15,23,42,0.9)',
                  color: '#FDE047',
                  border: '1px solid rgba(250,204,21,0.45)',
                }}
              />
            </label>
          </DarkHoverTip>
        ) : (
          <DarkHoverTip tip="План: загрузка на БСУ">
            <span style={{ whiteSpace: 'nowrap', fontSize: controlFont }}>
              <span style={{ color: muted, fontWeight: 500 }}>план </span>
              {String(trip.loadTime || '').slice(0, 5) || '—'}
            </span>
          </DarkHoverTip>
        )}
      </div>

      {/* 5 arrive */}
      <div style={cellStyle({ fontSize: controlFont })}>
        {isPu ? (
          <DarkHoverTip tip="План: соска будет готова">
            <span style={{ color: '#FDBA74', whiteSpace: 'nowrap' }}>
              <span style={{ color: muted }}>соска </span>
              {trip.arriveTime}
            </span>
          </DarkHoverTip>
        ) : (
          <span style={{ color: '#93C5FD', whiteSpace: 'nowrap' }}>
            <span style={{ color: muted }}>объект </span>
            {trip.arriveTime}
          </span>
        )}
      </div>

      {/* 6 return */}
      <div style={cellStyle({ fontSize: controlFont, color: muted })}>
        {isPu ? (
          <span>—</span>
        ) : (
          <span style={{ whiteSpace: 'nowrap' }}>
            обр. {trip.returnTime}
          </span>
        )}
      </div>

      {/* 7 delay + фикс */}
      <div style={cellStyle({ gap: sp(6), fontSize: controlFont })}>
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
                color: delayVal > 0 ? '#FCA5A5' : muted,
                fontWeight: 600,
              }}
            >
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
                  ...inputBox,
                  width: 34,
                  background: 'rgba(15,23,42,0.9)',
                  color: delayVal > 0 ? '#FCA5A5' : '#E2E8F0',
                  border: `1px solid ${
                    delayVal > 0
                      ? 'rgba(248,113,113,0.55)'
                      : 'rgba(71,85,105,0.9)'
                  }`,
                }}
              />
              мин
            </label>
          </DarkHoverTip>
        ) : delayVal > 0 ? (
          <span style={{ color: '#FCA5A5', fontWeight: 700 }}>+{delayVal} мин</span>
        ) : (
          <span style={{ color: 'transparent' }}>·</span>
        )}
        {trip.locked && !isUnloaded ? (
          <DarkHoverTip
            tip={
              onUnlockTrip
                ? 'Зафиксирован: этап не пересчитает. Кликни — снять фикс'
                : 'Зафиксирован: этап не пересчитает'
            }
          >
            <button
              type="button"
              disabled={!onUnlockTrip || busy}
              onClick={(e) => {
                e.stopPropagation();
                onUnlockTrip?.(trip.id);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                color: '#93C5FD',
                fontSize: controlFont,
                fontWeight: 700,
                border: 'none',
                background: 'transparent',
                padding: 0,
                cursor: onUnlockTrip && !busy ? 'pointer' : 'default',
                opacity: busy ? 0.6 : 1,
              }}
            >
              <Lock size={fs(11)} /> фикс
            </button>
          </DarkHoverTip>
        ) : null}
      </div>

      {/* 8 divider */}
      <div
        style={{
          width: 1,
          justifySelf: 'center',
          alignSelf: 'stretch',
          background: 'rgba(148,163,184,0.22)',
        }}
      />

      {/* 9 fact — внутри тоже сетка: ярлык | старт+Δ | выпуск+Δ */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: !fact.hasMatch
            ? '1fr'
            : `${sp(52)}px ${sp(118)}px ${sp(118)}px auto`,
          alignItems: 'center',
          columnGap: sp(8),
          fontSize: controlFont,
          minWidth: 0,
          width: '100%',
        }}
      >
        {!fact.hasMatch ? (
          <span style={{ color: '#64748B' }}>факта нет</span>
        ) : (
          <>
            <span
              style={{
                color: '#CBD5E1',
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {!isUnloaded && fact.factStatus ? fact.factStatus : 'факт'}
            </span>
            <span
              style={{
                color: muted,
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              старт {fact.factLoadStart || '—'}
              <span
                style={{
                  display: 'inline-block',
                  minWidth: sp(62),
                  marginLeft: 4,
                  color: deltaLoad ? deltaColor(fact.deltaLoadMin) : 'transparent',
                }}
              >
                {deltaLoad ? `(${deltaLoad})` : '(+0 мин)'}
              </span>
            </span>
            <span
              style={{
                color: muted,
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              выпуск {fact.factRelease || '—'}
              <span
                style={{
                  display: 'inline-block',
                  minWidth: sp(62),
                  marginLeft: 4,
                  color: deltaRel ? deltaColor(fact.deltaReleaseMin) : 'transparent',
                }}
              >
                {deltaRel ? `(${deltaRel})` : '(+0 мин)'}
              </span>
            </span>
            {fact.noOperatorRecord ? (
              <span
                style={{
                  padding: '0 6px',
                  borderRadius: 999,
                  background: 'rgba(248,113,113,0.15)',
                  color: '#FCA5A5',
                  fontWeight: 700,
                  fontSize: fs(10),
                  justifySelf: 'start',
                }}
              >
                без пульта
              </span>
            ) : (
              <span />
            )}
          </>
        )}
      </div>

      {/* 10 actions */}
      <div
        style={cellStyle({
          justifyContent: 'flex-end',
          gap: sp(6),
          fontSize: controlFont,
          // иначе flex-end + overflow:hidden обрезает начало «отработан»
          overflow: 'visible',
          minWidth: 'max-content',
        })}
      >
        {isUnloaded && fact.hasMatch ? (
          <>
            <span
              style={{
                padding: `0 ${sp(5)}px`,
                borderRadius: 999,
                background: 'rgba(16,185,129,0.18)',
                color: '#6EE7B7',
                fontWeight: 700,
                fontSize: fs(10),
                lineHeight: `${controlH}px`,
                height: controlH,
                display: 'inline-flex',
                alignItems: 'center',
                flexShrink: 0,
                whiteSpace: 'nowrap',
              }}
            >
              отработан
            </span>
            <span style={{ color: '#FDE047', fontWeight: 600, minWidth: sp(40) }}>
              {showTime}
            </span>
            <span style={{ color: '#6EE7B7', fontWeight: 600, minWidth: sp(44) }}>
              {showVol} м³
            </span>
          </>
        ) : canEdit ? (
          <>
            <select
              disabled={busy}
              value={fact.factStatus || 'Загрузка'}
              onChange={(e) => void patchStatus(e.target.value)}
              style={{
                ...inputBox,
                background: 'rgba(15,23,42,0.9)',
                color: '#E2E8F0',
                border: '1px solid rgba(71,85,105,0.9)',
                width: sp(92),
                flexShrink: 0,
              }}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
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
                ...inputBox,
                width: 44,
                background: 'rgba(15,23,42,0.9)',
                color: '#FDE047',
                border: '1px solid rgba(71,85,105,0.9)',
                flexShrink: 0,
              }}
            />
          </>
        ) : (
          <span style={{ color: '#64748B', fontSize: fs(10) }}>нет в заявке</span>
        )}
      </div>
    </div>
  );
}
