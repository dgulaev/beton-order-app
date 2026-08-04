'use client';

import type { CSSProperties, ReactNode } from 'react';
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
  /** Поставить / снять фикс с рейса (клик по бейджу) */
  onSetTripLocked?: (tripId: string, locked: boolean) => void;
};

function deltaColor(d: number | null): string {
  if (d == null) return '#64748B';
  if (d > 5) return '#FBBF24';
  if (d < -5) return '#6EE7B7';
  return '#94A3B8';
}

/** Цвета как на дашборде (строки миксеров) — иначе «В пути» жёлтый путает с «Загрузка». */
function factStatusColor(status: string | null | undefined): string {
  switch (String(status || '')) {
    case 'Загрузка':
      return '#FDE047';
    case 'В пути':
      return '#93C5FD';
    case 'На объекте':
      return '#34D399';
    case 'Разгружен':
      return '#6EE7B7';
    case 'Возврат':
      return '#CBD5E1';
    case 'Проблема':
      return '#F87171';
    default:
      return '#CBD5E1';
  }
}

function cellStyle(extra?: CSSProperties): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
    maxWidth: '100%',
    overflow: 'hidden',
    ...extra,
  };
}

/** Подпись фиксированной ширины + значение — колонки не плывут. */
function Labeled({
  label,
  labelW,
  children,
  valueColor,
  labelColor = '#94A3B8',
  fontWeight,
}: {
  label: string;
  labelW: number;
  children: ReactNode;
  valueColor?: string;
  labelColor?: string;
  fontWeight?: number;
}) {
  return (
    <span
      style={{
        display: 'grid',
        gridTemplateColumns: `${labelW}px minmax(0, 1fr)`,
        alignItems: 'center',
        columnGap: 4,
        width: '100%',
        minWidth: 0,
        color: valueColor,
        fontWeight,
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <span style={{ color: labelColor, fontWeight: 500 }}>{label}</span>
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
      >
        {children}
      </span>
    </span>
  );
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
  onSetTripLocked,
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

  const labelPlanW = sp(30);
  const labelArriveW = sp(44);
  const labelRetW = sp(28);
  const labelFactW = sp(36);

  const indent = sp(16);
  // Отступ слева — padding (не margin): иначе width:100%+margin клипает справа.
  const gridCols = [
    `${sp(14)}px`, // grip
    `minmax(0, 0.9fr)`, // миксер
    `${sp(42)}px`, // объём
    `minmax(0, 0.75fr)`, // план
    `minmax(0, 0.9fr)`, // объект / соска
    `minmax(0, 0.7fr)`, // обр.
    `${sp(78)}px`, // задержка + замок фикса
    `${sp(1)}px`, // разделитель
    `${sp(64)}px`, // ярлык («факт» / «факта нет» — раньше 36px обрезало)
    `minmax(0, 1.15fr)`, // старт + Δ
    `minmax(0, 1.25fr)`, // выпуск + Δ
    `${sp(88)}px`, // статус в конце строки (+ правки времени)
  ].join(' ');

  const baseShadow = dragOver
    ? '0 0 0 2px rgba(96,165,250,0.25), 0 1px 2px rgba(0,0,0,0.28)'
    : waveHighlight
      ? '0 0 0 1px rgba(96,165,250,0.2), inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.28)'
      : 'inset 0 1px 0 rgba(255,255,255,0.05), 0 1px 2px rgba(0,0,0,0.28)';
  // Как у оператора: «без пульта» = янтарная подкова слева, без текстового бейджа.
  const rowShadow = fact.noOperatorRecord
    ? `${baseShadow}, inset 3px 0 0 #F59E0B`
    : baseShadow;

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
        columnGap: sp(4),
        marginLeft: 0,
        padding: `${sp(4)}px ${sp(8)}px ${sp(4)}px ${indent}px`,
        minHeight: controlH + sp(10),
        flexShrink: 0,
        width: '100%',
        maxWidth: '100%',
        boxSizing: 'border-box',
        borderRadius: 8,
        background: isUnloaded
          ? 'rgba(16,185,129,0.1)'
          : trip.locked
            ? 'rgba(96,165,250,0.07)'
            : isPu
              ? 'rgba(251,146,60,0.07)'
              : 'linear-gradient(180deg, rgba(30,41,59,0.72) 0%, rgba(15,23,42,0.88) 100%)',
        border: dragOver
          ? '1px solid rgba(96,165,250,0.85)'
          : waveHighlight
            ? '1px solid rgba(96,165,250,0.55)'
            : fact.noOperatorRecord
              ? '1px solid rgba(245,158,11,0.35)'
              : '1px solid rgba(148,163,184,0.22)',
        boxShadow: rowShadow,
        fontSize: controlFont,
        lineHeight: 1.2,
        color: '#E2E8F0',
        opacity: isUnloaded ? 0.9 : 1,
        overflow: 'hidden',
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
            fact.noOperatorRecord
              ? 'Без пульта оператора: статус выставлен мимо «Загружен» на БСУ — точного времени загрузки нет (жёлтая полоса слева)'
              : isPu
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
          maxWidth={340}
          display="flex"
          style={{ width: '100%', minWidth: 0 }}
        >
          <span
            style={{
              fontWeight: 700,
              color: isPu ? '#FDBA74' : mixerMismatch ? '#FDE047' : undefined,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              width: '100%',
              minWidth: 0,
            }}
          >
            {displayMixer}
          </span>
        </DarkHoverTip>
      </div>

      {/* 3 volume */}
      <div
        style={cellStyle({
          color: '#10B981',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
        })}
      >
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

      {/* 4 plan */}
      <div style={cellStyle({ color: '#FDE047', fontWeight: 600 })}>
        {showShift ? (
          <DarkHoverTip
            tip="Сдвинуть план загрузки — хвост дня пересчитается"
            display="block"
            style={{ width: '100%' }}
          >
            <label
              style={{
                display: 'grid',
                gridTemplateColumns: `${labelPlanW}px minmax(0, 1fr)`,
                alignItems: 'center',
                columnGap: 4,
                width: '100%',
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
                  width: '100%',
                  maxWidth: 44,
                  background: 'rgba(15,23,42,0.9)',
                  color: '#FDE047',
                  border: '1px solid rgba(250,204,21,0.45)',
                }}
              />
            </label>
          </DarkHoverTip>
        ) : (
          <DarkHoverTip tip="План: загрузка на БСУ" display="block" style={{ width: '100%' }}>
            <Labeled label="план" labelW={labelPlanW} valueColor="#FDE047" fontWeight={600}>
              {String(trip.loadTime || '').slice(0, 5) || '—'}
            </Labeled>
          </DarkHoverTip>
        )}
      </div>

      {/* 5 arrive */}
      <div style={cellStyle({ fontSize: controlFont })}>
        {isPu ? (
          <DarkHoverTip tip="План: соска будет готова" display="block" style={{ width: '100%' }}>
            <Labeled label="соска" labelW={labelArriveW} valueColor="#FDBA74">
              {trip.arriveTime || '—'}
            </Labeled>
          </DarkHoverTip>
        ) : (
          <Labeled label="объект" labelW={labelArriveW} valueColor="#93C5FD">
            {trip.arriveTime || '—'}
          </Labeled>
        )}
      </div>

      {/* 6 return */}
      <div style={cellStyle({ fontSize: controlFont, color: muted })}>
        <Labeled label="обр." labelW={labelRetW} valueColor={muted}>
          {isPu ? '—' : trip.returnTime || '—'}
        </Labeled>
      </div>

      {/* 7 delay + фикс */}
      <div
        style={cellStyle({
          gap: sp(4),
          fontSize: controlFont,
          overflow: 'visible',
          justifyContent: 'flex-end',
        })}
      >
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
                flexShrink: 0,
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
          <span style={{ color: '#FCA5A5', fontWeight: 700, flexShrink: 0 }}>
            +{delayVal} мин
          </span>
        ) : null}
        {trip.locked || onSetTripLocked || isUnloaded ? (
          <DarkHoverTip
            tip={
              isUnloaded
                ? 'Отработан: этап и так не пересчитает'
                : trip.locked
                  ? onSetTripLocked
                    ? 'Зафиксирован: этап не пересчитает. Кликни — снять фикс'
                    : 'Зафиксирован: этап не пересчитает'
                  : 'Кликни — зафиксировать рейс (этап не пересчитает)'
            }
            style={{ flexShrink: 0 }}
          >
            <button
              type="button"
              disabled={!onSetTripLocked || busy || isUnloaded}
              onClick={(e) => {
                e.stopPropagation();
                if (isUnloaded) return;
                onSetTripLocked?.(trip.id, !trip.locked);
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 2,
                color:
                  isUnloaded || trip.locked ? '#93C5FD' : '#64748B',
                fontSize: controlFont,
                fontWeight: 700,
                border: 'none',
                background: 'transparent',
                padding: 0,
                cursor:
                  onSetTripLocked && !busy && !isUnloaded
                    ? 'pointer'
                    : 'default',
                opacity: busy ? 0.6 : isUnloaded || trip.locked ? 1 : 0.85,
                flexShrink: 0,
              }}
            >
              <Lock size={fs(11)} />
              {isUnloaded || trip.locked ? <span>фикс</span> : null}
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

      {/* 9 ярлык блока факта — сам статус в конце строки */}
      <div style={cellStyle({ fontSize: controlFont })}>
        {!fact.hasMatch ? (
          <span style={{ color: '#64748B', whiteSpace: 'nowrap' }}>факта нет</span>
        ) : (
          <span style={{ color: '#CBD5E1', fontWeight: 700, whiteSpace: 'nowrap' }}>
            факт
          </span>
        )}
      </div>

      {/* 10 fact start */}
      <div
        style={cellStyle({
          fontSize: controlFont,
          color: muted,
          fontVariantNumeric: 'tabular-nums',
        })}
      >
        {fact.hasMatch ? (
          <Labeled label="старт" labelW={labelFactW} valueColor={muted}>
            <span>
              {fact.factLoadStart ? (
                fact.factLoadStart
              ) : fact.noOperatorRecord ||
                String(trip.id).startsWith('live-orphan-') ? (
                <span style={{ color: '#F59E0B', fontWeight: 700 }}>вручную</span>
              ) : (
                '—'
              )}
              {fact.factLoadStart ? (
                <span
                  style={{
                    display: 'inline-block',
                    marginLeft: 4,
                    color: deltaLoad ? deltaColor(fact.deltaLoadMin) : 'transparent',
                  }}
                >
                  {deltaLoad ? `(${deltaLoad})` : '(+0 мин)'}
                </span>
              ) : null}
            </span>
          </Labeled>
        ) : null}
      </div>

      {/* 11 fact release */}
      <div
        style={cellStyle({
          fontSize: controlFont,
          color: muted,
          fontVariantNumeric: 'tabular-nums',
        })}
      >
        {fact.hasMatch ? (
          <Labeled label="выпуск" labelW={sp(44)} valueColor={muted}>
            <span>
              {fact.factRelease || '—'}
              <span
                style={{
                  marginLeft: 4,
                  color: deltaRel ? deltaColor(fact.deltaReleaseMin) : 'transparent',
                }}
              >
                {deltaRel ? `(${deltaRel})` : '(+0 мин)'}
              </span>
            </span>
          </Labeled>
        ) : null}
      </div>

      {/* 12 статус в конце строки (+ правки для активного рейса) */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          justifyContent: 'center',
          gap: 2,
          minWidth: 0,
          width: '100%',
          overflow: 'hidden',
          fontSize: controlFont,
        }}
      >
        {!fact.hasMatch ? (
          <span style={{ color: '#64748B', fontSize: fs(10) }}>нет в заявке</span>
        ) : !isUnloaded && canEdit ? (
          <>
            <select
              disabled={busy}
              value={fact.factStatus || 'Загрузка'}
              onChange={(e) => void patchStatus(e.target.value)}
              title="Статус рейса"
              style={{
                ...inputBox,
                background: 'rgba(15,23,42,0.9)',
                color: factStatusColor(fact.factStatus),
                border: '1px solid rgba(71,85,105,0.9)',
                width: '100%',
                fontWeight: 700,
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
                width: '100%',
                background: 'rgba(15,23,42,0.9)',
                color: '#FDE047',
                border: '1px solid rgba(71,85,105,0.9)',
              }}
            />
          </>
        ) : (
          <span
            title={fact.factStatus || 'Статус рейса'}
            style={{
              color: factStatusColor(fact.factStatus),
              fontWeight: 700,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textAlign: 'right',
            }}
          >
            {fact.factStatus || '—'}
          </span>
        )}
      </div>
    </div>
  );
}
