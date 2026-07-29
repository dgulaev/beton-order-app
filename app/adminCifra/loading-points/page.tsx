'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { MapPin } from 'lucide-react';
import { modalFieldStyle, volumeCardSoftStyle, volumeCardStyle, volumeModalStyle } from '../cardStyles';
import ModalSelect from '../components/ModalSelect';
import { appAlert, appConfirm } from '../components/appDialog';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import {
  LOADING_POINT_KINDS,
  loadingPointKindLabel,
  loadingPointOwnershipLabel,
  type LoadingPoint,
  type LoadingPointKind,
  type LoadingPointOwnership,
} from '@/lib/loadingPoints';

const emptyForm = {
  name: '',
  kind: 'concrete' as LoadingPointKind,
  ownership: 'own' as LoadingPointOwnership,
  address: '',
  lat: '' as number | '',
  lon: '' as number | '',
  is_default: false,
  active: true,
  notes: '',
};

function ownershipPillStyle(ownership: LoadingPointOwnership): CSSProperties {
  const own = ownership === 'own';
  return {
    flexShrink: 0,
    alignSelf: 'flex-start',
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 12px',
    borderRadius: 9999,
    fontSize: 12,
    fontWeight: 700,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    background: own ? 'rgba(16,185,129,0.16)' : 'rgba(250,204,21,0.14)',
    border: own ? '1px solid rgba(110,231,183,0.35)' : '1px solid rgba(250,204,21,0.35)',
    color: own ? '#6EE7B7' : '#FDE68A',
  };
}

function metaPillStyle(variant: 'muted' | 'default' | 'hidden' = 'muted'): CSSProperties {
  const map = {
    muted: { bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.28)', color: '#94A3B8' },
    default: { bg: 'rgba(96,165,250,0.14)', border: 'rgba(96,165,250,0.35)', color: '#93C5FD' },
    hidden: { bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.22)', color: '#64748B' },
  }[variant];
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 10px',
    borderRadius: 9999,
    fontSize: 12,
    fontWeight: 600,
    lineHeight: 1.2,
    whiteSpace: 'nowrap',
    background: map.bg,
    border: `1px solid ${map.border}`,
    color: map.color,
  };
}

const cardBtnBase: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: 10,
  border: 'none',
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: 14,
  boxSizing: 'border-box',
};

const editBtnStyle: CSSProperties = {
  ...cardBtnBase,
  background: '#334155',
  color: '#E2E8F0',
};

const hideBtnStyle: CSSProperties = {
  ...cardBtnBase,
  border: '1px solid rgba(251,191,36,0.35)',
  background: 'rgba(120,53,15,0.35)',
  color: '#FCD34D',
};

const restoreBtnStyle: CSSProperties = {
  ...cardBtnBase,
  border: '1px solid rgba(110,231,183,0.35)',
  background: 'rgba(16,185,129,0.22)',
  color: '#6EE7B7',
};

export default function LoadingPointsPage() {
  const [rows, setRows] = useState<LoadingPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [kindFilter, setKindFilter] = useState<'all' | LoadingPointKind>('all');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<LoadingPoint | null>(null);
  const [form, setForm] = useState(emptyForm);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/adminCifra/loading-points?active=0', {
        headers: adminCifraAuthHeaders(),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        await appAlert(
          (data as any)?.error || 'Не удалось загрузить точки погрузки',
          { title: 'Ошибка', variant: 'danger' },
        );
        return;
      }
      setRows(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
      await appAlert('Ошибка соединения при загрузке точек', { title: 'Ошибка', variant: 'danger' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const filtered = rows.filter((r) => kindFilter === 'all' || r.kind === kindFilter);

  const openAdd = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowModal(true);
  };

  const openEdit = (p: LoadingPoint) => {
    setEditing(p);
    setForm({
      name: p.name,
      kind: p.kind,
      ownership: p.ownership,
      address: p.address || '',
      lat: p.lat ?? '',
      lon: p.lon ?? '',
      is_default: Boolean(p.is_default),
      active: p.active !== false,
      notes: p.notes || '',
    });
    setShowModal(true);
  };

  const save = async () => {
    if (!form.name.trim()) {
      await appAlert('Укажите название', { title: 'Ошибка', variant: 'danger' });
      return;
    }
    const payload = {
      ...(editing ? { id: editing.id } : {}),
      ...form,
      lat: form.lat === '' ? null : Number(form.lat),
      lon: form.lon === '' ? null : Number(form.lon),
    };
    const res = await fetch('/api/adminCifra/loading-points', {
      method: 'POST',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      await appAlert(json.error || 'Ошибка сохранения. Выполните scripts/loading-points.sql', {
        title: 'Ошибка',
        variant: 'danger',
      });
      return;
    }
    setShowModal(false);
    load();
  };

  const deactivate = async (id: number) => {
    if (
      !(await appConfirm('Скрыть точку погрузки?', {
        title: 'Скрыть точку',
        okLabel: 'Скрыть',
        cancelLabel: 'Отмена',
        variant: 'warning',
      }))
    ) {
      return;
    }
    const res = await fetch(`/api/adminCifra/loading-points?id=${id}`, {
      method: 'DELETE',
      headers: adminCifraAuthHeaders(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      await appAlert(json.error || 'Не удалось скрыть точку', { title: 'Ошибка', variant: 'danger' });
      return;
    }
    load();
  };

  const restore = async (p: LoadingPoint) => {
    const res = await fetch('/api/adminCifra/loading-points', {
      method: 'POST',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        id: p.id,
        name: p.name,
        kind: p.kind,
        ownership: p.ownership,
        address: p.address,
        lat: p.lat,
        lon: p.lon,
        is_default: Boolean(p.is_default),
        active: true,
        notes: p.notes,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      await appAlert(json.error || 'Не удалось восстановить', { title: 'Ошибка', variant: 'danger' });
      return;
    }
    load();
  };

  const inputStyle = modalFieldStyle({ width: '100%', marginBottom: 12 });

  return (
    <div style={{ color: '#fff', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 12, flexWrap: 'wrap', flexShrink: 0 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <MapPin size={26} color="#94A3B8" />
          Точки погрузки
        </h1>
        <button
          type="button"
          onClick={openAdd}
          style={volumeCardSoftStyle({
            padding: '10px 22px',
            background: 'linear-gradient(165deg, #10B981 0%, #059669 100%)',
            border: '1px solid rgba(110,231,183,0.35)',
            borderRadius: 12,
            color: 'white',
            fontWeight: 700,
            cursor: 'pointer',
          })}
        >
          + Добавить точку
        </button>
      </div>

      <div
        style={{
          display: 'flex',
          gap: 22,
          marginBottom: 14,
          borderBottom: '1px solid #334155',
          paddingBottom: 6,
          flexShrink: 0,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {([{ key: 'all', label: 'Все' }, ...LOADING_POINT_KINDS] as const).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setKindFilter(t.key as any)}
            style={{
              padding: '10px 0',
              background: 'transparent',
              border: 'none',
              color: kindFilter === t.key ? '#10B981' : '#64748B',
              fontWeight: 600,
              fontSize: 16,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="scroll-hidden" style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {loading ? (
          <div style={{ color: '#94A3B8', padding: 40, textAlign: 'center' }}>Загрузка…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: '#64748B', padding: 40, textAlign: 'center' }}>
            Точек нет. Выполните <code>scripts/loading-points.sql</code> в Supabase или добавьте вручную.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 12,
              alignContent: 'start',
            }}
          >
            {filtered.map((p) => {
              const isHidden = p.active === false;
              return (
                <div
                  key={p.id}
                  style={volumeCardStyle({
                    borderRadius: 16,
                    padding: 16,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    opacity: isHidden ? 0.72 : 1,
                    minHeight: 0,
                  })}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div
                      style={{
                        fontWeight: 700,
                        fontSize: 17,
                        lineHeight: 1.3,
                        minWidth: 0,
                        overflowWrap: 'anywhere',
                      }}
                    >
                      {p.name}
                    </div>
                    <span style={ownershipPillStyle(p.ownership)}>
                      {loadingPointOwnershipLabel(p.ownership)}
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <span style={metaPillStyle('muted')}>{loadingPointKindLabel(p.kind)}</span>
                    {p.is_default ? <span style={metaPillStyle('default')}>по умолчанию</span> : null}
                    {isHidden ? <span style={metaPillStyle('hidden')}>скрыта</span> : null}
                  </div>

                  <div style={{ color: '#CBD5E1', fontSize: 14, lineHeight: 1.4, overflowWrap: 'anywhere' }}>
                    {p.address || 'Адрес не указан'}
                  </div>
                  {p.lat != null && p.lon != null ? (
                    <div style={{ color: '#64748B', fontSize: 12 }}>
                      {Number(p.lat).toFixed(5)}, {Number(p.lon).toFixed(5)}
                    </div>
                  ) : null}

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 'auto', paddingTop: 4 }}>
                    <button type="button" onClick={() => openEdit(p)} style={editBtnStyle}>
                      Редактировать
                    </button>
                    {isHidden ? (
                      <button type="button" onClick={() => restore(p)} style={restoreBtnStyle}>
                        Восстановить
                      </button>
                    ) : (
                      <button type="button" onClick={() => deactivate(p.id)} style={hideBtnStyle}>
                        Скрыть
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => setShowModal(false)}>
          <div className="scroll-hidden" style={volumeModalStyle({ width: '100%', maxWidth: 520, maxHeight: '90vh', overflowY: 'auto', borderRadius: 22, padding: 28 })} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginBottom: 20 }}>{editing ? 'Редактировать точку' : 'Новая точка погрузки'}</h2>
            <input style={inputStyle} placeholder="Название *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div style={{ marginBottom: 12 }}>
              <ModalSelect
                value={form.kind}
                onChange={(v) => setForm({ ...form, kind: v as LoadingPointKind })}
                options={LOADING_POINT_KINDS.map((k) => ({ value: k.key, label: k.label }))}
              />
            </div>
            <div style={{ marginBottom: 12 }}>
              <ModalSelect
                value={form.ownership}
                onChange={(v) => setForm({ ...form, ownership: v as LoadingPointOwnership })}
                options={[
                  { value: 'own', label: 'Своя' },
                  { value: 'partner', label: 'Партнёрская (чужой завод / наш бренд)' },
                ]}
              />
            </div>
            <input style={inputStyle} placeholder="Адрес" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 10,
              }}
            >
              <input style={{ ...inputStyle, marginBottom: 0 }} type="number" step="any" placeholder="Широта" value={form.lat} onChange={(e) => setForm({ ...form, lat: e.target.value === '' ? '' : Number(e.target.value) })} />
              <input style={{ ...inputStyle, marginBottom: 0 }} type="number" step="any" placeholder="Долгота" value={form.lon} onChange={(e) => setForm({ ...form, lon: e.target.value === '' ? '' : Number(e.target.value) })} />
            </div>
            <div style={{ height: 12 }} />
            <textarea style={{ ...inputStyle, minHeight: 70, resize: 'vertical' }} placeholder="Заметки" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 16, color: '#CBD5E1', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} />
              Точка по умолчанию для своего kind
            </label>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 20, color: '#CBD5E1', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
              Активна
            </label>
            <div style={{ display: 'flex', gap: 12 }}>
              <button type="button" onClick={() => setShowModal(false)} style={volumeCardSoftStyle({ flex: 1, padding: 14, borderRadius: 9999, color: '#fff', cursor: 'pointer' })}>Отмена</button>
              <button type="button" onClick={save} style={{ flex: 1, padding: 14, background: '#10B981', borderRadius: 9999, color: '#fff', border: 'none', fontWeight: 700, cursor: 'pointer' }}>Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
