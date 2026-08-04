'use client';

import DarkHoverTip from './DarkHoverTip';

/**
 * Компактный прогресс выполнения плана по заявке (отгружено / план м³).
 */
export default function OrderPlanProgressBar({
  percent,
  shipped,
  planVol,
  fs,
  sp,
}: {
  percent: number;
  shipped: number;
  planVol: number;
  fs: (n: number) => number;
  sp: (n: number) => number;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const fill =
    pct >= 100 ? '#34D399' : pct > 0 ? '#FBBF24' : '#64748B';
  const trackBg = 'rgba(15,23,42,0.85)';
  const fmt = (n: number) => {
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  };

  return (
    <DarkHoverTip tip={`Отгружено ${fmt(shipped)} из ${fmt(planVol)} м³ (${pct}%)`}>
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: sp(6),
        flexShrink: 0,
        width: '100%',
        minWidth: 0,
      }}
    >
      <div
        style={{
          flex: 1,
          height: Math.max(5, sp(5)),
          borderRadius: 999,
          background: trackBg,
          border: '1px solid rgba(148,163,184,0.28)',
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.35)',
          overflow: 'hidden',
          minWidth: fs(52),
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 999,
            background: `linear-gradient(90deg, ${fill}CC 0%, ${fill} 100%)`,
            boxShadow: `0 0 8px ${fill}55`,
            transition: 'width 0.25s ease',
          }}
        />
      </div>
      <span
        style={{
          fontSize: fs(12),
          fontWeight: 800,
          color: fill,
          fontVariantNumeric: 'tabular-nums',
          minWidth: fs(32),
          textAlign: 'right',
        }}
      >
        {pct}%
      </span>
    </div>
    </DarkHoverTip>
  );
}
