'use client';

// ==================== ОБЩИЙ КОМПОНЕНТ ИСТОРИИ ЗАЯВКИ ====================
// Используется и в модалке Дашборда (OrderDetailModal), и в модалке страницы
// «Заявки», чтобы история выглядела и работала одинаково в обоих местах.

import React from 'react';

export interface OrderHistoryEntry {
  created_at: string;
  action?: string | null;
  user_name?: string | null;
  user_role?: string | null;
  field_name?: string | null;
  old_value?: string | null;
  new_value?: string | null;
}

// ==================== ПЕРЕВОД НАЗВАНИЙ ПОЛЕЙ НА РУССКИЙ ====================
const FIELD_LABELS: Record<string, string> = {
  grade: 'Марка бетона',
  volume: 'Объём',
  delivery_date: 'Дата доставки',
  delivery_time: 'Время доставки',
  address: 'Адрес доставки',
  phone: 'Телефон',
  organization_name: 'Организация',
  full_name: 'ФИО',
  inn: 'ИНН',
  comment: 'Комментарий',
  status: 'Статус',
  is_questionable: 'Метка «Под вопросом»',
  logistics_ready: 'Готовность логистики',
};

const STATUS_LABELS: Record<string, string> = {
  new: 'Новая',
  processing: 'В работе',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

const ROLE_LABELS: Record<string, string> = {
  admin: 'Админ',
  manager: 'Менеджер',
  dispatcher: 'Диспетчер',
  logist: 'Логист',
  logistic: 'Логист',
  operator: 'Оператор',
  accountant: 'Бухгалтер',
  driver: 'Водитель',
};

function getRoleLabel(role?: string | null): string {
  if (!role || role === 'unknown' || role === 'system') return '';
  return ROLE_LABELS[role] || role;
}

function formatFieldValue(field: string | null | undefined, value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';

  switch (field) {
    case 'status':
      return STATUS_LABELS[value] || value;
    case 'delivery_date': {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
      return m ? `${m[3]}.${m[2]}.${m[1]}` : value;
    }
    case 'delivery_time':
      return value.slice(0, 5);
    case 'volume':
      return `${value} м³`;
    case 'is_questionable':
      return value === 'true' ? 'Да' : 'Нет';
    case 'logistics_ready':
      return value === 'true' ? 'Готова' : 'Не готова';
    default:
      return value;
  }
}

function getFieldLabel(field?: string | null): string {
  if (!field) return 'Поле';
  return FIELD_LABELS[field] || field;
}

function getAccentColor(field?: string | null, newValue?: string | null): string {
  if (field === 'status') {
    if (newValue === 'completed') return '#10B981';
    if (newValue === 'cancelled') return '#EF4444';
    if (newValue === 'processing') return '#3B82F6';
    return '#FACC15';
  }
  switch (field) {
    case 'organization_name': return '#60A5FA';
    case 'volume': return '#F59E0B';
    case 'address': return '#A78BFA';
    case 'grade': return '#22D3EE';
    default: return '#34D399';
  }
}

function getMarker(entry: OrderHistoryEntry): { icon: string; bg: string } {
  const isAuto = entry.user_role === 'system';
  const isCreate = /создал/i.test(entry.action || '');
  const isCancel = entry.field_name === 'status' && entry.new_value === 'cancelled';
  const isComplete = entry.field_name === 'status' && entry.new_value === 'completed';

  if (isCancel) return { icon: '✕', bg: '#EF4444' };
  if (isCreate) return { icon: '★', bg: '#8B5CF6' };
  if (isComplete) return { icon: '✓', bg: '#10B981' };
  if (isAuto) return { icon: '⚙', bg: '#3B82F6' };
  return { icon: '✓', bg: '#10B981' };
}

function formatTimeStamp(createdAt: string): string {
  const d = new Date(createdAt);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}.${mm} ${hh}:${min}`;
}

interface OrderHistoryTimelineProps {
  entries: OrderHistoryEntry[];
  emptyText?: string;
}

export function OrderHistoryTimeline({ entries, emptyText = 'История изменений пуста' }: OrderHistoryTimelineProps) {
  if (!entries || entries.length === 0) {
    return (
      <div style={{ color: '#64748B', textAlign: 'center', padding: '60px 0', fontStyle: 'italic' }}>
        {emptyText}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        const isAuto = entry.user_role === 'system';
        const marker = getMarker(entry);
        const roleLabel = getRoleLabel(entry.user_role);
        const hasChange = Boolean(entry.field_name || entry.old_value || entry.new_value);

        const oldDisplay = formatFieldValue(entry.field_name, entry.old_value);
        const newDisplay = formatFieldValue(entry.field_name, entry.new_value);
        const fieldLabel = getFieldLabel(entry.field_name);
        const accentColor = getAccentColor(entry.field_name, entry.new_value);
        const isLongText = entry.field_name === 'comment' || oldDisplay.length > 44 || newDisplay.length > 44;

        return (
          <div key={index} style={{ display: 'flex', gap: '14px' }}>
            {/* Маркер + соединительная линия */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: '26px', flexShrink: 0 }}>
              <div style={{
                width: '26px',
                height: '26px',
                borderRadius: '50%',
                background: marker.bg,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '13px',
                fontWeight: 700,
                flexShrink: 0,
                boxShadow: '0 0 0 4px #25334A',
              }}>
                {marker.icon}
              </div>
              {!isLast && (
                <div style={{ width: '2px', flex: 1, background: '#334155', marginTop: '2px' }} />
              )}
            </div>

            {/* Контент */}
            <div style={{ flex: 1, minWidth: 0, paddingBottom: isLast ? '2px' : '20px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', flexWrap: 'wrap' }}>
                <strong style={{ color: isAuto ? '#60A5FA' : '#E2E8F0', fontSize: '14px' }}>
                  {isAuto ? '🤖 Система (автоматически)' : (entry.user_name || 'Сотрудник')}
                </strong>
                {!isAuto && roleLabel && (
                  <span style={{ color: '#64748B', fontSize: '12px' }}>{roleLabel}</span>
                )}
                <span style={{ color: '#64748B', fontSize: '12px', marginLeft: 'auto', whiteSpace: 'nowrap' }}>
                  {formatTimeStamp(entry.created_at)}
                </span>
              </div>

              {entry.action && (
                <div style={{ marginTop: '4px', color: '#CBD5E1', fontSize: '14px', lineHeight: '1.45' }}>
                  {entry.action}
                </div>
              )}

              {hasChange && (
                isLongText ? (
                  <div style={{
                    marginTop: '8px',
                    paddingLeft: '12px',
                    borderLeft: `2px solid ${accentColor}55`,
                    fontSize: '13px',
                  }}>
                    <div style={{ color: '#64748B', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em', marginBottom: '5px' }}>
                      {fieldLabel}
                    </div>
                    <div style={{ color: '#94A3B8', opacity: 0.85, textDecoration: 'line-through', lineHeight: '1.5', wordBreak: 'break-word', marginBottom: '5px' }}>
                      {oldDisplay}
                    </div>
                    <div style={{ color: accentColor, fontWeight: 600, lineHeight: '1.5', wordBreak: 'break-word' }}>
                      {newDisplay}
                    </div>
                  </div>
                ) : (
                  <div style={{
                    marginTop: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    paddingLeft: '12px',
                    borderLeft: `2px solid ${accentColor}55`,
                    fontSize: '13px',
                    flexWrap: 'wrap',
                  }}>
                    <span style={{ color: '#64748B', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                      {fieldLabel}
                    </span>
                    <span style={{ color: '#94A3B8', textDecoration: 'line-through', opacity: 0.85 }}>
                      {oldDisplay}
                    </span>
                    <span style={{ color: '#475569' }}>→</span>
                    <span style={{ color: accentColor, fontWeight: 700 }}>
                      {newDisplay}
                    </span>
                  </div>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
