// Общие стили объёмных карточек (склад / оператор / лаборатория).
import type { CSSProperties } from 'react';

export const CARD_GRADIENT =
  'linear-gradient(165deg, #1E2937 0%, #0F172A 72%, #0B1220 100%)';
export const CARD_GRADIENT_SOFT =
  'linear-gradient(165deg, #1E2937 0%, #0F172A 100%)';

/** Лёгкий объём: мягкая тень + верхний блик + лёгкое затемнение снизу. */
export const CARD_VOLUME =
  '0 12px 28px rgba(0,0,0,0.34), 0 3px 8px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.12), inset 0 -10px 22px rgba(0,0,0,0.16)';
export const CARD_VOLUME_SOFT =
  '0 8px 18px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.16), inset 0 1px 0 rgba(255,255,255,0.1)';
export const CARD_BORDER = '1px solid rgba(148, 163, 184, 0.28)';

/** Крупная объёмная карточка-панель. */
export function volumeCardStyle(extra: CSSProperties = {}): CSSProperties {
  return {
    background: CARD_GRADIENT,
    border: CARD_BORDER,
    borderRadius: 18,
    boxShadow: CARD_VOLUME,
    boxSizing: 'border-box',
    ...extra,
  };
}

/** Компактная объёмная карточка (KPI, строки списка, мини-карточки). */
export function volumeCardSoftStyle(extra: CSSProperties = {}): CSSProperties {
  return {
    background: CARD_GRADIENT_SOFT,
    border: CARD_BORDER,
    borderRadius: 14,
    boxShadow: CARD_VOLUME_SOFT,
    boxSizing: 'border-box',
    ...extra,
  };
}

/** Мягкое сланцевое свечение + глубокая тень для модальных панелей. */
export const MODAL_VOLUME_GLOW = [
  CARD_VOLUME,
  '0 0 0 1px rgba(148,163,184,0.12)',
  '0 0 48px rgba(148,163,184,0.22)',
  '0 0 110px rgba(148,163,184,0.12)',
  '0 40px 100px rgba(0,0,0,0.55)',
].join(', ');

/** Оболочка модалки: объёмная карточка + свечение за панелью. */
export function volumeModalStyle(extra: CSSProperties = {}): CSSProperties {
  return volumeCardStyle({
    borderRadius: 22,
    boxShadow: MODAL_VOLUME_GLOW,
    ...extra,
  });
}

/** Поле формы внутри модалки (input / select / textarea) — как в деталях заявки. */
export function modalFieldStyle(extra: CSSProperties = {}): CSSProperties {
  return volumeCardSoftStyle({
    width: '100%',
    padding: '14px',
    borderRadius: 12,
    color: '#fff',
    fontSize: '15px',
    outline: 'none',
    // Чтобы нативные иконки date/time/select были светлыми, а не чёрными.
    colorScheme: 'dark',
    ...extra,
  });
}

/** Мягкий шеврон select (~#94A3B8), позиция как у иконок date/time. */
const SELECT_CHEVRON_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394A3B8' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E\")";

/**
 * Select внутри модалки: кастомная стрелка (нативная на macOS не слушает padding).
 * Стрелка на right 10px — вровень с calendar/clock.
 */
export function modalSelectStyle(extra: CSSProperties = {}): CSSProperties {
  const { background: _bg, backgroundImage: _bi, ...field } = modalFieldStyle(extra) as CSSProperties & {
    background?: string;
    backgroundImage?: string;
  };
  return {
    ...field,
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    appearance: 'none',
    backgroundImage: `${SELECT_CHEVRON_SVG}, ${CARD_GRADIENT_SOFT}`,
    backgroundRepeat: 'no-repeat, no-repeat',
    backgroundPosition: 'right 10px center, 0 0',
    backgroundSize: '12px 12px, 100% 100%',
    paddingRight: 32,
  };
}

/** Кнопка «×» закрытия модалки — без фона/бордера, только иконка. */
export function modalCloseButtonStyle(extra: CSSProperties = {}): CSSProperties {
  return {
    fontSize: '22px',
    lineHeight: 1,
    color: '#94A3B8',
    cursor: 'pointer',
    width: 36,
    height: 36,
    padding: 0,
    border: 'none',
    background: 'transparent',
    borderRadius: 10,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    boxShadow: 'none',
    ...extra,
  };
}
