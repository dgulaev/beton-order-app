import { NextRequest, NextResponse } from 'next/server';
import { FLEET_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { fleetTableMissingMessage } from '@/lib/fleetDocumentsServer';
import {
  getMissingScoutEnvKeys,
  isScoutConfigured,
  scoutFetchFuelingStats,
  scoutFuelEventKey,
} from '@/lib/integrations/scout';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

/**
 * POST { mixer_id, from, to, stats_only? } — забрать заправки/сливы/расход из СКАУТ (fdstat).
 * По умолчанию импортирует события в fuel_entries (идемпотентно).
 * stats_only=true — только сводка ДУТ (без записи), доступна всем staff.
 */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;

  if (!isScoutConfigured()) {
    return NextResponse.json(
      {
        success: false,
        error: `СКАУТ не настроен (нет ${getMissingScoutEnvKeys().join(', ') || 'SCOUT_*'})`,
      },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const mixerId = Number(body.mixer_id);
    const from = String(body.from || '').slice(0, 10);
    const to = String(body.to || '').slice(0, 10);
    const statsOnly = Boolean(body.stats_only);

    if (
      !statsOnly &&
      !FLEET_MUTATION_ROLES.map((r) => r.toLowerCase()).includes(auth.user.role)
    ) {
      return NextResponse.json({ success: false, error: 'Доступ запрещён' }, { status: 403 });
    }

    if (!Number.isFinite(mixerId) || mixerId <= 0) {
      return NextResponse.json({ success: false, error: 'mixer_id обязателен' }, { status: 400 });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ success: false, error: 'from/to — даты YYYY-MM-DD' }, { status: 400 });
    }

    const { data: mixer, error: mixerErr } = await supabaseAdmin
      .from('mixers')
      .select('id, number, scout_unit_id')
      .eq('id', mixerId)
      .maybeSingle();

    if (mixerErr || !mixer) {
      return NextResponse.json({ success: false, error: 'ТС не найдено' }, { status: 404 });
    }

    const unitId = mixer.scout_unit_id != null ? Number(mixer.scout_unit_id) : NaN;
    if (!Number.isFinite(unitId) || unitId <= 0) {
      return NextResponse.json(
        {
          success: false,
          error: `У «${mixer.number}» нет привязки СКАУТ (scout_unit_id). Сначала sync единиц.`,
        },
        { status: 400 },
      );
    }

    const fromIso = `${from}T00:00:00+03:00`;
    const toIso = `${to}T23:59:59.999+03:00`;

    const stats = await scoutFetchFuelingStats({
      unitId,
      fromIso,
      toIso,
    });

    let importedFueling = 0;
    let importedDrain = 0;
    let skipped = 0;
    let schemaHint: string | null = null;

    if (!statsOnly) {
      for (const ev of stats.events) {
        const isFueling = ev.eventType === 'Fueling';
        const isDrain = ev.eventType === 'Defueling';
        if (!isFueling && !isDrain) {
          skipped += 1;
          continue;
        }

        // В БД liters > 0: для слива пишем |Δ| и fuel_type=drain
        const raw = ev.deltaLiters;
        const litersAbs =
          raw == null
            ? null
            : Math.round(Math.abs(raw) * 10) / 10;
        if (litersAbs == null || !(litersAbs > 0.05)) {
          skipped += 1;
          continue;
        }

        const key = scoutFuelEventKey(unitId, ev);

        const { data: existing, error: existErr } = await supabaseAdmin
          .from('fuel_entries')
          .select('id')
          .eq('scout_event_key', key)
          .maybeSingle();

        if (existErr) {
          if (/scout_event_key|column/i.test(existErr.message)) {
            schemaHint =
              'Выполни scripts/fleet-fuel-scout.sql в Supabase (колонки source / scout_event_key)';
            break;
          }
          skipped += 1;
          continue;
        }
        if (existing) {
          skipped += 1;
          continue;
        }

        const row = {
          mixer_id: mixerId,
          filled_at: ev.timestamp,
          liters: litersAbs,
          amount_rub: null as number | null,
          odometer_km: null as number | null,
          fuel_type: isDrain ? 'drain' : 'diesel',
          receipt_path: null as string | null,
          created_by: isDrain ? 'СКАУТ · слив' : 'СКАУТ',
          source: 'scout',
          scout_event_key: key,
        };

        const { error: insErr } = await supabaseAdmin.from('fuel_entries').insert(row);
        if (insErr) {
          if (/scout_event_key|source|column/i.test(insErr.message)) {
            schemaHint =
              'Выполни scripts/fleet-fuel-scout.sql в Supabase (колонки source / scout_event_key)';
            break;
          }
          skipped += 1;
          continue;
        }
        if (isDrain) importedDrain += 1;
        else importedFueling += 1;
      }
    }

    const imported = importedFueling + importedDrain;

    return NextResponse.json({
      success: !schemaHint,
      stats_only: statsOnly,
      imported,
      importedFueling,
      importedDrain,
      skipped,
      scout_unit_id: unitId,
      stats: {
        beginFuelVolumeL: stats.beginFuelVolumeL,
        endFuelVolumeL: stats.endFuelVolumeL,
        fuelingTotalVolumeL: stats.fuelingTotalVolumeL,
        defuelingTotalVolumeL: stats.defuelingTotalVolumeL,
        totalFuelConsumptionL: stats.totalFuelConsumptionL,
        fuelingCount: stats.fuelingCount,
        defuelingCount: stats.defuelingCount,
        eventsCount: stats.events.length,
      },
      events: stats.events.map((e) => ({
        timestamp: e.timestamp,
        type: e.eventType,
        liters: e.deltaLiters,
        begin: e.beginLiters,
        end: e.endLiters,
      })),
      error: schemaHint,
      hint:
        !schemaHint && stats.events.length === 0 && stats.fuelingCount === 0
          ? 'СКАУТ не вернул событий. Проверь ДУТ в СКАУТ-Студио и выбранный период.'
          : null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка СКАУТ';
    return NextResponse.json(
      {
        success: false,
        error: /fuel_entries|column/i.test(msg)
          ? fleetTableMissingMessage(msg, 'fuel_entries')
          : msg,
      },
      { status: 500 },
    );
  }
}
