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
                ...modalFieldStyle({
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  textAlign: 'left',
                  cursor: disabled ? 'not-allowed' : 'pointer',
                  opacity: disabled ? 0.6 : 1,
                  backgroundImage: `linear-gradient(transparent, transparent), ${CARD_GRADIENT_SOFT}`,
                  paddingRight: 32,
                  position: 'relative',
                  ...style,
                }),
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
        estimatedHeight={Math.min(360, 48 + options.length * 44)}
        style={{ padding: 6, overflow: 'hidden' }}
      >
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          overflowY: 'auto',
          minHeight: 0,
          flex: '1 1 auto',
        }}>
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
      </PortalPopup>
    </>
  );
}
