'use client';

import { useEffect, useState } from 'react';
import { COLORS, overlayStyle, modalStyle, ghostButton, volumeCardSoftStyle } from '../labStyles';
import { useEscapeClose } from '../labUtils';

interface Props {
  recipe: any;
  onClose: () => void;
}

// Панель истории версий рецептуры: кто/когда/что менял (снимок «до»).
export default function RecipeVersionsModal({ recipe, onClose }: Props) {
  const [versions, setVersions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  useEscapeClose(onClose);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/adminCifra/recipes/${recipe.id}/versions`);
        if (res.ok) setVersions(await res.json());
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    })();
  }, [recipe.id]);

  const fmt = (d: string) => (d ? new Date(d).toLocaleString('ru-RU') : '—');

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle(640)} onClick={(e) => e.stopPropagation()} className="scroll-hidden">
        <h2 style={{ marginBottom: '6px', fontSize: '20px', color: '#fff' }}>История изменений</h2>
        <p style={{ color: COLORS.muted, marginBottom: '20px' }}>
          {recipe.code} — {recipe.name}
        </p>

        {loading ? (
          <p style={{ color: COLORS.muted }}>Загрузка...</p>
        ) : versions.length === 0 ? (
          <p style={{ color: COLORS.muted }}>Пока нет записей — история появится после первого изменения рецепта.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {versions.map((v) => (
              <div key={v.id} style={volumeCardSoftStyle({ borderRadius: 12, padding: '14px' })}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                  <span style={{ color: COLORS.accent, fontWeight: 600 }}>Версия {v.version_no ?? '—'}</span>
                  <span style={{ color: COLORS.muted, fontSize: '13px' }}>{fmt(v.created_at)}</span>
                </div>
                <div style={{ color: '#CBD5E1', fontSize: '14px', marginBottom: '4px' }}>
                  {v.changed_by_name ? `Изменил: ${v.changed_by_name}` : 'Изменение'}
                  {v.change_note ? ` — ${v.change_note}` : ''}
                </div>
                {v.snapshot && (
                  <div style={{ color: COLORS.muted, fontSize: '13px' }}>
                    Было: цена {v.snapshot.price ?? '—'} ₽; Ц/П/Щ/В{' '}
                    {v.snapshot.cement ?? '—'}/{v.snapshot.sand ?? '—'}/{v.snapshot.gravel ?? '—'}/{v.snapshot.water ?? '—'} кг
                    {v.snapshot.strength_class ? `; класс ${v.snapshot.strength_class}` : ''}
                    {v.snapshot.slump ? `; ${v.snapshot.slump}` : ''}
                  </div>
                )}
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
