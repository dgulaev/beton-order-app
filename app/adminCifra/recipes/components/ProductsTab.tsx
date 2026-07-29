'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { COLORS, inputStyle as sharedInput, ghostButton, primaryButton, pillStyle, volumeCardStyle, volumeCardSoftStyle, volumeModalStyle } from '../labStyles';
import { useAutoRows, useAutoGrid, LabPagination } from '../pagination';
import { useEscapeClose } from '../labUtils';
import ModalSelect from '../../components/ModalSelect';
import ViewModeToggle, { LIST_GRID_OPTIONS } from '../../components/ViewModeToggle';
import { appConfirm, appPrompt } from '../../components/appDialog';
import RecipeVersionsModal from './RecipeVersionsModal';
import TemplatesModal from './TemplatesModal';
import {
  PRODUCT_SECTIONS,
  AGGREGATE_KINDS,
  CONCRETE_KINDS,
  CEMENT_PLANT_FILTERS,
  AGGREGATE_SEED,
  CEMENT_SEED,
  type ProductSection,
  type AggregateKind,
  type ConcreteKind,
  type CementPlantId,
  productSection,
  concreteKind,
  aggregateKind,
  aggregateKindLabel,
  cementPlantId,
  cementPlantLabel,
  formatProductPrice,
  priceUnit,
  isAggregate,
  isCement,
  isFbs,
} from '../productCatalog';
import {
  BYN_TO_RUB_RATE,
  BYN_TO_RUB_RATE_AS_OF,
  bynToRub,
  cementPriceRub,
  getCementPlant,
  rubToByn,
} from '@/lib/cementPlants';

interface Props {
  recipes: any[];
  loading: boolean;
  onReload: () => void;
}

function getCurrentUser() {
  if (typeof window === 'undefined') return { id: null as number | null, name: '' };
  try {
    const id = localStorage.getItem('userId');
    const cache = localStorage.getItem('userRoleCache');
    const name = cache ? (JSON.parse(cache).full_name || '') : '';
    return { id: id ? Number(id) : null, name };
  } catch {
    return { id: null, name: '' };
  }
}

const sectionBtn = (active: boolean): CSSProperties => ({
  ...ghostButton,
  padding: '7px 12px',
  background: active ? 'rgba(74,222,128,0.12)' : '#334155',
  color: active ? COLORS.accent : '#E2E8F0',
  border: active ? '1px solid rgba(74,222,128,0.45)' : '1px solid transparent',
  fontWeight: 600,
  fontSize: '13px',
});

const toolbarDivider: CSSProperties = {
  width: 1,
  alignSelf: 'stretch',
  minHeight: 28,
  background: 'rgba(148, 163, 184, 0.28)',
  flexShrink: 0,
  margin: '0 2px',
};

export default function ProductsTab({ recipes, loading, onReload }: Props) {
  const [section, setSection] = useState<ProductSection>('concrete');
  const [concreteFilter, setConcreteFilter] = useState<ConcreteKind | 'all'>('all');
  const [aggregateFilter, setAggregateFilter] = useState<AggregateKind | 'all'>('all');
  const [cementFilter, setCementFilter] = useState<CementPlantId | 'all'>('all');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('list');
  const [editing, setEditing] = useState<any>(null);
  const [changeNote, setChangeNote] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [versionsFor, setVersionsFor] = useState<any>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  // Высота карточки списка: от её верха до низа экрана минус пагинация.
  // Растягиваем список — пагинация всегда у нижнего края, без «голой» середины.
  const [listFillH, setListFillH] = useState(0);
  const PAG_RESERVE = 80; // кнопки пагинации + отступ (без скролла страницы)
  // Один групповой заголовок на странице типичен; лишний запас давал «голый» низ.
  const GROUP_RESERVE = 36;
  const ROW_GAP = 8; // зазор между объёмными строками

  useEffect(() => {
    const computeFill = () => {
      const el = listRef.current;
      if (!el || viewMode !== 'list') return;
      const rect = el.getBoundingClientRect();
      // adminCifra обёрнут в transform: scale — getBoundingClientRect в visual px,
      // а minHeight в CSS задаётся в layout px. Делим на scale, как в clients/page.
      const layoutW = el.clientWidth || el.offsetWidth;
      const scale = layoutW > 0 ? rect.width / layoutW : 1;
      const safeScale = scale > 0.1 && Number.isFinite(scale) ? scale : 1;
      const visualAvail = Math.max(280, window.innerHeight - rect.top - PAG_RESERVE);
      const layoutH = Math.max(280, Math.floor(visualAvail / safeScale));
      setListFillH((prev) => (prev === layoutH ? prev : layoutH));
    };
    computeFill();
    const t1 = setTimeout(computeFill, 60);
    const t2 = setTimeout(computeFill, 350);
    window.addEventListener('resize', computeFill);
    return () => {
      window.removeEventListener('resize', computeFill);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [section, viewMode, recipes.length, concreteFilter, aggregateFilter, cementFilter, search]);

  // Число строк: высота заполнения минус шапка и запас на группы.
  const { perPage: listPerPage } = useAutoRows(listRef, {
    reserveBottom: PAG_RESERVE + GROUP_RESERVE,
    rowGap: ROW_GAP,
    minRows: 6,
    deps: [section, viewMode, recipes.length, concreteFilter, aggregateFilter, cementFilter, listFillH],
  });
  const gridPerPage = useAutoGrid(gridRef, {
    reserveBottom: PAG_RESERVE,
    deps: [section, viewMode, recipes.length],
  });
  const inputStyle = sharedInput;

  // «Вид» широкий — длинные подписи («Щебень гранитный», «Пескоцементная смесь») без переноса.
  const LIST_COLS = '110px minmax(0, 1fr) minmax(200px, max-content) 130px 210px';

  const sectionItems = useMemo(
    () => recipes.filter((r) => productSection(r) === section),
    [recipes, section]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sectionItems
      .filter((r) => {
        if (section === 'concrete' && concreteFilter !== 'all' && concreteKind(r) !== concreteFilter) return false;
        if (section === 'aggregate' && aggregateFilter !== 'all' && aggregateKind(r) !== aggregateFilter) return false;
        if (section === 'cement' && cementFilter !== 'all' && cementPlantId(r) !== cementFilter) return false;
        if (!q) return true;
        return [r.code, r.name, r.strength_class, r.type, r.notes]
          .filter(Boolean)
          .some((v: string) => String(v).toLowerCase().includes(q));
      })
      .sort((a, b) => {
        if (section === 'aggregate') {
          const order: AggregateKind[] = ['granite', 'dolomite', 'slag', 'sand'];
          const ak = aggregateKind(a);
          const bk = aggregateKind(b);
          const ao = ak ? order.indexOf(ak) : 99;
          const bo = bk ? order.indexOf(bk) : 99;
          if (ao !== bo) return ao - bo;
        }
        if (section === 'cement') {
          const order = CEMENT_PLANT_FILTERS.map((p) => p.key);
          const ao = order.indexOf(cementPlantId(a) as CementPlantId);
          const bo = order.indexOf(cementPlantId(b) as CementPlantId);
          const ai = ao < 0 ? 99 : ao;
          const bi = bo < 0 ? 99 : bo;
          if (ai !== bi) return ai - bi;
        }
        if (section === 'concrete') {
          const order: ConcreteKind[] = ['concrete', 'mortar', 'lean', 'cps'];
          const ao = order.indexOf(concreteKind(a));
          const bo = order.indexOf(concreteKind(b));
          if (ao !== bo) return ao - bo;
        }
        return String(a.code || '').localeCompare(String(b.code || ''), 'ru');
      });
  }, [sectionItems, section, concreteFilter, aggregateFilter, cementFilter, search]);

  const perPage = viewMode === 'grid' ? gridPerPage : listPerPage;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageSafe = Math.min(page, totalPages);
  const paged = filtered.slice((pageSafe - 1) * perPage, pageSafe * perPage);

  // Сброс только при смене фильтров/секции — НЕ при пересчёте perPage
  // (иначе клик «Вперёд» меняет DOM → perPage → снова страница 1).
  useEffect(() => {
    setPage(1);
  }, [search, viewMode, section, concreteFilter, aggregateFilter, cementFilter]);

  const counts = useMemo(() => {
    const c: Record<ProductSection, number> = { concrete: 0, aggregate: 0, cement: 0, jbi: 0 };
    recipes.forEach((r) => {
      c[productSection(r)] += 1;
    });
    return c;
  }, [recipes]);

  const save = async (recipe: any) => {
    if (saving) return;
    setSaving(true);
    const user = getCurrentUser();
    const method = recipe.id ? 'PUT' : 'POST';
    const url = recipe.id ? `/api/adminCifra/recipes/${recipe.id}` : '/api/adminCifra/recipes';
    const body = recipe.id
      ? { ...recipe, changed_by: user.id, changed_by_name: user.name, change_note: changeNote || null }
      : recipe;
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        onReload();
        setEditing(null);
        setChangeNote('');
      } else {
        const errText = await res.text();
        alert(`Ошибка сохранения: ${res.status} ${errText}`);
      }
    } catch (e) {
      console.error(e);
      alert('Ошибка соединения с сервером');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id: number) => {
    if (!(await appConfirm('Удалить эту позицию?', { variant: 'danger', okLabel: 'Удалить', title: 'Удаление' }))) return;
    try {
      const res = await fetch(`/api/adminCifra/recipes?id=${id}`, { method: 'DELETE' });
      if (res.ok) onReload();
      else alert('Ошибка удаления');
    } catch {
      alert('Ошибка удаления');
    }
  };

  const missingAggregateSeed = useMemo(() => {
    const existingCodes = new Set(recipes.map((r) => String(r.code || '')));
    return AGGREGATE_SEED.filter((s) => !existingCodes.has(s.code));
  }, [recipes]);

  const missingCementSeed = useMemo(() => {
    const existingCodes = new Set(recipes.map((r) => String(r.code || '')));
    return CEMENT_SEED.filter((s) => !existingCodes.has(s.code));
  }, [recipes]);

  const seedItems = async (
    toInsert: Array<Record<string, any>>,
    opts: { confirmTitle: string; confirmText: string; nextSection: ProductSection; emptyMsg: string }
  ) => {
    if (seeding) return;
    if (toInsert.length === 0) {
      alert(opts.emptyMsg);
      return;
    }
    if (!(await appConfirm(opts.confirmText, { okLabel: 'Добавить', title: opts.confirmTitle }))) return;
    setSeeding(true);
    let done = 0;
    try {
      for (const item of toInsert) {
        const res = await fetch('/api/adminCifra/recipes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err?.error || `HTTP ${res.status} на «${item.code}» (добавлено ${done} из ${toInsert.length})`);
        }
        done += 1;
      }
      onReload();
      setSection(opts.nextSection);
    } catch (e: any) {
      onReload();
      alert(`Ошибка загрузки номенклатуры: ${e?.message || e}`);
    } finally {
      setSeeding(false);
    }
  };

  const seedAggregates = () =>
    seedItems(missingAggregateSeed, {
      confirmTitle: 'Номенклатура',
      confirmText: `Добавить ${missingAggregateSeed.length} позиций щебня и песка из прайса?`,
      nextSection: 'aggregate',
      emptyMsg: 'Все позиции из коммерческого предложения уже есть в каталоге.',
    });

  const seedCement = () =>
    seedItems(missingCementSeed, {
      confirmTitle: 'Цемент',
      confirmText: `Добавить ${missingCementSeed.length} марок цемента (Фокино, Костюковичи, Кричев)?`,
      nextSection: 'cement',
      emptyMsg: 'Все выбранные марки цемента уже есть в каталоге.',
    });

  const saveAsTemplate = async () => {
    if (!editing) return;
    const name = await appPrompt('Название шаблона:', {
      title: 'Сохранить шаблон',
      defaultValue: editing.code ? `${editing.code} шаблон` : 'Новый шаблон',
      okLabel: 'Сохранить',
    });
    if (!name?.trim()) return;
    const { id, created_at, updated_at, ...payload } = editing;
    void id;
    void created_at;
    void updated_at;
    try {
      const res = await fetch('/api/adminCifra/recipe-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, group_name: editing.group_name || null, payload }),
      });
      if (res.ok) alert('Шаблон сохранён');
    } catch {
      alert('Ошибка сохранения шаблона');
    }
  };

  const newConcrete = () =>
    setEditing({
      code: '',
      name: '',
      price: 0,
      cement: 0,
      sand: 0,
      gravel: 0,
      water: 0,
      additive: 0,
      additive2: 0,
      unit: 'м³',
      is_active: true,
      type: 'granite',
    });

  const newAggregate = () =>
    setEditing({
      code: '',
      name: '',
      price: 0,
      item_type: 'aggregate',
      type: aggregateFilter !== 'all' ? aggregateFilter : 'granite',
      unit: 'м³',
      is_active: true,
    });

  const newCement = () =>
    setEditing({
      code: '',
      name: '',
      price: 0,
      item_type: 'cement',
      type: cementFilter !== 'all' ? cementFilter : 'fokino_cemros',
      unit: 'т',
      is_active: true,
      notes: '',
    });

  /** Открыть редактирование: бел. цены (<2000) сразу в ₽. */
  const openEdit = (r: any) => {
    setChangeNote('');
    if (isCement(r)) {
      setEditing({
        ...r,
        price: cementPriceRub(Number(r.price), cementPlantId(r)),
      });
      return;
    }
    setEditing(r);
  };

  const newFbs = () =>
    setEditing({
      code: '',
      name: '',
      price: 0,
      length_cm: 240,
      width_cm: 30,
      height_cm: 60,
      unit: 'шт',
      item_type: 'fbs',
      is_active: true,
    });

  const typePill = (r: any) => {
    if (isFbs(r)) return pillStyle('rgba(99,102,241,0.15)', '#818CF8');
    if (isCement(r)) {
      const id = cementPlantId(r);
      if (id === 'fokino_cemros') return pillStyle('rgba(248,113,113,0.15)', '#F87171');
      if (id === 'kostyukovichi_bcz') return pillStyle('rgba(96,165,250,0.15)', COLORS.blue);
      if (id === 'krichev_kcsh') return pillStyle('rgba(52,211,153,0.15)', '#34D399');
      return pillStyle('rgba(148,163,184,0.18)', '#94A3B8');
    }
    if (isAggregate(r)) {
      const k = aggregateKind(r);
      if (k === 'sand') return pillStyle('rgba(251,191,36,0.15)', '#FBBF24');
      if (k === 'dolomite') return pillStyle('rgba(148,163,184,0.18)', '#94A3B8');
      if (k === 'slag') return pillStyle('rgba(100,116,139,0.25)', '#CBD5E1');
      return pillStyle('rgba(96,165,250,0.15)', COLORS.blue);
    }
    const k = concreteKind(r);
    if (k === 'mortar') return pillStyle('rgba(167,139,250,0.15)', '#A78BFA');
    if (k === 'lean') return pillStyle('rgba(251,146,60,0.15)', '#FB923C');
    if (k === 'cps') return pillStyle('rgba(45,212,191,0.15)', '#2DD4BF');
    return pillStyle('rgba(74,222,128,0.12)', COLORS.accent);
  };

  const typeLabel = (r: any) => {
    if (isFbs(r)) return 'ФБС';
    if (isCement(r)) return cementPlantLabel(r);
    if (isAggregate(r)) return aggregateKindLabel(aggregateKind(r));
    return CONCRETE_KINDS.find((k) => k.key === concreteKind(r))?.label || 'Бетон';
  };

  const groupHeaderStyle: CSSProperties = {
    padding: '2px 4px 0',
    color: COLORS.muted,
    fontSize: '12px',
    fontWeight: 700,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
  };

  // Групповые заголовки в списке (когда подряд идут позиции одной группы).
  const renderGroupHeader = (r: any, prev: any | null) => {
    if (section === 'aggregate') {
      const cur = aggregateKind(r);
      const prevK = prev ? aggregateKind(prev) : null;
      if (cur === prevK) return null;
      return (
        <div key={`g-${cur}`} data-lab-group style={groupHeaderStyle}>
          {aggregateKindLabel(cur)}
        </div>
      );
    }
    if (section === 'cement') {
      const cur = cementPlantId(r);
      const prevK = prev ? cementPlantId(prev) : null;
      if (cur === prevK) return null;
      return (
        <div key={`g-${cur}`} data-lab-group style={groupHeaderStyle}>
          {cementPlantLabel(r)}
        </div>
      );
    }
    if (section === 'concrete') {
      const cur = concreteKind(r);
      const prevK = prev ? concreteKind(prev) : null;
      if (cur === prevK) return null;
      return (
        <div key={`g-${cur}`} data-lab-group style={groupHeaderStyle}>
          {CONCRETE_KINDS.find((k) => k.key === cur)?.label}
        </div>
      );
    }
    return null;
  };

  const addBtn =
    section === 'concrete' ? (
      <button onClick={newConcrete} style={primaryButton()}>+ Позиция</button>
    ) : section === 'aggregate' ? (
      <div style={{ display: 'flex', gap: '10px' }}>
        {missingAggregateSeed.length > 0 && counts.aggregate === 0 && (
          <button onClick={seedAggregates} disabled={seeding} style={primaryButton('#3B82F6')}>
            {seeding ? 'Загрузка...' : 'Загрузить из прайса'}
          </button>
        )}
        <button onClick={newAggregate} style={primaryButton()}>+ Позиция</button>
      </div>
    ) : section === 'cement' ? (
      <div style={{ display: 'flex', gap: '10px' }}>
        {missingCementSeed.length > 0 && counts.cement === 0 && (
          <button onClick={seedCement} disabled={seeding} style={primaryButton('#3B82F6')}>
            {seeding ? 'Загрузка...' : 'Загрузить марки'}
          </button>
        )}
        <button onClick={newCement} style={primaryButton()}>+ Марка</button>
      </div>
    ) : (
      <button onClick={newFbs} style={primaryButton('#3B82F6')}>+ ФБС</button>
    );

  return (
    <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Одна компактная панель: секции · вид · фильтры · действие */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 10,
          flexWrap: 'wrap',
          flexShrink: 0,
        }}
      >
        {PRODUCT_SECTIONS.map((s) => (
          <button key={s.key} onClick={() => setSection(s.key)} style={sectionBtn(section === s.key)} title={s.hint}>
            {s.label}
            <span
              style={{
                ...pillStyle('rgba(148,163,184,0.15)', section === s.key ? COLORS.accent : COLORS.muted),
                marginLeft: 6,
                padding: '2px 8px',
                fontSize: 12,
              }}
            >
              {counts[s.key]}
            </span>
          </button>
        ))}

        <div style={toolbarDivider} aria-hidden />

        <ViewModeToggle value={viewMode} onChange={setViewMode} options={LIST_GRID_OPTIONS} />
        <input
          placeholder="Поиск по коду, названию..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ ...inputStyle, width: 220, minWidth: 160, padding: '7px 12px', flex: '1 1 180px', maxWidth: 280 }}
        />
        {section === 'concrete' && (
          <ModalSelect
            value={concreteFilter}
            onChange={(v) => setConcreteFilter(v as ConcreteKind | 'all')}
            style={{ ...inputStyle, width: 'auto', padding: '7px 12px' }}
            options={[
              { value: 'all', label: 'Все виды' },
              ...CONCRETE_KINDS.map((k) => ({ value: k.key, label: k.label })),
            ]}
          />
        )}
        {section === 'aggregate' && (
          <ModalSelect
            value={aggregateFilter}
            onChange={(v) => setAggregateFilter(v as AggregateKind | 'all')}
            style={{ ...inputStyle, width: 'auto', padding: '7px 12px' }}
            options={[
              { value: 'all', label: 'Все виды' },
              ...AGGREGATE_KINDS.map((k) => ({ value: k.key, label: k.label })),
            ]}
          />
        )}
        {section === 'cement' && (
          <ModalSelect
            value={cementFilter}
            onChange={(v) => setCementFilter(v as CementPlantId | 'all')}
            style={{ ...inputStyle, width: 'auto', padding: '7px 12px' }}
            options={[
              { value: 'all', label: 'Все заводы' },
              ...CEMENT_PLANT_FILTERS.map((k) => ({ value: k.key, label: k.label })),
            ]}
          />
        )}
        {section === 'concrete' && (
          <button onClick={() => setShowTemplates(true)} style={{ ...ghostButton, padding: '7px 12px' }}>Шаблоны</button>
        )}
        {section === 'aggregate' && missingAggregateSeed.length > 0 && counts.aggregate > 0 && (
          <button onClick={seedAggregates} disabled={seeding} style={{ ...ghostButton, padding: '7px 12px' }}>
            {seeding ? '...' : `Догрузить прайс (${missingAggregateSeed.length})`}
          </button>
        )}
        {section === 'cement' && missingCementSeed.length > 0 && counts.cement > 0 && (
          <button onClick={seedCement} disabled={seeding} style={{ ...ghostButton, padding: '7px 12px' }}>
            {seeding ? '...' : `Догрузить марки (${missingCementSeed.length})`}
          </button>
        )}

        <div style={{ marginLeft: 'auto' }}>{addBtn}</div>
      </div>

      {loading ? (
        <p style={{ color: COLORS.muted }}>Загрузка...</p>
      ) : filtered.length === 0 ? (
        <div style={{ ...volumeCardStyle({ borderRadius: 16, padding: '40px 24px', textAlign: 'center' }), color: COLORS.muted }}>
          {section === 'aggregate' && sectionItems.length === 0 ? (
            <>
              <div style={{ marginBottom: '12px', fontSize: '15px' }}>В секции «Щебень и песок» пока пусто.</div>
              <button onClick={seedAggregates} disabled={seeding} style={primaryButton('#3B82F6')}>
                {seeding ? 'Загрузка...' : 'Загрузить номенклатуру из прайса'}
              </button>
            </>
          ) : section === 'cement' && sectionItems.length === 0 ? (
            <>
              <div style={{ marginBottom: '12px', fontSize: '15px' }}>В секции «Цемент» пока пусто.</div>
              <button onClick={seedCement} disabled={seeding} style={primaryButton('#3B82F6')}>
                {seeding ? 'Загрузка...' : 'Загрузить марки с заводов'}
              </button>
            </>
          ) : section === 'aggregate' || section === 'cement' ? (
            'Нет позиций по текущему фильтру / поиску.'
          ) : (
            'Позиций нет. Добавьте первую кнопкой справа вверху.'
          )}
        </div>
      ) : viewMode === 'grid' ? (
        <div
          ref={gridRef}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 16,
            alignItems: 'stretch',
            minHeight: 0,
            overflow: 'auto',
          }}
          className="scroll-hidden"
        >
          {paged.map((r) => {
            const cardBtn: CSSProperties = {
              ...ghostButton,
              flex: 1,
              minWidth: 0,
              justifyContent: 'center',
              padding: '8px 10px',
              fontSize: 13,
              fontWeight: 600,
              borderRadius: 10,
              // Без внешней тени — иначе «вылезает» за скругление карточки.
              boxShadow: 'none',
              whiteSpace: 'nowrap',
            };
            return (
              <div
                key={r.id}
                data-lab-card
                style={volumeCardStyle({
                  borderRadius: 16,
                  padding: 16,
                  display: 'flex',
                  flexDirection: 'column',
                  minWidth: 0,
                  overflow: 'hidden',
                  opacity: r.is_active === false ? 0.6 : 1,
                })}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 8 }}>
                  <div style={{ fontSize: 20, fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.code}</div>
                  <span style={{ ...typePill(r), flexShrink: 0 }}>{typeLabel(r)}</span>
                </div>
                <div style={{ color: '#CBD5E1', fontSize: 14, marginBottom: 10, minHeight: 36, lineHeight: 1.35 }}>{r.name}</div>
                {!isFbs(r) && !isAggregate(r) && !isCement(r) && (r.strength_class || r.frost_resistance || r.water_resistance || r.slump) && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                    {r.strength_class && <span style={pillStyle('rgba(96,165,250,0.12)', COLORS.blue)}>{r.strength_class}</span>}
                    {r.frost_resistance && <span style={pillStyle('rgba(148,163,184,0.15)', COLORS.muted)}>{r.frost_resistance}</span>}
                    {r.water_resistance && <span style={pillStyle('rgba(148,163,184,0.15)', COLORS.muted)}>{r.water_resistance}</span>}
                    {r.slump && <span style={pillStyle('rgba(148,163,184,0.15)', COLORS.muted)}>{r.slump}</span>}
                  </div>
                )}
                {isFbs(r) && (
                  <div style={{ fontSize: 13, marginBottom: 10, color: '#CBD5E1' }}>
                    {r.length_cm} × {r.width_cm} × {r.height_cm} см
                  </div>
                )}
                {isCement(r) && r.notes && (
                  <div style={{ fontSize: 12, marginBottom: 10, color: COLORS.muted, lineHeight: 1.35 }}>{r.notes}</div>
                )}
                <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.blue, marginBottom: 12 }}>
                  {formatProductPrice(r)}
                  <span style={{ fontSize: 13, fontWeight: 500, color: COLORS.muted, marginLeft: 4 }}>{priceUnit(r)}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 'auto', paddingTop: 4 }}>
                  <button type="button" onClick={() => openEdit(r)} style={cardBtn}>Изм.</button>
                  {!isAggregate(r) && !isCement(r) && r.id && (
                    <button type="button" onClick={() => setVersionsFor(r)} style={cardBtn}>История</button>
                  )}
                  <button type="button" onClick={() => remove(r.id)} style={cardBtn}>Удал.</button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          ref={listRef}
          style={{
            minHeight: listFillH || undefined,
            display: 'flex',
            flexDirection: 'column',
            gap: ROW_GAP,
          }}
        >
          <div
            data-lab-head
            style={{
              display: 'grid',
              gridTemplateColumns: LIST_COLS,
              alignItems: 'center',
              columnGap: '12px',
              padding: '4px 16px 2px',
              color: '#F1F5F9',
              fontSize: '13px',
              fontWeight: 700,
              letterSpacing: '0.02em',
              flexShrink: 0,
            }}
          >
            <div style={{ whiteSpace: 'nowrap' }}>Код</div>
            <div style={{ whiteSpace: 'nowrap' }}>Название</div>
            <div style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>Вид</div>
            <div style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>Цена</div>
            <div style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>Действия</div>
          </div>
          {paged.map((r, idx) => {
            const prev = idx > 0 ? paged[idx - 1] : null;
            return (
              <div key={r.id} style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: ROW_GAP }}>
                {renderGroupHeader(r, prev)}
                <div
                  data-lab-row
                  style={volumeCardSoftStyle({
                    display: 'grid',
                    gridTemplateColumns: LIST_COLS,
                    alignItems: 'center',
                    columnGap: '12px',
                    padding: '12px 16px',
                    borderRadius: 12,
                    opacity: r.is_active === false ? 0.6 : 1,
                  })}
                >
                  <div style={{ fontWeight: 700, fontSize: '14px', whiteSpace: 'nowrap' }}>{r.code}</div>
                  <div className="lab-clamp1" style={{ color: '#CBD5E1', fontSize: '14px', minWidth: 0 }} title={r.name}>
                    {r.name}
                    {isFbs(r) && r.length_cm ? (
                      <span style={{ color: COLORS.muted, marginLeft: '8px' }}>
                        {r.length_cm}×{r.width_cm}×{r.height_cm} см
                      </span>
                    ) : null}
                  </div>
                  <div style={{ minWidth: 0, display: 'flex', justifyContent: 'center' }}>
                    <span style={{ ...typePill(r), fontSize: '13px' }}>{typeLabel(r)}</span>
                  </div>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: COLORS.blue, textAlign: 'center', whiteSpace: 'nowrap' }}>
                    {formatProductPrice(r)}
                    <span style={{ fontSize: '12px', fontWeight: 500, color: COLORS.muted, marginLeft: '2px' }}>{priceUnit(r)}</span>
                  </div>
                  <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'nowrap', whiteSpace: 'nowrap' }}>
                    <button onClick={() => openEdit(r)} style={{ ...ghostButton, padding: '6px 12px', fontSize: '13px', whiteSpace: 'nowrap' }}>Изм.</button>
                    {!isAggregate(r) && !isCement(r) && r.id && <button onClick={() => setVersionsFor(r)} style={{ ...ghostButton, padding: '6px 12px', fontSize: '13px', whiteSpace: 'nowrap' }}>История</button>}
                    <button onClick={() => remove(r.id)} style={{ ...ghostButton, padding: '6px 12px', fontSize: '13px', whiteSpace: 'nowrap' }}>Удал.</button>
                  </div>
                </div>
              </div>
            );
          })}
          {/* Распорка — пагинация не прыгает на короткой последней странице. */}
          <div style={{ flex: 1, minHeight: 0 }} aria-hidden />
        </div>
      )}

      {!loading && (
        <LabPagination
          page={pageSafe}
          totalPages={totalPages}
          onPage={setPage}
          style={{ marginTop: '10px', height: 56 }}
          reserveSpace
        />
      )}

      {editing && (
        <ProductEditModal
          item={editing}
          setItem={setEditing}
          changeNote={changeNote}
          setChangeNote={setChangeNote}
          saving={saving}
          onSave={() => save(editing)}
          onSaveAsTemplate={section === 'concrete' ? saveAsTemplate : undefined}
          onOpenTemplates={section === 'concrete' ? () => setShowTemplates(true) : undefined}
        />
      )}
      {versionsFor && <RecipeVersionsModal recipe={versionsFor} onClose={() => setVersionsFor(null)} />}
      {showTemplates && (
        <TemplatesModal
          onClose={() => setShowTemplates(false)}
          onApply={editing ? (payload: any) => setEditing((prev: any) => ({ ...prev, ...payload })) : undefined}
        />
      )}
    </div>
  );
}

/** Два поля цены цемента: Br и ₽ с взаимным пересчётом. В item/БД пишется только ₽. */
function CementDualPriceFields({
  priceRub,
  onPriceRubChange,
  inputStyle,
}: {
  priceRub: number;
  onPriceRubChange: (rub: number) => void;
  inputStyle: CSSProperties;
}) {
  const initRub = Number.isFinite(priceRub) && priceRub > 0 ? Math.round(priceRub) : 0;
  const [rubStr, setRubStr] = useState(initRub ? String(initRub) : '');
  const [bynStr, setBynStr] = useState(initRub ? String(rubToByn(initRub)) : '');

  const setFromByn = (raw: string) => {
    setBynStr(raw);
    if (raw.trim() === '') {
      setRubStr('');
      onPriceRubChange(0);
      return;
    }
    const byn = Number(raw);
    if (!Number.isFinite(byn)) return;
    const rub = bynToRub(byn);
    setRubStr(rub ? String(rub) : '');
    onPriceRubChange(rub);
  };

  const setFromRub = (raw: string) => {
    setRubStr(raw);
    if (raw.trim() === '') {
      setBynStr('');
      onPriceRubChange(0);
      return;
    }
    const rub = Number(raw);
    if (!Number.isFinite(rub)) return;
    const rubInt = rub <= 0 ? 0 : Math.round(rub);
    setBynStr(rubInt ? String(rubToByn(rubInt)) : '');
    onPriceRubChange(rubInt);
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Цена (Br/т)</label>
          <input
            type="number"
            step="0.01"
            min="0"
            value={bynStr}
            onChange={(e) => setFromByn(e.target.value)}
            placeholder="0"
            style={inputStyle}
          />
        </div>
        <div>
          <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Цена (₽/т)</label>
          <input
            type="number"
            step="1"
            min="0"
            value={rubStr}
            onChange={(e) => setFromRub(e.target.value)}
            placeholder="0"
            style={inputStyle}
          />
        </div>
      </div>
      <p style={{ color: COLORS.muted, fontSize: '12px', margin: '8px 0 0', lineHeight: 1.4 }}>
        0 = «по запросу». Курс ЦБ РФ: 1 Br = {BYN_TO_RUB_RATE} ₽ ({BYN_TO_RUB_RATE_AS_OF}).
        В каталог и таблицу сохраняется цена в ₽.
      </p>
    </div>
  );
}

function ProductEditModal({
  item,
  setItem,
  changeNote,
  setChangeNote,
  saving,
  onSave,
  onSaveAsTemplate,
  onOpenTemplates,
}: {
  item: any;
  setItem: (v: any) => void;
  changeNote: string;
  setChangeNote: (v: string) => void;
  saving: boolean;
  onSave: () => void;
  onSaveAsTemplate?: () => void;
  onOpenTemplates?: () => void;
}) {
  useEscapeClose(() => setItem(null));
  const inputStyle = sharedInput;
  const aggregate = isAggregate(item);
  const cement = isCement(item);
  const fbs = isFbs(item);
  const cementPlant = cement ? getCementPlant(item.type as CementPlantId) : undefined;
  const priceCurrencyHint = aggregate || !fbs ? '₽/м³' : `₽/${item.unit || 'шт'}`;
  const title = fbs ? 'ФБС' : cement ? 'Цемент' : aggregate ? 'Щебень / песок' : 'Бетон / раствор';

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.95)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }} onClick={() => setItem(null)}>
      <div className="scroll-hidden" style={volumeModalStyle({ padding: '28px', borderRadius: 20, width: '100%', maxWidth: '560px', maxHeight: '90vh', overflowY: 'auto' })} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '22px', margin: 0 }}>
            {item.id ? 'Редактирование' : 'Новая позиция'} — {title}
          </h2>
          {onOpenTemplates && !cement && (
            <button onClick={onOpenTemplates} style={{ ...ghostButton, padding: '6px 12px' }}>Применить шаблон</button>
          )}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Код</label>
            <input
              value={item.code || ''}
              onChange={(e) => setItem({ ...item, code: e.target.value })}
              style={inputStyle}
              placeholder={cement ? 'напр. Ц-ФОК-I-42.5Н' : aggregate ? 'напр. ЩГ-5-20' : 'напр. М300'}
            />
          </div>
          {aggregate ? (
            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Вид материала</label>
              <ModalSelect
                value={item.type || 'granite'}
                onChange={(type) => setItem({ ...item, type })}
                style={inputStyle}
                options={AGGREGATE_KINDS.map((k) => ({ value: k.key, label: k.label }))}
              />
            </div>
          ) : cement ? (
            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Завод</label>
              <ModalSelect
                value={item.type || 'fokino_cemros'}
                onChange={(type) => setItem({ ...item, type })}
                style={inputStyle}
                options={CEMENT_PLANT_FILTERS.map((k) => ({ value: k.key, label: k.label }))}
              />
            </div>
          ) : !fbs ? (
            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Тип заполнителя</label>
              <ModalSelect
                value={item.type || 'granite'}
                onChange={(type) => setItem({ ...item, type })}
                style={inputStyle}
                options={[
                  { value: 'granite', label: 'Гранит' },
                  { value: 'dolomite', label: 'Доломит' },
                ]}
              />
            </div>
          ) : (
            <div />
          )}
        </div>

        <div style={{ marginTop: '16px' }}>
          <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Название</label>
          <input
            value={item.name || ''}
            onChange={(e) => setItem({ ...item, name: e.target.value })}
            style={inputStyle}
            placeholder={cement ? 'ЦЕМ I 42,5Н' : aggregate ? 'Щебень гранитный фр. 5-20' : ''}
          />
        </div>

        {cement ? (
          <div style={{ marginTop: '16px' }}>
            <CementDualPriceFields
              key={`${item.id || 'new'}-${item.type || ''}-${item.code || ''}`}
              priceRub={Number(item.price) || 0}
              onPriceRubChange={(price) => setItem({ ...item, price })}
              inputStyle={inputStyle}
            />
            <div style={{ marginTop: '16px', maxWidth: '50%' }}>
              <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Ед. изм.</label>
              <input value={item.unit || 'т'} onChange={(e) => setItem({ ...item, unit: e.target.value })} style={inputStyle} />
            </div>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>
                Цена ({priceCurrencyHint})
              </label>
              <input type="number" step="0.01" value={item.price ?? 0} onChange={(e) => setItem({ ...item, price: Number(e.target.value) })} style={inputStyle} />
              {aggregate && (
                <p style={{ color: COLORS.muted, fontSize: '12px', margin: '6px 0 0' }}>0 = «по запросу»</p>
              )}
            </div>
            {!aggregate && (
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Группа</label>
                <input value={item.group_name || ''} onChange={(e) => setItem({ ...item, group_name: e.target.value })} placeholder="напр. Зимние" style={inputStyle} />
              </div>
            )}
            {aggregate && (
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Ед. изм.</label>
                <input value={item.unit || 'м³'} onChange={(e) => setItem({ ...item, unit: e.target.value })} style={inputStyle} />
              </div>
            )}
          </div>
        )}

        {!fbs && !aggregate && !cement && (
          <>
            <h3 style={{ margin: '24px 0 12px', color: COLORS.blue }}>Характеристики бетона</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Класс (B)</label>
                <input value={item.strength_class || ''} onChange={(e) => setItem({ ...item, strength_class: e.target.value })} placeholder="В22,5" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Морозостойкость (F)</label>
                <input value={item.frost_resistance || ''} onChange={(e) => setItem({ ...item, frost_resistance: e.target.value })} placeholder="F150" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Водонепроницаемость (W)</label>
                <input value={item.water_resistance || ''} onChange={(e) => setItem({ ...item, water_resistance: e.target.value })} placeholder="W6" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Подвижность (П)</label>
                <input value={item.slump || ''} onChange={(e) => setItem({ ...item, slump: e.target.value })} placeholder="П4" style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Марка цемента</label>
                <input value={item.cement_grade || ''} onChange={(e) => setItem({ ...item, cement_grade: e.target.value })} style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>№ номинального состава</label>
                <input value={item.mix_no || ''} onChange={(e) => setItem({ ...item, mix_no: e.target.value })} placeholder="напр. 1" style={inputStyle} />
              </div>
            </div>
          </>
        )}

        {fbs && (
          <div style={{ marginTop: '24px' }}>
            <h3 style={{ marginBottom: '12px', color: COLORS.blue }}>Размеры блока (см)</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px' }}>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Длина</label>
                <input type="number" value={item.length_cm || 0} onChange={(e) => setItem({ ...item, length_cm: Number(e.target.value) })} style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Ширина</label>
                <input type="number" value={item.width_cm || 0} onChange={(e) => setItem({ ...item, width_cm: Number(e.target.value) })} style={inputStyle} />
              </div>
              <div>
                <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Высота</label>
                <input type="number" value={item.height_cm || 0} onChange={(e) => setItem({ ...item, height_cm: Number(e.target.value) })} style={inputStyle} />
              </div>
            </div>
          </div>
        )}

        {!fbs && !aggregate && !cement && (
          <>
            <h3 style={{ margin: '24px 0 12px', color: COLORS.blue }}>Состав на 1 м³</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div><label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Цемент (кг)</label><input type="number" value={item.cement || 0} onChange={(e) => setItem({ ...item, cement: Number(e.target.value) })} style={inputStyle} /></div>
              <div><label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Песок (кг)</label><input type="number" value={item.sand || 0} onChange={(e) => setItem({ ...item, sand: Number(e.target.value) })} style={inputStyle} /></div>
              <div><label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Щебень (кг)</label><input type="number" value={item.gravel || 0} onChange={(e) => setItem({ ...item, gravel: Number(e.target.value) })} style={inputStyle} /></div>
              <div><label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Вода (кг)</label><input type="number" value={item.water || 0} onChange={(e) => setItem({ ...item, water: Number(e.target.value) })} style={inputStyle} /></div>
              <div><label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Добавка 1 (кг)</label><input type="number" value={item.additive || 0} onChange={(e) => setItem({ ...item, additive: Number(e.target.value) })} style={inputStyle} /></div>
              <div><label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Добавка 2 (кг)</label><input type="number" value={item.additive2 || 0} onChange={(e) => setItem({ ...item, additive2: Number(e.target.value) })} style={inputStyle} /></div>
            </div>
          </>
        )}

        {(aggregate || cement) && (
          <div style={{ marginTop: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted }}>Примечание</label>
            <input
              value={item.notes || ''}
              onChange={(e) => setItem({ ...item, notes: e.target.value })}
              placeholder={cement ? 'ГОСТ, источник цены, условия отгрузки' : 'напр. самовывоз с погрузкой'}
              style={inputStyle}
            />
          </div>
        )}

        {cement && cementPlant && (
          <p style={{ color: COLORS.muted, fontSize: '12px', margin: '12px 0 0', lineHeight: 1.4 }}>
            {cementPlant.legalName} · {cementPlant.lat.toFixed(5)}, {cementPlant.lon.toFixed(5)}
          </p>
        )}

        <div style={{ marginTop: '20px' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: COLORS.muted }}>
            <input type="checkbox" checked={item.is_active !== false} onChange={(e) => setItem({ ...item, is_active: e.target.checked })} style={{ width: '20px', height: '20px' }} />
            Активен
          </label>
        </div>

        {item.id && !aggregate && !cement && (
          <div style={{ marginTop: '16px' }}>
            <label style={{ display: 'block', marginBottom: '6px', color: COLORS.muted, fontSize: '14px' }}>Комментарий к изменению (в историю)</label>
            <input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="напр. скорректирован состав" style={inputStyle} />
          </div>
        )}

        <div style={{ marginTop: '28px', display: 'flex', gap: '12px' }}>
          <button
            onClick={onSave}
            disabled={saving}
            style={{ ...primaryButton(), flex: 1, justifyContent: 'center', padding: '14px', opacity: saving ? 0.6 : 1, cursor: saving ? 'default' : 'pointer' }}
          >
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          {onSaveAsTemplate && !cement && (
            <button onClick={onSaveAsTemplate} style={{ ...ghostButton, padding: '14px 18px' }}>Как шаблон</button>
          )}
          <button onClick={() => setItem(null)} style={{ ...ghostButton, padding: '14px 18px' }}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
