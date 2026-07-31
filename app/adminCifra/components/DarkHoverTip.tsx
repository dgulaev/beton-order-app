'use client';

import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type TipPos = { left: number; top: number; placeAbove: boolean };

type Props = {
  tip: string | null | undefined;
  children: ReactNode;
  /** Не показывать (например, пустой tip) */
  disabled?: boolean;
  maxWidth?: number;
  /** display обёртки */
  display?: CSSProperties['display'];
  style?: CSSProperties;
  className?: string;
};

/**
 * Тёмный тултип при наведении (portal) — вместо нативного title.
 * Стиль как у чипов миксеров / карточек админки.
 */
export default function DarkHoverTip({
  tip,
  children,
  disabled,
  maxWidth = 280,
  display = 'inline-flex',
  style,
  className,
}: Props) {
  const wrapRef = useRef<HTMLSpanElement>(null);
  const [hover, setHover] = useState(false);
  const [pos, setPos] = useState<TipPos | null>(null);
  const text = String(tip || '').trim();
  const active = Boolean(text) && !disabled;

  useLayoutEffect(() => {
    if (!hover || !active || !wrapRef.current) {
      setPos(null);
      return;
    }
    const rect = wrapRef.current.getBoundingClientRect();
    const placeAbove = rect.bottom + 120 > window.innerHeight;
    setPos({
      left: Math.min(
        Math.max(rect.left + rect.width / 2, 12),
        window.innerWidth - 12,
      ),
      top: placeAbove ? rect.top - 8 : rect.bottom + 8,
      placeAbove,
    });
  }, [hover, active, text]);

  const tipNode =
    hover && active && pos && typeof document !== 'undefined'
      ? createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              left: pos.left,
              top: pos.top,
              transform: pos.placeAbove
                ? 'translate(-50%, -100%)'
                : 'translateX(-50%)',
              zIndex: 9999,
              maxWidth,
              padding: '8px 12px',
              borderRadius: 10,
              border: '1px solid rgba(71,85,105,0.95)',
              background:
                'linear-gradient(180deg, rgba(30,41,59,0.98) 0%, rgba(15,23,42,0.98) 100%)',
              boxShadow: '0 10px 28px rgba(0,0,0,0.5)',
              color: '#E2E8F0',
              fontSize: 12.5,
              fontWeight: 500,
              lineHeight: 1.4,
              textAlign: 'left',
              pointerEvents: 'none',
              whiteSpace: 'normal',
            }}
          >
            {text}
          </div>,
          document.body,
        )
      : null;

  return (
    <span
      ref={wrapRef}
      className={className}
      style={{ position: 'relative', display, ...style }}
      onMouseEnter={() => {
        if (active) setHover(true);
      }}
      onMouseLeave={() => setHover(false)}
    >
      {children}
      {tipNode}
    </span>
  );
}
