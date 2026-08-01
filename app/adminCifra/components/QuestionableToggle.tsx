'use client';

/**
 * Переключатель метки «Под вопросом».
 * Вместо мелкого checkbox — явный switch: выкл/вкл сразу видно.
 */

type Props = {
  checked: boolean;
  disabled?: boolean;
  saving?: boolean;
  onChange: (next: boolean) => void;
  /** Полный с подписью (десктоп) или компактный (мобилка в шапке) */
  variant?: 'full' | 'compact';
  title?: string;
};

export default function QuestionableToggle({
  checked,
  disabled,
  saving,
  onChange,
  variant = 'full',
  title = 'Под вопросом',
}: Props) {
  const busy = Boolean(disabled || saving);

  if (variant === 'compact') {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={title}
        title={checked ? `${title}: включено` : `${title}: выключено`}
        disabled={busy}
        onClick={() => {
          if (busy) return;
          onChange(!checked);
        }}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 34,
          height: 22,
          padding: 2,
          borderRadius: 999,
          border: checked
            ? '1px solid rgba(248,113,113,0.95)'
            : '1px solid rgba(148,163,184,0.45)',
          background: checked
            ? 'linear-gradient(180deg, #F87171 0%, #EF4444 100%)'
            : 'rgba(30,41,59,0.9)',
          boxShadow: checked
            ? '0 0 0 3px rgba(239,68,68,0.28), 0 2px 8px rgba(239,68,68,0.35)'
            : 'inset 0 1px 2px rgba(0,0,0,0.35)',
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.65 : 1,
          flexShrink: 0,
          transition: 'background 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.35)',
            transform: checked ? 'translateX(6px)' : 'translateX(-6px)',
            transition: 'transform 0.15s ease',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontWeight: 800,
            color: checked ? '#DC2626' : '#94A3B8',
          }}
        >
          ?
        </span>
      </button>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={title}
      title={checked ? `${title}: включено` : `${title}: выключено`}
      disabled={busy}
      onClick={() => {
        if (busy) return;
        onChange(!checked);
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 12px 7px 10px',
        borderRadius: 999,
        border: checked
          ? '1px solid rgba(248,113,113,0.85)'
          : '1px solid rgba(148,163,184,0.35)',
        background: checked
          ? 'rgba(239,68,68,0.22)'
          : 'rgba(15,23,42,0.55)',
        boxShadow: checked
          ? '0 0 0 2px rgba(239,68,68,0.22), inset 0 1px 0 rgba(255,255,255,0.06)'
          : 'inset 0 1px 0 rgba(255,255,255,0.04)',
        cursor: busy ? 'wait' : 'pointer',
        opacity: busy ? 0.7 : 1,
        userSelect: 'none',
        whiteSpace: 'nowrap',
        transition: 'background 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease',
      }}
    >
      <span
        aria-hidden
        style={{
          position: 'relative',
          width: 40,
          height: 22,
          borderRadius: 999,
          background: checked
            ? 'linear-gradient(180deg, #F87171 0%, #DC2626 100%)'
            : 'rgba(51,65,85,0.95)',
          border: checked
            ? '1px solid rgba(254,202,202,0.55)'
            : '1px solid rgba(100,116,139,0.7)',
          boxShadow: checked
            ? 'inset 0 1px 2px rgba(255,255,255,0.25)'
            : 'inset 0 1px 3px rgba(0,0,0,0.45)',
          flexShrink: 0,
          transition: 'background 0.15s ease',
        }}
      >
        <span
          style={{
            position: 'absolute',
            top: 2,
            left: checked ? 20 : 2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            background: '#fff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
            transition: 'left 0.15s ease',
          }}
        />
      </span>
      <span
        style={{
          display: 'inline-flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 1,
          lineHeight: 1.15,
        }}
      >
        <span
          style={{
            color: checked ? '#FECACA' : '#F87171',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          Под вопросом
        </span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.04em',
            textTransform: 'uppercase',
            color: checked ? '#FCA5A5' : '#64748B',
          }}
        >
          {saving ? 'сохраняю…' : checked ? 'включено' : 'выключено'}
        </span>
      </span>
    </button>
  );
}
