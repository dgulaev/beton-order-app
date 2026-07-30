'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Clock } from 'lucide-react';
import { modalFieldStyle } from '../cardStyles';
import { nowTimeHHMM, pad2, pickerItemStyle, PortalPopup, useDismissOnOutside } from './modalPickerShared';

type Props = {
  value: string;
  onChange: (value: string) => void;
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
};

const COL_H = 220;

/** Принимает HH:MM и HH:MM:SS (из БД часто приходит с секундами). */
function parseTime(v: string): { h: number; m: number; ok: boolean } {
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?/.exec(String(v || '').trim());
  if (!m) {
    // Пустое/битое значение — крутим колесо от текущего московского времени.
    const now = /^(\d{1,2}):(\d{2})/.exec(nowTimeHHMM());
    return {
      h: now ? Math.min(23, Number(now[1])) : 0,
      m: now ? Math.min(59, Number(now[2])) : 0,
      ok: false,
    };
  }
  return {
    h: Math.min(23, Number(m[1])),
    m: Math.min(59, Number(m[2])),
    ok: true,
  };
}

/**
 * Полностью распознанное время из ручного ввода → HH:MM.
 * Допускает «8:30», «08:30», «830», «0830», точки/запятые вместо двоеточия.
 */
function tryParseComplete(raw: string): string | null {
  const s = String(raw || '')
    .trim()
    .replace(/[.,]/g, ':')
    .replace(/\s/g, '');
  if (!s) return null;

  // Минуты — строго 2 цифры, иначе при наборе «8:3» → «08:03» раньше «8:30».
  const colon = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (colon) {
    const hh = Number(colon[1]);
    const mm = Number(colon[2]);
    if (hh <= 23 && mm <= 59) return `${pad2(hh)}:${pad2(mm)}`;
    return null;
  }

  if (/^\d{3,4}$/.test(s)) {
    const digits = s.padStart(4, '0');
    const hh = Number(digits.slice(0, 2));
    const mm = Number(digits.slice(2));
    if (hh <= 23 && mm <= 59) return `${pad2(hh)}:${pad2(mm)}`;
  }

  return null;
}

function scrollColToIndex(el: HTMLDivElement | null, idx: number) {
  if (!el) return;
  const child = el.children[idx] as HTMLElement | undefined;
  if (!child) return;
  const top = child.offsetTop - el.clientHeight / 2 + child.clientHeight / 2;
  el.scrollTop = Math.max(0, top);
}

/**
 * Единый выбор времени для adminCifra.
 * Правила:
 * - ручной ввод HH:MM в поле;
 * - выпадающий список: значение в форму только по клику (не по hover);
 * - клик по минуте сразу закрывает попап (кнопки «Готово» нет).
 */
export default function ModalTimeInput({ value, onChange, style, disabled, title }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const anchorRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const hoursRef = useRef<HTMLDivElement>(null);
  const minsRef = useRef<HTMLDivElement>(null);
  const inputFocusedRef = useRef(false);
  const { h, m, ok } = parseTime(value);

  // Подсветка в попапе — только по клику, не по hover.
  const [draftH, setDraftH] = useState(h);
  const [draftM, setDraftM] = useState(m);

  useDismissOnOutside(open, () => setOpen(false), anchorRef, popupRef);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, i) => i), []);
  const minutes = useMemo(() => Array.from({ length: 60 }, (_, i) => i), []);

  // Синхронизация текста поля с value, пока пользователь не печатает.
  useEffect(() => {
    if (inputFocusedRef.current) return;
    setText(ok ? `${pad2(h)}:${pad2(m)}` : '');
  }, [value, ok, h, m]);

  useEffect(() => {
    if (!open) return;
    setDraftH(h);
    setDraftM(m);
    requestAnimationFrame(() => {
      scrollColToIndex(hoursRef.current, h);
      scrollColToIndex(minsRef.current, m);
    });
    // Только при открытии — иначе клик/ввод будут дёргать скролл.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Колёсико: крутим колонку под курсором. Нужен passive:false + stopPropagation,
  // иначе layout.blockPageBounce глушит wheel, когда колонка ещё «не скроллится»
  // (или событие уходит в модалку).
  useEffect(() => {
    if (!open) return;
    const bind = (el: HTMLDivElement | null) => {
      if (!el) return () => {};
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        e.stopPropagation();
        el.scrollTop += e.deltaY;
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    };
    const offH = bind(hoursRef.current);
    const offM = bind(minsRef.current);
    return () => {
      offH();
      offM();
    };
  }, [open]);

  const pick = (nh: number, nm: number) => {
    setDraftH(nh);
    setDraftM(nm);
    const next = `${pad2(nh)}:${pad2(nm)}`;
    onChange(next);
    if (!inputFocusedRef.current) setText(next);
  };

  const commitText = () => {
    const parsed = tryParseComplete(text);
    if (parsed) {
      onChange(parsed);
      setText(parsed);
      const p = parseTime(parsed);
      setDraftH(p.h);
      setDraftM(p.m);
      return;
    }
    // Невалидный/неполный ввод — вернуть отображение из value.
    setText(ok ? `${pad2(h)}:${pad2(m)}` : '');
  };

  const openPicker = () => {
    if (disabled) return;
    if (!ok) onChange(nowTimeHHMM());
    setOpen((v) => !v);
  };

  return (
    <>
      <div
        ref={anchorRef}
        title={title}
        style={{
          ...modalFieldStyle({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            opacity: disabled ? 0.6 : 1,
            paddingRight: 8,
            ...style,
          }),
        }}
      >
        <input
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          placeholder="——:——"
          aria-label={title || 'Время'}
          value={text}
          onFocus={() => {
            inputFocusedRef.current = true;
          }}
          onBlur={() => {
            inputFocusedRef.current = false;
            commitText();
          }}
          onChange={(e) => {
            const raw = e.target.value;
            // Ограничиваем шум: цифры и разделители, до 5 символов («08:30»).
            const cleaned = raw.replace(/[^\d:.,]/g, '').slice(0, 5);
            setText(cleaned);
            const parsed = tryParseComplete(cleaned);
            if (parsed && (/^\d{1,2}:\d{2}$/.test(cleaned.replace(/[.,]/g, ':')) || /^\d{4}$/.test(cleaned))) {
              onChange(parsed);
              setDraftH(parseTime(parsed).h);
              setDraftM(parseTime(parsed).m);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commitText();
              (e.target as HTMLInputElement).blur();
              setOpen(false);
            }
            if (e.key === 'Escape') {
              setOpen(false);
              setText(ok ? `${pad2(h)}:${pad2(m)}` : '');
              (e.target as HTMLInputElement).blur();
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: text ? '#fff' : '#64748B',
            fontSize: 'inherit',
            fontFamily: 'inherit',
            fontWeight: 'inherit',
            padding: 0,
            margin: 0,
            cursor: disabled ? 'not-allowed' : 'text',
          }}
        />
        <button
          type="button"
          disabled={disabled}
          title="Выбрать время"
          aria-label="Выбрать время"
          aria-expanded={open}
          onClick={openPicker}
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'transparent',
            padding: 2,
            marginRight: 0,
            cursor: disabled ? 'not-allowed' : 'pointer',
            borderRadius: 6,
          }}
        >
          <Clock size={15} color="#2DD4BF" strokeWidth={2} />
        </button>
      </div>

      <PortalPopup
        open={open}
        anchorRef={anchorRef}
        popupRef={popupRef}
        width={220}
        estimatedHeight={COL_H + 20}
        style={{ width: 220, padding: 0, overflow: 'hidden' }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 8,
            height: COL_H,
            minHeight: COL_H,
            maxHeight: COL_H,
            padding: 10,
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          <div ref={hoursRef} style={colStyle} data-time-col="hours">
            {hours.map((hh) => {
              const active = hh === draftH;
              return (
                <button
                  key={hh}
                  type="button"
                  onClick={() => pick(hh, draftM)}
                  style={cellStyle(active)}
                >
                  {pad2(hh)}
                </button>
              );
            })}
          </div>
          <div ref={minsRef} style={colStyle} data-time-col="mins">
            {minutes.map((mm) => {
              const active = mm === draftM;
              return (
                <button
                  key={mm}
                  type="button"
                  onClick={() => {
                    pick(draftH, mm);
                    setOpen(false);
                  }}
                  style={cellStyle(active)}
                >
                  {pad2(mm)}
                </button>
              );
            })}
          </div>
        </div>
      </PortalPopup>
    </>
  );
}

const colStyle: CSSProperties = {
  height: '100%',
  maxHeight: '100%',
  overflowY: 'auto',
  overflowX: 'hidden',
  overscrollBehavior: 'contain',
  display: 'block',
  paddingRight: 2,
  minHeight: 0,
  WebkitOverflowScrolling: 'touch',
};

function cellStyle(active: boolean): CSSProperties {
  return pickerItemStyle(active, {
    display: 'block',
    width: '100%',
    padding: '8px 0',
    marginBottom: 4,
    borderRadius: 8,
    border: active ? '1px solid rgba(45,212,191,0.55)' : '1px solid rgba(148,163,184,0.12)',
    ...(active
      ? {
          background: 'linear-gradient(165deg, rgba(45,212,191,0.32) 0%, rgba(15,23,42,0.95) 100%)',
        }
      : {}),
    color: active ? '#fff' : '#CBD5E1',
    fontSize: 14,
    fontWeight: active ? 700 : 500,
  });
}
