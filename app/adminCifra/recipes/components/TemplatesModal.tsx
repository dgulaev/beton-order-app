'use client';

import { useEffect, useState } from 'react';
import { COLORS, overlayStyle, modalStyle, ghostButton, primaryButton } from '../labStyles';

interface Props {
  onClose: () => void;
  onApply?: (payload: any) => void; // применить шаблон к текущей рецептуре
}

// Управление шаблонами рецептур: список, применение, удаление.
export default function TemplatesModal({ onClose, onApply }: Props) {
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/adminCifra/recipe-templates');
      if (res.ok) setTemplates(await res.json());
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const removeTemplate = async (id: number) => {
    if (!confirm('Удалить шаблон?')) return;
    await fetch(`/api/adminCifra/recipe-templates?id=${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle(620)} onClick={(e) => e.stopPropagation()} className="scroll-hidden">
        <h2 style={{ marginBottom: '4px', fontSize: '20px', color: '#fff' }}>Шаблоны рецептур</h2>
        <p style={{ color: COLORS.muted, marginBottom: '20px', fontSize: '14px' }}>
          Заготовки состава и характеристик для быстрого заполнения. Применяйте шаблон при создании рецептуры.
        </p>

        {loading ? (
          <p style={{ color: COLORS.muted }}>Загрузка...</p>
        ) : templates.length === 0 ? (
          <p style={{ color: COLORS.muted }}>
            Шаблонов пока нет. Откройте рецептуру и нажмите «Сохранить как шаблон».
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {templates.map((t) => (
              <div
                key={t.id}
                style={{
                  background: COLORS.input,
                  borderRadius: '12px',
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '12px',
                }}
              >
                <div>
                  <div style={{ color: '#fff', fontWeight: 600 }}>{t.name}</div>
                  {t.group_name && (
                    <div style={{ color: COLORS.muted, fontSize: '13px' }}>Группа: {t.group_name}</div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {onApply && (
                    <button
                      onClick={() => {
                        onApply(t.payload || {});
                        onClose();
                      }}
                      style={primaryButton()}
                    >
                      Применить
                    </button>
                  )}
                  <button onClick={() => removeTemplate(t.id)} style={ghostButton}>
                    Удалить
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: '24px', textAlign: 'right' }}>
          <button onClick={onClose} style={ghostButton}>Закрыть</button>
        </div>
      </div>
    </div>
  );
}
