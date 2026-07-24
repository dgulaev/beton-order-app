'use client';

import { useState, type ReactNode } from 'react';

/**
 * Мгновенная подсказка при наведении (без задержки нативного title).
 * Стиль как у тултипов таймлайна: тёмная карточка, рамка #334E65.
 */
export function InstantFieldHint({
  active,
  message,
  children,
  placement = 'top',
}: {
  active: boolean;
  message: string;
  children: ReactNode;
  placement?: 'top' | 'bottom';
}) {
  const [show, setShow] = useState(false);

  return (
    <div
      style={{ position: 'relative', width: '100%' }}
      onMouseEnter={() => {
        if (active) setShow(true);
      }}
      onMouseLeave={() => setShow(false)}
    >
      {children}
      {active && show ? (
        <div
          role="tooltip"
          style={{
            position: 'absolute',
            ...(placement === 'top'
              ? { bottom: 'calc(100% + 8px)', left: 0 }
              : { top: 'calc(100% + 8px)', left: 0 }),
            zIndex: 80,
            maxWidth: 280,
            padding: '8px 12px',
            borderRadius: 10,
            background: '#1A2B3E',
            border: '1px solid #334E65',
            boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
            color: '#E2E8F0',
            fontSize: 12.5,
            lineHeight: 1.4,
            fontWeight: 500,
            pointerEvents: 'none',
          }}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}

export const VOLUME_LOCKED_HINT =
  'Объём нельзя менять у заявки в статусе «Выполнена»';
