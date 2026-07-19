'use client';
// app/adminCifra/components/ModalActionButton.tsx
// Единый стиль кнопок действий для модалок заявок (взят из инлайн-редактора
// на странице «Заявки» — «Сохранить»/«Удалить»/«В Max»/«Поделиться»/
// «Копировать заявку»/«Отмена»). Компактная кнопка без "таблеточного"
// сплошного фона — тонкая рамка + акцентный цвет текста/иконки, лёгкая
// подсветка фона при наведении. Переиспользуется во всех модалках заявок,
// чтобы кнопки везде выглядели одинаково.

import { useState } from 'react';
import type { ReactNode } from 'react';

interface ModalActionButtonProps {
  onClick?: () => void;
  color: string;
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  /** 'submit' — для главной кнопки внутри <form> (напр. «Создать заявку»), чтобы работала нативная валидация required-полей. По умолчанию 'button'. */
  type?: 'button' | 'submit';
  /** Растянуть кнопку на всю доступную ширину колонки — для пары кнопок «Отмена»/«Создать» в форме. */
  fullWidth?: boolean;
  /**
   * 'sm' (по умолчанию) — компактный десктопный размер.
   * 'lg' — увеличенный touch-friendly размер для мобильной админки
   * (тот же стиль рамки/подсветки, но крупнее padding/шрифт под палец).
   */
  size?: 'sm' | 'lg';
}

export default function ModalActionButton({
  onClick,
  color,
  icon,
  label,
  disabled,
  type = 'button',
  fullWidth,
  size = 'sm',
}: ModalActionButtonProps) {
  const [hover, setHover] = useState(false);
  const isLg = size === 'lg';
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: isLg ? '8px' : '6px',
        flex: fullWidth ? 1 : undefined,
        padding: isLg ? '15px 18px' : '8px 14px',
        borderRadius: isLg ? '14px' : '10px',
        border: `1px solid ${color}${hover && !disabled ? '80' : '30'}`,
        background: hover && !disabled ? `${color}18` : 'transparent',
        color,
        fontWeight: 600,
        fontSize: isLg ? '16px' : '13px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
    >
      {icon}
      {label}
    </button>
  );
}
