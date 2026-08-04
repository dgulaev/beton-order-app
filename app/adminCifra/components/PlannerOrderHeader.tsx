'use client';

import type { CSSProperties, DragEvent, ReactNode } from 'react';
import DarkHoverTip from './DarkHoverTip';
import OrderPlanProgressBar from './OrderPlanProgressBar';
import PlannerSwitch from './PlannerSwitch';
import {
  liveShippedVolumeForOrder,
  type LiveTripFact,
  type PlannerOrder,
} from '@/lib/logisticsPlanner';

type Badge = { bg: string; color: string; label: string };

function orderPlanPercent(
  orderVol: number,
  shipped: number,
  manualDone: boolean,
  statusDone: boolean,
): number {
  if (manualDone || statusDone) return 100;
  if (!(orderVol > 0)) return shipped > 0 ? 100 : 0;
  return Math.min(100, Math.round((shipped / orderVol) * 100));
}

type Props = {
  order: PlannerOrder;
  status: 'done' | 'in_work' | 'planned';
  badge: Badge;
  pickup: boolean;
  dayTrips: LiveTripFact[];
  manualDone: boolean;
  canMutatePlan: boolean;
  canEditPlan: boolean;
  applyOnlySelected: boolean;
  canApply: boolean;
  selectedForApply: boolean;
  dragOver: boolean;
  dragHint?: string;
  fs: (n: number) => number;
  sp: (n: number) => number;
  onToggleDone: () => void;
  onToggleApply: () => void;
  onDragOver: (e: DragEvent) => void;
  onDrop: (e: DragEvent) => void;
  onDragLeave: () => void;
};

function cell(extra?: CSSProperties): CSSProperties {
  return {
    minWidth: 0,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    ...extra,
  };
}

/**
 * Шапка заявки дня — фиксированная сетка, чтобы прогресс/м³/время/бейджи
 * не «плыли» из‑за «самовывоз», «Выполнена» и опционального apply-свитча.
 */
export default function PlannerOrderHeader({
  order,
  status,
  badge,
  pickup,
  dayTrips,
  manualDone,
  canMutatePlan,
  canEditPlan,
  applyOnlySelected,
  canApply,
  selectedForApply,
  dragOver,
  dragHint,
  fs,
  sp,
  onToggleDone,
  onToggleApply,
  onDragOver,
  onDrop,
  onDragLeave,
}: Props) {
  const oid = String(order.id);
  const dbSt = String(order.status || '').toLowerCase();
  const showApplyCol = applyOnlySelected && canEditPlan;
  // «Выполнена»/«Отменена» слева уже говорят статус — «отработана» справа не дублируем.
  const showPlanBadge = dbSt !== 'completed' && dbSt !== 'cancelled';
  const shipped = liveShippedVolumeForOrder(order.id, dayTrips);
  const planVol = Number(order.volume) || 0;
  const pct = orderPlanPercent(planVol, shipped, manualDone, status === 'done');

  const gridCols = [
    `${sp(88)}px`, // статус: Выполнена / свитч
    ...(showApplyCol ? [`${sp(28)}px`] : []),
    `${sp(48)}px`, // #id
    `minmax(0, 1.4fr)`, // клиент
    `minmax(${sp(88)}px, 0.9fr)`, // прогресс
    `${sp(52)}px`, // м³
    `${sp(44)}px`, // время
    `minmax(${sp(72)}px, 0.7fr)`, // слот «самовывоз» (всегда)
    ...(showPlanBadge ? [`${sp(84)}px`] : []), // в плане / в работе / отработана
  ].join(' ');

  let statusControl: ReactNode;
  if (dbSt === 'completed' || dbSt === 'cancelled') {
    statusControl = (
      <DarkHoverTip
        tip={
          dbSt === 'cancelled'
            ? 'Заявка отменена — статус здесь не меняется'
            : 'Заявка выполнена — статус здесь не меняется'
        }
        maxWidth={280}
        display="flex"
        style={{ width: '100%', justifyContent: 'flex-start' }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: sp(18),
            padding: `0 ${sp(8)}px`,
            borderRadius: 999,
            fontSize: fs(11),
            fontWeight: 700,
            whiteSpace: 'nowrap',
            color: dbSt === 'cancelled' ? '#FECACA' : '#A7F3D0',
            background:
              dbSt === 'cancelled'
                ? 'rgba(248,113,113,0.2)'
                : 'rgba(16,185,129,0.2)',
            border:
              dbSt === 'cancelled'
                ? '1px solid rgba(248,113,113,0.45)'
                : '1px solid rgba(52,211,153,0.4)',
          }}
        >
          {dbSt === 'cancelled' ? 'Отменена' : 'Выполнена'}
        </span>
      </DarkHoverTip>
    );
  } else {
    statusControl = (
      <PlannerSwitch
        size="sm"
        accent="emerald"
        checked={manualDone || status === 'done'}
        disabled={!canMutatePlan}
        title="Пометить отработанной"
        onChange={onToggleDone}
      />
    );
  }

  return (
    <div
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragLeave={onDragLeave}
      title={dragHint}
      style={{
        display: 'grid',
        gridTemplateColumns: gridCols,
        alignItems: 'center',
        columnGap: sp(8),
        // Лента шапки блока заявки (вариант B): без своей рамки, на всю ширину.
        padding: status === 'done' ? `${sp(7)}px ${sp(12)}px` : `${sp(8)}px ${sp(12)}px`,
        minHeight: status === 'done' ? sp(32) : sp(36),
        borderRadius: 0,
        background:
          status === 'done'
            ? 'linear-gradient(90deg, rgba(16,185,129,0.22) 0%, rgba(15,23,42,0.92) 55%)'
            : status === 'in_work'
              ? 'linear-gradient(90deg, rgba(250,204,21,0.18) 0%, rgba(15,23,42,0.92) 55%)'
              : 'linear-gradient(90deg, rgba(100,116,139,0.22) 0%, rgba(15,23,42,0.92) 55%)',
        border: 'none',
        borderBottom: dragOver
          ? '1px solid rgba(96,165,250,0.75)'
          : '1px solid rgba(148,163,184,0.14)',
        boxShadow: dragOver
          ? 'inset 0 0 0 1px rgba(96,165,250,0.55)'
          : 'inset 0 -1px 0 rgba(0,0,0,0.25)',
        opacity: 1,
        fontSize: fs(13),
        lineHeight: 1.2,
        color: '#E2E8F0',
        outline:
          applyOnlySelected && canApply && selectedForApply
            ? '1px solid rgba(167,139,250,0.55)'
            : undefined,
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,
        boxSizing: 'border-box',
      }}
    >
      <div style={cell()}>{statusControl}</div>

      {showApplyCol ? (
        <div style={cell({ justifyContent: 'center' })}>
          {canApply ? (
            <PlannerSwitch
              size="sm"
              accent="violet"
              checked={selectedForApply}
              title="Включить в «Применить в заявки»"
              onChange={onToggleApply}
            />
          ) : (
            <span aria-hidden style={{ width: sp(18), height: sp(18) }} />
          )}
        </div>
      ) : null}

      <div style={cell({ fontWeight: 700, flexShrink: 0 })}>#{order.id}</div>

      <div
        style={cell({
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          display: 'block',
        })}
        title={order.client}
      >
        {order.client}
      </div>

      <div style={cell()}>
        <OrderPlanProgressBar
          percent={pct}
          shipped={shipped}
          planVol={planVol}
          fs={fs}
          sp={sp}
        />
      </div>

      <div
        style={cell({
          color: '#10B981',
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          justifyContent: 'flex-end',
          whiteSpace: 'nowrap',
        })}
      >
        {order.volume} м³
      </div>

      <div
        style={cell({
          color: '#94A3B8',
          fontVariantNumeric: 'tabular-nums',
          justifyContent: 'center',
          whiteSpace: 'nowrap',
        })}
      >
        {order.deliveryTime}
      </div>

      <div style={cell({ justifyContent: 'flex-end' })}>
        {pickup ? (
          <span
            style={{
              padding: `${sp(2)}px ${sp(8)}px`,
              borderRadius: 999,
              fontSize: fs(12),
              fontWeight: 700,
              background: 'rgba(251,146,60,0.18)',
              color: '#FDBA74',
              whiteSpace: 'nowrap',
            }}
            title="Клиент забирает сам — в плане только соска"
          >
            самовывоз
          </span>
        ) : null}
      </div>

      {showPlanBadge ? (
        <div style={cell({ justifyContent: 'flex-end' })}>
          <span
            style={{
              padding: `${sp(2)}px ${sp(8)}px`,
              borderRadius: 999,
              fontSize: fs(12),
              fontWeight: 700,
              background: badge.bg,
              color: badge.color,
              whiteSpace: 'nowrap',
            }}
          >
            {badge.label}
          </span>
        </div>
      ) : null}
    </div>
  );
}
