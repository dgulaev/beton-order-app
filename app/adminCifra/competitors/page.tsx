'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Store, RefreshCw } from 'lucide-react';
import {
  CARD_GRADIENT_SOFT,
  modalFieldStyle,
  volumeCardSoftStyle,
  volumeCardStyle,
  volumeModalStyle,
} from '../cardStyles';
import ModalSelect from '../components/ModalSelect';
import { appAlert, appConfirm } from '../components/appDialog';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import {
  COMPETITOR_MATRIX_GRADES,
  FILLER_LABELS,
  deltaColor,
  priceDelta,
  type Competitor,
  type CompetitorFiller,
  type MatrixColumn,
} from '@/lib/competitors';
import { resolveCompetitorPriceUrl } from '@/lib/competitorsCatalog';
import { buildCompetitorsAnalytics } from '@/lib/competitorsAnalytics';
import CompetitorsAnalyticsPanel from './CompetitorsAnalytics';

type Tab = 'matrix' | 'analytics' | 'grades' | 'list';

type EditCell = {
  competitorId: number;
  grade_key: string;
  filler: CompetitorFiller;
};

export default function CompetitorsPage() {
  const [tab, setTab] = useState<Tab>('matrix');
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  const [snapshots, setSnapshots] = useState<any[]>([]);
  const [ours, setOurs] = useState<Record<string, number>>({});
  const [columns, setColumns] = useState<MatrixColumn[]>(COMPETITOR_MATRIX_GRADES);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncLog, setSyncLog] = useState<string | null>(null);
  const [editCell, setEditCell] = useState<EditCell | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [savingCellKey, setSavingCellKey] = useState<string | null>(null);
  const skipBlurCommitRef = useRef(false);
  const editCellRef = useRef<EditCell | null>(null);
  const editDraftRef = useRef('');
  editCellRef.current = editCell;
  editDraftRef.current = editDraft;
  const [showEdit, setShowEdit] = useState(false);
  const [editing, setEditing] = useState<Competitor | null>(null);
  const [form, setForm] = useState({
    name: '',
    short_name: '',
    website: '',
    phone: '',
    address: '',
    lat: '',
    lon: '',
    notes: '',
    parser_key: '',
    active: true,
  });
  const [priceForm, setPriceForm] = useState({
    competitor_id: '',
    grade_key: 'М300',
    filler: 'granite' as CompetitorFiller,
    price: '',
  });
  const [gradeForm, setGradeForm] = useState({
    grade: '',
    filler: 'granite' as CompetitorFiller,
  });
  const [savingGrade, setSavingGrade] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const hdr = adminCifraAuthHeaders();
      const [cRes, pRes, colRes] = await Promise.all([
        fetch('/api/adminCifra/competitors?active=0', { headers: hdr }),
        fetch('/api/adminCifra/competitors/prices', { headers: hdr }),
        fetch('/api/adminCifra/competitors/columns', { headers: hdr }),
      ]);
      if (!cRes.ok || !pRes.ok || !colRes.ok) {
        const errBody = await (cRes.ok ? (pRes.ok ? colRes : pRes) : cRes).json().catch(() => ({}));
        await appAlert(
          (errBody as any)?.error || 'Не удалось загрузить данные конкурентов',
          { title: 'Ошибка', variant: 'danger' },
        );
        return;
      }
      const cData = await cRes.json();
      const pData = await pRes.json();
      const colData = await colRes.json();
      setCompetitors(Array.isArray(cData) ? cData : []);
      setSnapshots(Array.isArray(pData?.snapshots) ? pData.snapshots : []);
      setOurs(pData?.ours && typeof pData.ours === 'object' ? pData.ours : {});
      const cols: MatrixColumn[] = Array.isArray(colData)
        ? colData
        : Array.isArray(pData?.columns)
          ? pData.columns
          : COMPETITOR_MATRIX_GRADES;
      setColumns(cols.length ? cols : COMPETITOR_MATRIX_GRADES);
    } catch (e) {
      console.error(e);
      await appAlert('Ошибка соединения при загрузке конкурентов', {
        title: 'Ошибка',
        variant: 'danger',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const priceMap = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const s of snapshots) {
      m.set(`${s.competitor_id}|${s.grade_key}|${s.filler}`, s.price == null ? null : Number(s.price));
    }
    return m;
  }, [snapshots]);

  const activeCompetitors = competitors.filter((c) => c.active !== false);
  const colCount = columns.length + 1;

  const analytics = useMemo(
    () =>
      buildCompetitorsAnalytics({
        competitors: competitors.filter((c) => c.active !== false),
        columns,
        priceMap,
        ours,
      }),
    [competitors, columns, priceMap, ours]
  );

  const openNewCompetitor = () => {
    setEditing(null);
    setForm({
      name: '',
      short_name: '',
      website: '',
      phone: '',
      address: '',
      lat: '',
      lon: '',
      notes: '',
      parser_key: '',
      active: true,
    });
    setShowEdit(true);
  };

  const openEditCompetitor = (c: Competitor) => {
    setEditing(c);
    setForm({
      name: c.name,
      short_name: c.short_name || '',
      website: c.website || '',
      phone: c.phone || '',
      address: c.address || '',
      lat: c.lat != null ? String(c.lat) : '',
      lon: c.lon != null ? String(c.lon) : '',
      notes: c.notes || '',
      parser_key: c.parser_key || '',
      active: c.active !== false,
    });
    setShowEdit(true);
  };

  const runSync = async () => {
    setSyncing(true);
    setSyncLog(null);
    try {
      const res = await fetch('/api/adminCifra/competitors/sync', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ parsePrices: true }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSyncLog(json.error || 'Ошибка синхронизации');
        return;
      }
      const parsedOk = (json.parseResults || []).filter((r: any) => (r.rows?.length || 0) > 0).length;
      const parsedFail = (json.parseResults || []).filter((r: any) => r.error).length;
      setSyncLog(
        `Карточек: ${json.competitorsUpserted}, точек погрузки: ${json.loadingPointsUpserted}, ` +
          `цен записано: ${json.pricesInserted}, парсеров ок: ${parsedOk}, с ошибкой: ${parsedFail}` +
          (json.errors?.length ? `. Замечания: ${json.errors.slice(0, 3).join('; ')}` : '')
      );
      await load();
    } catch (e) {
      setSyncLog(e instanceof Error ? e.message : 'Ошибка сети');
    } finally {
      setSyncing(false);
    }
  };

  const saveCompetitor = async () => {
    if (!form.name.trim()) {
      await appAlert('Название обязательно', { title: 'Ошибка', variant: 'danger' });
      return;
    }
    const res = await fetch('/api/adminCifra/competitors', {
      method: 'POST',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        ...(editing ? { id: editing.id } : {}),
        name: form.name,
        short_name: form.short_name || null,
        website: form.website || null,
        phone: form.phone || null,
        address: form.address || null,
        lat: form.lat === '' ? null : form.lat,
        lon: form.lon === '' ? null : form.lon,
        notes: form.notes || null,
        parser_key: form.parser_key || null,
        active: form.active,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      await appAlert(json.error || 'Ошибка. Выполните scripts/competitors.sql', {
        title: 'Ошибка',
        variant: 'danger',
      });
      return;
    }
    setShowEdit(false);
    load();
  };

  const softDeleteCompetitor = async (c: Competitor) => {
    if (
      !(await appConfirm(`Скрыть «${c.name}» из матрицы?`, {
        title: 'Скрыть конкурента',
        okLabel: 'Скрыть',
        cancelLabel: 'Отмена',
        variant: 'warning',
      }))
    ) {
      return;
    }
    const res = await fetch(`/api/adminCifra/competitors?id=${c.id}`, {
      method: 'DELETE',
      headers: adminCifraAuthHeaders(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      await appAlert(json.error || 'Не удалось скрыть', { title: 'Ошибка', variant: 'danger' });
      return;
    }
    load();
  };

  const restoreCompetitor = async (c: Competitor) => {
    const res = await fetch('/api/adminCifra/competitors', {
      method: 'POST',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        id: c.id,
        name: c.name,
        short_name: c.short_name,
        website: c.website,
        phone: c.phone,
        address: c.address,
        lat: c.lat,
        lon: c.lon,
        notes: c.notes,
        parser_key: c.parser_key,
        sort_order: c.sort_order,
        active: true,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      await appAlert(json.error || 'Не удалось восстановить', { title: 'Ошибка', variant: 'danger' });
      return;
    }
    load();
  };

  const hardDeleteCompetitor = async (c: Competitor) => {
    if (
      !(await appConfirm(
        `Удалить «${c.name}» навсегда вместе с ценами? Это нельзя отменить.`,
        {
          title: 'Удаление',
          okLabel: 'Удалить',
          cancelLabel: 'Отмена',
          variant: 'danger',
        },
      ))
    ) {
      return;
    }
    const res = await fetch(`/api/adminCifra/competitors?id=${c.id}&hard=1`, {
      method: 'DELETE',
      headers: adminCifraAuthHeaders(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      await appAlert(json.error || 'Не удалось удалить', { title: 'Ошибка', variant: 'danger' });
      return;
    }
    load();
  };

  const savePrice = async () => {
    if (!priceForm.competitor_id) {
      await appAlert('Выберите конкурента', { title: 'Ошибка', variant: 'danger' });
      return;
    }
    const res = await fetch('/api/adminCifra/competitors/prices', {
      method: 'POST',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        competitor_id: Number(priceForm.competitor_id),
        grade_key: priceForm.grade_key,
        filler: priceForm.filler,
        price: priceForm.price === '' ? null : Number(priceForm.price),
        source_kind: 'manual',
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      await appAlert(json.error || 'Ошибка сохранения цены', { title: 'Ошибка', variant: 'danger' });
      return;
    }
    setPriceForm((p) => ({ ...p, price: '' }));
    load();
  };

  const cellKeyOf = (competitorId: number, grade_key: string, filler: CompetitorFiller) =>
    `${competitorId}|${grade_key}|${filler}`;

  const beginCellEdit = (
    competitorId: number,
    grade_key: string,
    filler: CompetitorFiller,
    current: number | null | undefined
  ) => {
    setEditCell({ competitorId, grade_key, filler });
    setEditDraft(current != null && Number.isFinite(current) ? String(Math.round(current)) : '');
  };

  const cancelCellEdit = () => {
    setEditCell(null);
    setEditDraft('');
  };

  const commitCellEdit = async () => {
    if (skipBlurCommitRef.current) {
      skipBlurCommitRef.current = false;
      return;
    }
    const cell = editCellRef.current;
    if (!cell) return;
    const { competitorId, grade_key, filler } = cell;
    const key = cellKeyOf(competitorId, grade_key, filler);
    const trimmed = editDraftRef.current.trim().replace(/\s/g, '').replace(',', '.');
    const price = trimmed === '' || trimmed === '-' ? null : Number(trimmed);
    if (price != null && (!Number.isFinite(price) || price < 0 || price > 100000)) {
      await appAlert('Укажи цену числом (₽) или очисти поле', {
        title: 'Ошибка',
        variant: 'danger',
      });
      return;
    }
    const prev = priceMap.get(key);
    if (
      (prev == null && price == null) ||
      (prev != null && price != null && Math.round(prev) === Math.round(price))
    ) {
      cancelCellEdit();
      return;
    }

    setSavingCellKey(key);
    cancelCellEdit();
    try {
      const res = await fetch('/api/adminCifra/competitors/prices', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          competitor_id: competitorId,
          grade_key,
          filler,
          price,
          source_kind: 'manual',
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        await appAlert(json.error || 'Не удалось сохранить цену', {
          title: 'Ошибка',
          variant: 'danger',
        });
        await load();
        return;
      }
      setSnapshots((prevSnaps) => {
        const filtered = prevSnaps.filter(
          (s) =>
            !(
              Number(s.competitor_id) === competitorId &&
              s.grade_key === grade_key &&
              s.filler === filler
            )
        );
        return [
          {
            competitor_id: competitorId,
            grade_key,
            filler,
            price,
            parsed_at: new Date().toISOString(),
            source_kind: 'manual',
          },
          ...filtered,
        ];
      });
    } finally {
      setSavingCellKey(null);
    }
  };

  const addGrade = async () => {
    if (!gradeForm.grade.trim()) {
      await appAlert('Укажите марку, например 450 или М450', {
        title: 'Ошибка',
        variant: 'danger',
      });
      return;
    }
    setSavingGrade(true);
    try {
      const res = await fetch('/api/adminCifra/competitors/columns', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ grade: gradeForm.grade, filler: gradeForm.filler }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        await appAlert(
          json.error || 'Не удалось добавить марку. Выполните scripts/competitors.sql',
          { title: 'Ошибка', variant: 'danger' },
        );
        return;
      }
      setGradeForm((g) => ({ ...g, grade: '' }));
      await load();
    } finally {
      setSavingGrade(false);
    }
  };

  const deleteGrade = async (col: MatrixColumn) => {
    if (!col.id) {
      await appAlert('Сначала выполните scripts/competitors.sql — колонки ещё не в БД', {
        title: 'Ошибка',
        variant: 'danger',
      });
      return;
    }
    if (
      !(await appConfirm(`Убрать колонку «${col.label}» из матрицы?`, {
        title: 'Удаление марки',
        okLabel: 'Убрать',
        cancelLabel: 'Отмена',
        variant: 'warning',
      }))
    ) {
      return;
    }
    const res = await fetch(`/api/adminCifra/competitors/columns?id=${col.id}`, {
      method: 'DELETE',
      headers: adminCifraAuthHeaders(),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      await appAlert(json.error || 'Не удалось удалить', { title: 'Ошибка', variant: 'danger' });
      return;
    }
    load();
  };

  const inputStyle = modalFieldStyle({ width: '100%', marginBottom: 12 });

  return (
    <div
      style={{
        color: '#fff',
        flex: 1,
        minHeight: 0,
        width: '100%',
        maxWidth: '100%',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 10,
          gap: 12,
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        <h1 style={{ fontSize: 26, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Store size={26} color="#94A3B8" />
          Конкуренты
        </h1>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={runSync}
            disabled={syncing}
            style={volumeCardSoftStyle({
              padding: '10px 18px',
              borderRadius: 12,
              color: '#E2E8F0',
              fontWeight: 700,
              cursor: syncing ? 'wait' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              opacity: syncing ? 0.7 : 1,
            })}
            title="Обновить карточки, координаты точек погрузки и спарсить прайсы с сайтов"
          >
            <RefreshCw size={16} />
            {syncing ? 'Обновляем…' : 'Обновить прайсы'}
          </button>
          <button
            type="button"
            onClick={openNewCompetitor}
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
            + Конкурент
          </button>
        </div>
      </div>

      {syncLog && (
        <div
          style={{
            flexShrink: 0,
            marginBottom: 10,
            padding: '8px 12px',
            borderRadius: 10,
            background: 'rgba(96,165,250,0.12)',
            color: '#93C5FD',
            fontSize: 13,
          }}
        >
          {syncLog}
        </div>
      )}

      <div
        style={{
          display: 'flex',
          gap: 22,
          marginBottom: 12,
          borderBottom: '1px solid #334155',
          paddingBottom: 6,
          flexShrink: 0,
          overflowX: 'auto',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {(
          [
            { key: 'matrix' as const, label: 'Матрица цен' },
            { key: 'analytics' as const, label: 'Аналитика' },
            { key: 'grades' as const, label: 'Марки' },
            { key: 'list' as const, label: 'Справочник' },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: '10px 0',
              background: 'transparent',
              border: 'none',
              fontSize: 16,
              fontWeight: 600,
              color: tab === t.key ? '#10B981' : '#64748B',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: '#94A3B8', padding: 40, textAlign: 'center' }}>Загрузка…</div>
      ) : tab === 'analytics' ? (
        <div
          className="scroll-hidden"
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            width: '100%',
            boxSizing: 'border-box',
            borderRadius: 16,
            border: '1px solid rgba(148, 163, 184, 0.28)',
            background: CARD_GRADIENT_SOFT,
            padding: '16px 18px 20px',
          }}
        >
          <CompetitorsAnalyticsPanel data={analytics} />
        </div>
      ) : tab === 'grades' ? (
        <div
          className="scroll-hidden"
          style={{ flex: 1, overflowY: 'auto', width: '100%', display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <div style={volumeCardSoftStyle({ borderRadius: 14, padding: 16 })}>
            <div style={{ fontWeight: 700, marginBottom: 10, color: '#CBD5E1' }}>Добавить марку в матрицу</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
              <input
                placeholder="Марка: 450 или М450"
                value={gradeForm.grade}
                onChange={(e) => setGradeForm((g) => ({ ...g, grade: e.target.value }))}
                style={modalFieldStyle({ width: 180, marginBottom: 0 })}
              />
              <div style={{ minWidth: 200, flex: '1 1 200px' }}>
                <ModalSelect
                  value={gradeForm.filler}
                  onChange={(v) => setGradeForm((g) => ({ ...g, filler: v as CompetitorFiller }))}
                  options={[
                    { value: 'granite', label: 'Гранит (М…)' },
                    { value: 'dolomite', label: 'Известняк / доломит (М…и)' },
                    { value: 'mortar', label: 'Раствор (ТР М…)' },
                  ]}
                />
              </div>
              <button
                type="button"
                onClick={addGrade}
                disabled={savingGrade}
                style={{
                  padding: '10px 18px',
                  background: '#10B981',
                  border: 'none',
                  borderRadius: 10,
                  color: '#fff',
                  fontWeight: 700,
                  cursor: savingGrade ? 'wait' : 'pointer',
                  opacity: savingGrade ? 0.7 : 1,
                }}
              >
                Добавить
              </button>
            </div>
            <div style={{ color: '#64748B', fontSize: 12, marginTop: 10 }}>
              Подпись сформируется сама: гранит → М450, известняк → М450и, раствор → ТР М450. Нужна таблица из{' '}
              <code>scripts/competitors.sql</code>.
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 10 }}>
            {columns.map((col) => (
              <div key={`${col.id ?? 'x'}-${col.grade_key}-${col.filler}`} style={volumeCardStyle({ borderRadius: 14, padding: 14 })}>
                <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 4 }}>{col.label}</div>
                <div style={{ color: '#94A3B8', fontSize: 13, marginBottom: 10 }}>
                  {FILLER_LABELS[col.filler]} · наш код {col.ourCode}
                </div>
                <button
                  type="button"
                  onClick={() => deleteGrade(col)}
                  style={{
                    width: '100%',
                    padding: 8,
                    borderRadius: 10,
                    border: '1px solid rgba(248,113,113,0.35)',
                    background: 'rgba(127,29,29,0.35)',
                    color: '#FCA5A5',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  Удалить из матрицы
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : tab === 'list' ? (
        <div
          className="scroll-hidden"
          style={{
            flex: 1,
            overflowY: 'auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 12,
            alignContent: 'start',
            width: '100%',
          }}
        >
          {competitors.length === 0 ? (
            <div style={{ color: '#64748B', gridColumn: '1 / -1', textAlign: 'center', padding: 40 }}>
              Пусто. Нажми «+ Конкурент» или «Обновить прайсы».
            </div>
          ) : (
            competitors.map((c) => (
              <div key={c.id} style={volumeCardStyle({ borderRadius: 16, padding: 16, opacity: c.active === false ? 0.72 : 1 })}>
                <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 6 }}>{c.name}</div>
                <div style={{ color: '#94A3B8', fontSize: 13, marginBottom: 6 }}>
                  {c.active === false ? 'Скрыт' : 'Активен'}
                  {c.parser_key ? ` · парсер: ${c.parser_key}` : ' · вручную'}
                </div>
                {c.address && <div style={{ color: '#CBD5E1', fontSize: 13, marginBottom: 4 }}>{c.address}</div>}
                {c.lat != null && c.lon != null && (
                  <div style={{ color: '#64748B', fontSize: 12, marginBottom: 6 }}>
                    {Number(c.lat).toFixed(5)}, {Number(c.lon).toFixed(5)}
                  </div>
                )}
                {c.website && (
                  <a
                    href={c.website}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#60A5FA', fontSize: 13, marginBottom: 8, display: 'block', wordBreak: 'break-all' }}
                  >
                    {c.website}
                  </a>
                )}
                {c.phone && <div style={{ color: '#94A3B8', fontSize: 13, marginBottom: 8 }}>{c.phone}</div>}
                {c.notes && <div style={{ color: '#64748B', fontSize: 12, marginBottom: 10 }}>{c.notes}</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => openEditCompetitor(c)}
                    style={{
                      width: '100%',
                      padding: 8,
                      borderRadius: 10,
                      border: 'none',
                      background: '#334155',
                      color: '#E2E8F0',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    Редактировать
                  </button>
                  {c.active === false ? (
                    <button
                      type="button"
                      onClick={() => restoreCompetitor(c)}
                      style={{
                        width: '100%',
                        padding: 8,
                        borderRadius: 10,
                        border: 'none',
                        background: 'rgba(16,185,129,0.25)',
                        color: '#6EE7B7',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      Восстановить
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => softDeleteCompetitor(c)}
                      style={{
                        width: '100%',
                        padding: 8,
                        borderRadius: 10,
                        border: '1px solid rgba(251,191,36,0.35)',
                        background: 'rgba(120,53,15,0.35)',
                        color: '#FCD34D',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      Скрыть
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => hardDeleteCompetitor(c)}
                    style={{
                      width: '100%',
                      padding: 8,
                      borderRadius: 10,
                      border: '1px solid rgba(248,113,113,0.35)',
                      background: 'rgba(127,29,29,0.35)',
                      color: '#FCA5A5',
                      cursor: 'pointer',
                      fontWeight: 600,
                    }}
                  >
                    Удалить навсегда
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            borderRadius: 16,
            border: '1px solid rgba(148, 163, 184, 0.28)',
            background: 'linear-gradient(165deg, #1E2937 0%, #0F172A 100%)',
            boxSizing: 'border-box',
          }}
        >
          {/* Ввод цены — фиксирован */}
          <div
            style={{
              flexShrink: 0,
              padding: '12px 14px',
              borderBottom: '1px solid #334155',
              boxSizing: 'border-box',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8, color: '#CBD5E1', fontSize: 14 }}>
              Ввод цены конкурента
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
              <div style={{ minWidth: 180, flex: '1 1 180px' }}>
                <ModalSelect
                  value={priceForm.competitor_id}
                  onChange={(v) => setPriceForm((p) => ({ ...p, competitor_id: v }))}
                  options={activeCompetitors.map((c) => ({
                    value: String(c.id),
                    label: c.short_name || c.name,
                  }))}
                  placeholder="Конкурент"
                />
              </div>
              <div style={{ minWidth: 140, flex: '0 1 160px' }}>
                <ModalSelect
                  value={`${priceForm.grade_key}|${priceForm.filler}`}
                  onChange={(v) => {
                    const [grade_key, filler] = v.split('|');
                    setPriceForm((p) => ({ ...p, grade_key, filler: filler as CompetitorFiller }));
                  }}
                  options={columns.map((g) => ({
                    value: `${g.grade_key}|${g.filler}`,
                    label: g.label,
                  }))}
                />
              </div>
              <input
                type="number"
                placeholder="Цена ₽"
                value={priceForm.price}
                onChange={(e) => setPriceForm((p) => ({ ...p, price: e.target.value }))}
                style={modalFieldStyle({ width: 110, marginBottom: 0, flex: '0 0 110px' })}
              />
              <button
                type="button"
                onClick={savePrice}
                style={{
                  padding: '10px 18px',
                  background: '#10B981',
                  border: 'none',
                  borderRadius: 10,
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Сохранить
              </button>
            </div>
          </div>

          {/* Матрица — на всю высоту панели (аналитика вынесена во вкладку) */}
          <div
            className="scroll-hidden"
            style={{
              flex: 1,
              minHeight: 0,
              width: '100%',
              overflow: 'auto',
              WebkitOverflowScrolling: 'touch',
              background: '#0F172A',
            }}
          >
            <table
              style={{
                borderCollapse: 'separate',
                borderSpacing: 0,
                width: '100%',
                minWidth: 160 + columns.length * 96,
                tableLayout: 'fixed',
                fontSize: 15,
              }}
            >
              <colgroup>
                <col style={{ width: 160 }} />
                {columns.map((g) => (
                  <col key={`col-${g.grade_key}-${g.filler}`} style={{ width: 96 }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ ...thStyle, position: 'sticky', left: 0, zIndex: 3, minWidth: 160 }}>
                    Завод
                  </th>
                  {columns.map((g) => (
                    <th key={`${g.grade_key}-${g.filler}`} style={thStyle}>
                      {g.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{ ...tdSticky, fontWeight: 700, color: '#10B981', fontSize: 15 }}>
                    ТрейдКом
                  </td>
                  {columns.map((g) => {
                    const our = ours[`${g.grade_key}|${g.filler}`];
                    return (
                      <td
                        key={`ours-${g.grade_key}-${g.filler}`}
                        style={{ ...tdStyle, fontWeight: 700, fontSize: 15 }}
                      >
                        {our != null ? Math.round(our).toLocaleString('ru-RU') : '—'}
                      </td>
                    );
                  })}
                </tr>
                {activeCompetitors.map((c) => {
                  const pricePageUrl = resolveCompetitorPriceUrl(c);
                  return (
                  <tr key={c.id}>
                    <td style={{ ...tdSticky, fontSize: 14 }} title={c.name}>
                      {pricePageUrl ? (
                        <a
                          href={pricePageUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            color: '#93C5FD',
                            textDecoration: 'underline',
                            textUnderlineOffset: 3,
                            fontWeight: 700,
                          }}
                          title={`Открыть прайс: ${pricePageUrl}`}
                        >
                          {c.short_name || c.name}
                        </a>
                      ) : (
                        <span style={{ color: '#E2E8F0' }}>{c.short_name || c.name}</span>
                      )}
                    </td>
                    {columns.map((g) => {
                      const key = cellKeyOf(c.id, g.grade_key, g.filler);
                      const their = priceMap.get(key);
                      const our = ours[`${g.grade_key}|${g.filler}`];
                      const d = priceDelta(our, their ?? null);
                      const isEditing =
                        editCell?.competitorId === c.id &&
                        editCell.grade_key === g.grade_key &&
                        editCell.filler === g.filler;
                      const isSaving = savingCellKey === key;

                      if (isEditing) {
                        return (
                          <td key={key} style={{ ...tdStyle, padding: 4 }}>
                            <input
                              autoFocus
                              type="text"
                              inputMode="numeric"
                              value={editDraft}
                              disabled={isSaving}
                              onChange={(e) => setEditDraft(e.target.value)}
                              onBlur={() => {
                                void commitCellEdit();
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  (e.target as HTMLInputElement).blur();
                                }
                                if (e.key === 'Escape') {
                                  e.preventDefault();
                                  skipBlurCommitRef.current = true;
                                  cancelCellEdit();
                                }
                              }}
                              style={{
                                width: '100%',
                                maxWidth: 88,
                                margin: '0 auto',
                                display: 'block',
                                padding: '6px 4px',
                                borderRadius: 8,
                                border: '1px solid #38BDF8',
                                background: '#0F172A',
                                color: '#F8FAFC',
                                fontSize: 15,
                                fontWeight: 700,
                                textAlign: 'center',
                                outline: 'none',
                                boxSizing: 'border-box',
                              }}
                            />
                          </td>
                        );
                      }

                      return (
                        <td
                          key={key}
                          style={{
                            ...tdStyle,
                            cursor: isSaving ? 'wait' : 'pointer',
                            opacity: isSaving ? 0.55 : 1,
                          }}
                          title={
                            d != null
                              ? `Δ к нам: ${d > 0 ? '+' : ''}${d}. Клик — изменить цену`
                              : 'Клик — ввести цену'
                          }
                          onClick={() => beginCellEdit(c.id, g.grade_key, g.filler, their)}
                        >
                          <span
                            style={{
                              color: their == null ? '#475569' : '#E2E8F0',
                              fontSize: 15,
                              fontWeight: 600,
                            }}
                          >
                            {their != null ? Math.round(their).toLocaleString('ru-RU') : '—'}
                          </span>
                          {d != null && (
                            <div
                              style={{
                                color: deltaColor(d),
                                fontSize: 12,
                                marginTop: 3,
                                lineHeight: 1.15,
                                fontWeight: 600,
                              }}
                            >
                              {d > 0 ? `+${d}` : d}
                            </div>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  );
                })}
                {activeCompetitors.length === 0 && (
                  <tr>
                    <td colSpan={colCount} style={{ ...tdStyle, color: '#64748B', padding: 28 }}>
                      Нет конкурентов. Добавь в «Справочник» или нажми «Обновить прайсы».
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {showEdit && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.82)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setShowEdit(false)}
        >
          <div
            className="scroll-hidden"
            style={volumeModalStyle({
              width: '100%',
              maxWidth: 520,
              maxHeight: '90vh',
              overflowY: 'auto',
              borderRadius: 22,
              padding: 28,
            })}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: 18 }}>{editing ? 'Редактировать' : 'Новый конкурент'}</h2>
            <input
              style={inputStyle}
              placeholder="Название *"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder="Короткое имя"
              value={form.short_name}
              onChange={(e) => setForm({ ...form, short_name: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder="Сайт"
              value={form.website}
              onChange={(e) => setForm({ ...form, website: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder="Телефон"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
            <input
              style={inputStyle}
              placeholder="Адрес площадки"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            <div style={{ display: 'flex', gap: 10 }}>
              <input
                style={{ ...inputStyle, flex: 1 }}
                placeholder="Широта"
                value={form.lat}
                onChange={(e) => setForm({ ...form, lat: e.target.value })}
              />
              <input
                style={{ ...inputStyle, flex: 1 }}
                placeholder="Долгота"
                value={form.lon}
                onChange={(e) => setForm({ ...form, lon: e.target.value })}
              />
            </div>
            <input
              style={inputStyle}
              placeholder="Ключ парсера (если есть)"
              value={form.parser_key}
              onChange={(e) => setForm({ ...form, parser_key: e.target.value })}
            />
            <textarea
              style={{ ...inputStyle, minHeight: 70 }}
              placeholder="Заметки"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
            <label style={{ display: 'flex', gap: 8, marginBottom: 18, color: '#CBD5E1' }}>
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) => setForm({ ...form, active: e.target.checked })}
              />
              Активен (в матрице)
            </label>
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                type="button"
                onClick={() => setShowEdit(false)}
                style={volumeCardSoftStyle({ flex: 1, padding: 14, borderRadius: 9999, color: '#fff', cursor: 'pointer' })}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={saveCompetitor}
                style={{
                  flex: 1,
                  padding: 14,
                  background: '#10B981',
                  border: 'none',
                  borderRadius: 9999,
                  color: '#fff',
                  fontWeight: 700,
                  cursor: 'pointer',
                }}
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Полупрозрачная сетка матрицы — строки и столбцы читаются без «зебры». */
const MATRIX_GRID = '1px solid rgba(148, 163, 184, 0.28)';
const MATRIX_GRID_V = '1px solid rgba(148, 163, 184, 0.2)';

const thStyle: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 2,
  background: 'linear-gradient(180deg, #2A3649 0%, #1E2937 100%)',
  color: '#CBD5E1',
  fontWeight: 700,
  fontSize: 13,
  padding: '12px 6px',
  borderRight: MATRIX_GRID_V,
  borderBottom: '1px solid rgba(148, 163, 184, 0.42)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.1), 0 2px 6px rgba(0,0,0,0.22)',
  textAlign: 'center',
  whiteSpace: 'normal',
  lineHeight: 1.25,
  verticalAlign: 'bottom',
  boxSizing: 'border-box',
};

const tdStyle: CSSProperties = {
  padding: '12px 6px',
  background: 'linear-gradient(180deg, rgba(36,48,66,0.95) 0%, rgba(30,41,59,0.98) 100%)',
  borderRight: MATRIX_GRID_V,
  borderBottom: MATRIX_GRID,
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.05)',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  boxSizing: 'border-box',
};

const tdSticky: CSSProperties = {
  ...tdStyle,
  position: 'sticky',
  left: 0,
  zIndex: 1,
  // Непрозрачный фон — иначе при горизонтальном скролле просвечивает таблица.
  background: 'linear-gradient(90deg, #243044 0%, #1E2937 100%)',
  borderRight: '1px solid rgba(148, 163, 184, 0.38)',
  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.06), 6px 0 14px rgba(0,0,0,0.28)',
  fontWeight: 700,
  textAlign: 'left',
  paddingLeft: 14,
  paddingRight: 10,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 160,
};
