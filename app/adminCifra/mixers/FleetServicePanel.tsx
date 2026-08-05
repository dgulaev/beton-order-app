'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { Plus, Trash2, Wrench } from 'lucide-react';
import { adminCifraAuthHeaders } from '@/lib/adminCifraClientHeaders';
import { appConfirm } from '../components/appDialog';
import {
  SERVICE_KINDS,
  SERVICE_RECORD_STATUSES,
  computeServiceDue,
  serviceKindLabel,
  todayMoscowYmd,
  type FleetServiceRecord,
  type FleetServiceSchedule,
  type ServiceKind,
  type ServiceRecordStatus,
} from '@/lib/fleetService';

interface Props {
  mixerId: number;
  odometerKm?: number | null;
  engineHours?: number | null;
  canMutate: boolean;
  onLifecycleMaybeChanged?: () => void;
}

const fieldStyle: CSSProperties = {
  width: '100%',
  padding: '9px 12px',
  borderRadius: 10,
  border: '1px solid #334155',
  background: '#0F172A',
  color: '#E2E8F0',
  fontSize: 13,
};

function todayIso() {
  return todayMoscowYmd();
}

export default function FleetServicePanel({
  mixerId,
  odometerKm,
  engineHours,
  canMutate,
  onLifecycleMaybeChanged,
}: Props) {
  const [loading, setLoading] = useState(true);
  const [schedules, setSchedules] = useState<FleetServiceSchedule[]>([]);
  const [records, setRecords] = useState<FleetServiceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [schedKind, setSchedKind] = useState<ServiceKind>('oil_change');
  const [schedTitle, setSchedTitle] = useState('');
  const [intervalKm, setIntervalKm] = useState('10000');
  const [intervalDays, setIntervalDays] = useState('');
  const [intervalHours, setIntervalHours] = useState('');
  const [savingSched, setSavingSched] = useState(false);

  const [showRecordForm, setShowRecordForm] = useState(false);
  const [recStatus, setRecStatus] = useState<ServiceRecordStatus>('done');
  const [recDate, setRecDate] = useState(todayIso);
  const [recOdo, setRecOdo] = useState('');
  const [recDesc, setRecDesc] = useState('');
  const [recLabor, setRecLabor] = useState('');
  const [recPartsCost, setRecPartsCost] = useState('');
  const [recParts, setRecParts] = useState('');
  const [recScheduleId, setRecScheduleId] = useState('');
  const [recBy, setRecBy] = useState('');
  const [savingRec, setSavingRec] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sRes, rRes] = await Promise.all([
        fetch(`/api/adminCifra/fleet/service/schedules?mixer_id=${mixerId}`, {
          headers: adminCifraAuthHeaders(),
        }),
        fetch(`/api/adminCifra/fleet/service/records?mixer_id=${mixerId}`, {
          headers: adminCifraAuthHeaders(),
        }),
      ]);
      const sData = await sRes.json();
      const rData = await rRes.json();
      if (!sData.success) {
        setError(sData.error || 'Не удалось загрузить график ТО');
        setSchedules([]);
      } else {
        setSchedules(sData.schedules ?? []);
      }
      if (!rData.success) {
        setError((prev) => prev || rData.error || 'Не удалось загрузить записи');
        setRecords([]);
      } else {
        setRecords(rData.records ?? []);
      }
    } catch {
      setError('Ошибка соединения');
    } finally {
      setLoading(false);
    }
  }, [mixerId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (odometerKm != null) setRecOdo(String(odometerKm));
  }, [odometerKm]);

  const createSchedule = async () => {
    if (!canMutate) return;
    setSavingSched(true);
    try {
      const res = await fetch('/api/adminCifra/fleet/service/schedules', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          mixer_id: mixerId,
          service_kind: schedKind,
          title: schedTitle.trim() || null,
          interval_km: intervalKm || null,
          interval_days: intervalDays || null,
          interval_hours: intervalHours || null,
          // База для км/м·ч — текущие показания; календарь без last_done → сразу видно «просрочено»
          last_odometer:
            odometerKm != null && Number.isFinite(Number(odometerKm))
              ? Number(odometerKm)
              : null,
          last_engine_hours:
            engineHours != null && Number.isFinite(Number(engineHours))
              ? Number(engineHours)
              : null,
          last_done_at: null,
        }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'Ошибка');
        return;
      }
      setShowScheduleForm(false);
      setSchedTitle('');
      await load();
    } finally {
      setSavingSched(false);
    }
  };

  const deleteSchedule = async (id: number) => {
    if (!canMutate) return;
    if (!(await appConfirm('Удалить шаблон ТО?'))) return;
    const res = await fetch(`/api/adminCifra/fleet/service/schedules?id=${id}`, {
      method: 'DELETE',
      headers: adminCifraAuthHeaders(),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.error || 'Ошибка удаления');
      return;
    }
    await load();
  };

  const createRecord = async () => {
    if (!canMutate) return;
    if (!recDesc.trim() && recStatus === 'requested') {
      alert('Опишите неисправность');
      return;
    }
    setSavingRec(true);
    try {
      const parts = recParts
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((name) => ({ name }));

      const res = await fetch('/api/adminCifra/fleet/service/records', {
        method: 'POST',
        headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          mixer_id: mixerId,
          status: recStatus,
          service_date: recDate,
          odometer_km: recOdo || null,
          description: recDesc.trim() || null,
          labor_cost: recLabor || 0,
          parts_cost: recPartsCost || 0,
          parts,
          performed_by: recBy.trim() || null,
          schedule_id: recScheduleId || null,
          set_lifecycle_repair: recStatus === 'requested' || recStatus === 'in_progress',
        }),
      });
      const data = await res.json();
      if (!data.success) {
        alert(data.error || 'Ошибка');
        return;
      }
      setShowRecordForm(false);
      setRecDesc('');
      setRecParts('');
      setRecLabor('');
      setRecPartsCost('');
      setRecBy('');
      setRecStatus('done');
      await load();
      onLifecycleMaybeChanged?.();
    } finally {
      setSavingRec(false);
    }
  };

  const patchRecordStatus = async (id: number, status: ServiceRecordStatus) => {
    if (!canMutate) return;
    const res = await fetch('/api/adminCifra/fleet/service/records', {
      method: 'PATCH',
      headers: adminCifraAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ id, status }),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.error || 'Ошибка');
      return;
    }
    await load();
    onLifecycleMaybeChanged?.();
  };

  const deleteRecord = async (id: number) => {
    if (!canMutate) return;
    if (!(await appConfirm('Удалить сервисную запись?'))) return;
    const res = await fetch(`/api/adminCifra/fleet/service/records?id=${id}`, {
      method: 'DELETE',
      headers: adminCifraAuthHeaders(),
    });
    const data = await res.json();
    if (!data.success) {
      alert(data.error || 'Ошибка');
      return;
    }
    await load();
    onLifecycleMaybeChanged?.();
  };

  if (loading) {
    return <div style={{ color: '#64748B', padding: 24, textAlign: 'center' }}>Загрузка…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {error && (
        <div
          style={{
            padding: 12,
            borderRadius: 10,
            background: 'rgba(248,113,113,0.1)',
            border: '1px solid rgba(248,113,113,0.35)',
            color: '#F87171',
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* График ТО */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: '#E2E8F0', fontSize: 14 }}>График ТО</div>
          {canMutate && (
            <button
              type="button"
              onClick={() => setShowScheduleForm((v) => !v)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid rgba(74,222,128,0.35)',
                background: 'rgba(74,222,128,0.1)',
                color: '#4ADE80',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <Plus size={14} /> Шаблон
            </button>
          )}
        </div>

        {showScheduleForm && (
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 12,
              background: '#1E2937',
              border: '1px solid #334155',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <select value={schedKind} onChange={(e) => setSchedKind(e.target.value as ServiceKind)} style={fieldStyle}>
              {SERVICE_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
            <input
              placeholder="Название (опц.)"
              value={schedTitle}
              onChange={(e) => setSchedTitle(e.target.value)}
              style={fieldStyle}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
              <input placeholder="Интервал, км" value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} style={fieldStyle} type="number" />
              <input placeholder="Дни" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} style={fieldStyle} type="number" />
              <input placeholder="Моточасы" value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} style={fieldStyle} type="number" />
            </div>
            <button
              type="button"
              disabled={savingSched}
              onClick={() => void createSchedule()}
              style={{
                padding: '10px',
                borderRadius: 10,
                border: 'none',
                background: '#4ADE80',
                color: '#0F172A',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {savingSched ? 'Сохранение…' : 'Создать шаблон'}
            </button>
          </div>
        )}

        {schedules.length === 0 ? (
          <div style={{ color: '#64748B', fontSize: 13 }}>Шаблонов ТО пока нет</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {schedules.map((s) => {
              const due = computeServiceDue(s, odometerKm, engineHours);
              return (
                <div
                  key={s.id}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: '#1E2937',
                    border: `1px solid ${
                      due?.urgency === 'overdue'
                        ? 'rgba(248,113,113,0.45)'
                        : due?.urgency === 'soon'
                          ? 'rgba(251,191,36,0.45)'
                          : '#334155'
                    }`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Wrench size={14} color="#94A3B8" />
                    <span style={{ fontWeight: 700, color: '#F8FAFC', fontSize: 13, flex: 1 }}>
                      {s.title || serviceKindLabel(s.service_kind)}
                    </span>
                    {canMutate && (
                      <button
                        type="button"
                        onClick={() => void deleteSchedule(s.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#F87171' }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                  <div style={{ color: '#64748B', fontSize: 11, marginTop: 4 }}>
                    {[
                      s.interval_km != null ? `каждые ${s.interval_km} км` : null,
                      s.interval_days != null ? `каждые ${s.interval_days} дн.` : null,
                      s.interval_hours != null ? `каждые ${s.interval_hours} м/ч` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {due && due.urgency !== 'ok' && (
                    <div
                      style={{
                        marginTop: 6,
                        fontSize: 12,
                        fontWeight: 600,
                        color: due.urgency === 'overdue' ? '#F87171' : '#FBBF24',
                      }}
                    >
                      {due.urgency === 'overdue' ? 'Просрочено' : 'Скоро ТО'}: {due.reason}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Записи */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ fontWeight: 700, color: '#E2E8F0', fontSize: 14 }}>Сервисные записи</div>
          {canMutate && (
            <button
              type="button"
              onClick={() => setShowRecordForm((v) => !v)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 10px',
                borderRadius: 8,
                border: '1px solid rgba(56,189,248,0.35)',
                background: 'rgba(56,189,248,0.1)',
                color: '#38BDF8',
                fontWeight: 600,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              <Plus size={14} /> Запись
            </button>
          )}
        </div>

        {showRecordForm && (
          <div
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 12,
              background: '#1E2937',
              border: '1px solid #334155',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
            }}
          >
            <select
              value={recStatus}
              onChange={(e) => setRecStatus(e.target.value as ServiceRecordStatus)}
              style={fieldStyle}
            >
              {SERVICE_RECORD_STATUSES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
            <input type="date" value={recDate} onChange={(e) => setRecDate(e.target.value)} style={fieldStyle} />
            <input
              type="number"
              placeholder="Одометр, км"
              value={recOdo}
              onChange={(e) => setRecOdo(e.target.value)}
              style={fieldStyle}
            />
            <textarea
              placeholder="Описание работ / неисправности"
              value={recDesc}
              onChange={(e) => setRecDesc(e.target.value)}
              rows={3}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
            <textarea
              placeholder="Запчасти (по одной на строку)"
              value={recParts}
              onChange={(e) => setRecParts(e.target.value)}
              rows={2}
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <input type="number" placeholder="Работы, ₽" value={recLabor} onChange={(e) => setRecLabor(e.target.value)} style={fieldStyle} />
              <input type="number" placeholder="Запчасти, ₽" value={recPartsCost} onChange={(e) => setRecPartsCost(e.target.value)} style={fieldStyle} />
            </div>
            <input placeholder="Кто выполнил" value={recBy} onChange={(e) => setRecBy(e.target.value)} style={fieldStyle} />
            {schedules.length > 0 && (
              <select value={recScheduleId} onChange={(e) => setRecScheduleId(e.target.value)} style={fieldStyle}>
                <option value="">— без привязки к шаблону —</option>
                {schedules.map((s) => (
                  <option key={s.id} value={String(s.id)}>
                    {s.title || serviceKindLabel(s.service_kind)}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              disabled={savingRec}
              onClick={() => void createRecord()}
              style={{
                padding: '10px',
                borderRadius: 10,
                border: 'none',
                background: '#38BDF8',
                color: '#0F172A',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {savingRec ? 'Сохранение…' : 'Сохранить запись'}
            </button>
          </div>
        )}

        {records.length === 0 ? (
          <div style={{ color: '#64748B', fontSize: 13 }}>Записей пока нет</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {records.map((r) => {
              const st = SERVICE_RECORD_STATUSES.find((s) => s.value === r.status);
              return (
                <div
                  key={r.id}
                  style={{
                    padding: 12,
                    borderRadius: 12,
                    background: '#1E2937',
                    border: '1px solid #334155',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: st?.color || '#94A3B8',
                        padding: '2px 8px',
                        borderRadius: 9999,
                        background: `${st?.color || '#94A3B8'}22`,
                      }}
                    >
                      {st?.label || r.status}
                    </span>
                    <span style={{ color: '#94A3B8', fontSize: 12 }}>{r.service_date}</span>
                    <span style={{ marginLeft: 'auto', color: '#E2E8F0', fontSize: 12, fontWeight: 600 }}>
                      {(r.labor_cost + r.parts_cost) > 0
                        ? `${(r.labor_cost + r.parts_cost).toLocaleString('ru-RU')} ₽`
                        : ''}
                    </span>
                  </div>
                  {r.description && (
                    <div style={{ color: '#CBD5E1', fontSize: 13, marginBottom: 4 }}>{r.description}</div>
                  )}
                  {r.parts.length > 0 && (
                    <div style={{ color: '#64748B', fontSize: 11 }}>
                      Запчасти: {r.parts.map((p) => p.name).join(', ')}
                    </div>
                  )}
                  {(r.photoUrls?.length || 0) > 0 && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {r.photoUrls!.map((url, i) => (
                        <a
                          key={`${r.id}-ph-${i}`}
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            width: 56,
                            height: 56,
                            borderRadius: 8,
                            overflow: 'hidden',
                            border: '1px solid #334155',
                            display: 'block',
                            background: '#0F172A',
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        </a>
                      ))}
                    </div>
                  )}
                  {canMutate && (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      {r.status === 'requested' && (
                        <button
                          type="button"
                          onClick={() => void patchRecordStatus(r.id, 'in_progress')}
                          style={chipBtn('#38BDF8')}
                        >
                          В работу
                        </button>
                      )}
                      {(r.status === 'requested' || r.status === 'in_progress') && (
                        <button
                          type="button"
                          onClick={() => void patchRecordStatus(r.id, 'done')}
                          style={chipBtn('#4ADE80')}
                        >
                          Выполнено
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void deleteRecord(r.id)}
                        style={chipBtn('#F87171')}
                      >
                        Удалить
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function chipBtn(color: string): CSSProperties {
  return {
    padding: '5px 10px',
    borderRadius: 8,
    border: `1px solid ${color}55`,
    background: `${color}18`,
    color,
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
