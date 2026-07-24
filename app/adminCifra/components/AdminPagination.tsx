'use client';

import type { CSSProperties, ReactNode } from 'react';
import { CARD_BORDER, CARD_GRADIENT_SOFT, CARD_VOLUME_SOFT } from '../cardStyles';

type AdminPaginationProps = {
  page: number;
  totalPages: number;
  onPage: (page: number) => void;
  /** Доп. текст справа от «из N» (например «· 12 миксеров»). */
  suffix?: ReactNode;
  /** Всегда держать место под пагинацию (visibility:hidden при 1 странице). */
  reserveSpace?: boolean;
  style?: CSSProperties;
};

function navButtonStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '8px',
    minWidth: 118,
    padding: '9px 18px',
    borderRadius: 12,
    border: disabled ? '1px solid rgba(148, 163, 184, 0.14)' : CARD_BORDER,
    background: disabled
      ? 'linear-gradient(165deg, #1A2332 0%, #111827 100%)'
      : CARD_GRADIENT_SOFT,
    boxShadow: disabled ? 'none' : CARD_VOLUME_SOFT,
    color: disabled ? '#64748B' : '#F1F5F9',
    fontSize: '14px',
    fontWeight: 600,
    letterSpacing: '0.01em',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.72 : 1,
    transition: 'border-color 0.15s ease, color 0.15s ease, box-shadow 0.15s ease',
    boxSizing: 'border-box',
  };
}

/**
 * Единая пагинация админки: «← Назад · Страница N из M · Вперёд →».
 * Тёмный объёмный стиль кнопок + зелёный акцент на текущей странице.
 */
export default function AdminPagination({
  page,
  totalPages,
  onPage,
  suffix,
  reserveSpace = false,
  style,
}: AdminPaginationProps) {
  const show = totalPages > 1;
  if (!show && !reserveSpace) return null;

  const atStart = page <= 1;
  const atEnd = page >= totalPages;

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '14px',
        flexShrink: 0,
        height: reserveSpace ? 56 : undefined,
        visibility: show ? 'visible' : 'hidden',
        pointerEvents: show ? 'auto' : 'none',
        ...style,
      }}
    >
      <button
        type="button"
        onClick={() => onPage(Math.max(1, page - 1))}
        disabled={atStart}
        style={navButtonStyle(atStart)}
      >
        <span aria-hidden style={{ opacity: 0.85 }}>←</span>
        Назад
      </button>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          minWidth: 160,
          justifyContent: 'center',
          padding: '8px 16px',
          borderRadius: 999,
          border: '1px solid rgba(148, 163, 184, 0.18)',
          background: 'rgba(15, 23, 42, 0.55)',
          color: '#CBD5E1',
          fontSize: '14px',
          fontWeight: 600,
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: '#94A3B8', fontWeight: 500 }}>Страница</span>
        <span
          style={{
            color: '#34D399',
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            textShadow: '0 0 12px rgba(52, 211, 153, 0.28)',
          }}
        >
          {page}
        </span>
        <span style={{ color: '#64748B', fontWeight: 500 }}>из</span>
        <span style={{ color: '#E2E8F0', fontVariantNumeric: 'tabular-nums' }}>{totalPages}</span>
        {suffix ? <span style={{ color: '#64748B', fontWeight: 500 }}>{suffix}</span> : null}
      </div>

      <button
        type="button"
        onClick={() => onPage(Math.min(totalPages, page + 1))}
        disabled={atEnd}
        style={navButtonStyle(atEnd)}
      >
        Вперёд
        <span aria-hidden style={{ opacity: 0.85 }}>→</span>
      </button>
    </div>
  );
}
