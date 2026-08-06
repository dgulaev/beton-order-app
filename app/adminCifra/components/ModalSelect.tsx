'use client';

import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { CARD_GRADIENT_SOFT, modalFieldStyle } from '../cardStyles';
import { pickerItemStyle, PortalPopup, useDismissOnOutside } from './modalPickerShared';

export type ModalSelectOption = {
  value: string;
  label: ReactNode;
  /** plain text for closed trigger if label is ReactNode */
  text?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  options: ModalSelectOption[];
  style?: CSSProperties;
  disabled?: boolean;
  title?: string;
  placeholder?: string;
  /** Custom closed-field look (e.g. status pill). Omit for default modal field. */
  triggerStyle?: CSSProperties;
  chevronColor?: string;
  minPopupWidth?: number;
};

const CHEVRON_PAD_RIGHT = 32;

/** Разворачивает shorthand `padding` в longhand — иначе React ругается на
 *  конфликт с `paddingRight` под шеврон и поле визуально «схлопывается». */
function fieldTriggerStyle(style?: CSSProperties): CSSProperties {
  const raw = modalFieldStyle({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    textAlign: 'left',
    backgroundImage: `linear-gradient(transparent, transparent), ${CARD_GRADIENT_SOFT}`,
    position: 'relative',
  });
  const {
    padding: basePad,
    paddingTop: _bpt,
    paddingRight: _bpr,
    paddingBottom: _bpb,
    paddingLeft: _bpl,
    ...baseRest
  } = raw;

  const {
    padding: propPad,
    paddingTop: propPt,
    paddingRight: _propPr,
    paddingBottom: propPb,
    paddingLeft: propPl,
    ...propRest
  } = style || {};

  const padSrc = propPad ?? basePad ?? 14;
  const parts = String(padSrc).trim().split(/\s+/);
  let top: string | number = parts[0];
  let right: string | number = parts[0];
  let bottom: string | number = parts[0];
  let left: string | number = parts[0];
  if (parts.length === 2) {
    right = left = parts[1];
  } else if (parts.length === 3) {
    right = left = parts[1];
    bottom = parts[2];
  } else if (parts.length >= 4) {
    right = parts[1];
    bottom = parts[2];
    left = parts[3];
  }

  return {
    ...baseRest,
    ...propRest,
    paddingTop: propPt ?? top,
    paddingBottom: propPb ?? bottom,
    paddingLeft: propPl ?? left,
    paddingRight: CHEVRON_PAD_RIGHT,
  };
}

export default function ModalSelect({
  value,
  onChange,
  options,
  style,
  disabled,
  title,
  placeholder = '— выберите —',
  triggerStyle,
  chevronColor = '#94A3B8',
  minPopupWidth,
}: Props) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside(open, () => setOpen(false), anchorRef, popupRef);

  const selected = useMemo(
    () => options.find((o) => o.value === value),
    [options, value],
  );

  const closedLabel = selected
    ? (selected.text ?? (typeof selected.label === 'string' ? selected.label : value))
    : placeholder;

  const isCustomTrigger = !!triggerStyle;

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          setOpen((v) => !v);
        }}
        style={
          isCustomTrigger
            ? {
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
                ...triggerStyle,
                ...style,
              }
            : {
                ...fieldTriggerStyle(style),
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.6 : 1,
              }
        }
      >
        <span
          style={{
            flex: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: selected ? undefined : '#64748B',
          }}
        >
          {isCustomTrigger && selected ? selected.label : closedLabel}
        </span>
        <ChevronDown
          size={14}
          strokeWidth={2.5}
          color={chevronColor}
          style={{
            flexShrink: 0,
            position: isCustomTrigger ? undefined : 'absolute',
            right: isCustomTrigger ? undefined : 10,
            opacity: 0.9,
          }}
        />
      </button>

      <PortalPopup
        open={open}
        anchorRef={anchorRef}
        popupRef={popupRef}
        width="anchor"
        minWidth={minPopupWidth ?? 160}
        estimatedHeight={Math.min(360, 16 + Math.max(options.length, 1) * 44)}
        // Скролл на самой панели — без вложенного flex:1/minHeight:0,
        // иначе список схлопывается в тонкую полоску (maxHeight без явной высоты).
        style={{ padding: 6, overflowX: 'hidden', overflowY: 'auto' }}
      >
        {options.length === 0 ? (
          <div
            style={{
              padding: '10px 12px',
              color: '#94A3B8',
              fontSize: 13,
              lineHeight: 1.35,
            }}
          >
            Нет вариантов
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  style={pickerItemStyle(active, {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 12px',
                    borderRadius: 10,
                    fontSize: 14,
                    fontWeight: active ? 700 : 500,
                    textAlign: 'left',
                    width: '100%',
                    flexShrink: 0,
                  })}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
      </PortalPopup>
    </>
  );
}
