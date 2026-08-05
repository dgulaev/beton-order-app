// app/api/adminCifra/mixers/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { FLEET_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  isVehicleKind,
  syncVolumeIntoSpecs,
  vehicleRequiresDriver,
  type VehicleKind,
} from '@/lib/fleetCatalog';
import { isLifecycleStatus } from '@/lib/fleetLifecycle';
import { mergeTariffIntoSpecs, sanitizeFleetSpecs } from '@/lib/fleetTariffs';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET — техника.
// По умолчанию только миксеры (бетонный контур: заявки, mobile, водитель).
// ?kind=dump_truck|… — один вид; ?kind=all — весь парк для страницы «Техника».
export async function GET(request: NextRequest) {
  try {
    const kindParam = request.nextUrl.searchParams.get('kind');

    let query = supabase
      .from('mixers')
      .select('*, mixer_drivers(id, driver_name, phone)')
      .order('created_at', { ascending: false });

    if (!kindParam || kindParam === 'mixer') {
      // Без колонки vehicle_kind (до миграции) .eq упадёт — тогда отдаём всё как миксеры.
      query = query.eq('vehicle_kind', 'mixer');
    } else if (kindParam === 'all') {
      // без фильтра
    } else if (isVehicleKind(kindParam)) {
      query = query.eq('vehicle_kind', kindParam);
    } else {
      return NextResponse.json({ error: 'Неизвестный kind' }, { status: 400 });
    }

    const { data, error } = await query;

    if (error) {
      // Колонки ещё нет — fallback на старое поведение.
      if (/vehicle_kind|specs/i.test(error.message)) {
        const legacy = await supabase
          .from('mixers')
          .select('*, mixer_drivers(id, driver_name, phone)')
          .order('created_at', { ascending: false });
        if (legacy.error) throw legacy.error;
        const rows = (legacy.data || []).map((r: any) => ({
          ...r,
          vehicle_kind: r.vehicle_kind || 'mixer',
          specs: r.specs || {},
        }));
        if (kindParam && kindParam !== 'all' && kindParam !== 'mixer') {
          return NextResponse.json([]);
        }
        return NextResponse.json(rows);
      }
      throw error;
    }

    return NextResponse.json(data || []);
  } catch (error: any) {
    console.error('Mixers GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST — добавление / обновление единицы техники
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const {
      id,
      number,
      model,
      driver,
      phone,
      volume,
      type,
      status,
      unload_allowance_min,
      vehicle_kind: rawKind,
      specs: rawSpecs,
      tariff_patch: tariffPatch,
      lifecycle_status: rawLifecycle,
      odometer_km: rawOdometer,
      engine_hours: rawEngineHours,
      scout_unit_id: rawScoutUnitId,
    } = body;

    // Частичное обновление паспорта / lifecycle из drawer
    if (id && (rawLifecycle != null || rawOdometer != null || rawEngineHours != null || rawScoutUnitId != null || (rawSpecs != null && !number))) {
      const { data: existing, error: exErr } = await supabase
        .from('mixers')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (exErr) throw exErr;
      if (!existing) {
        return NextResponse.json({ error: 'Единица не найдена' }, { status: 404 });
      }
      const kind: VehicleKind = isVehicleKind(existing.vehicle_kind)
        ? existing.vehicle_kind
        : 'mixer';
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (rawLifecycle != null && isLifecycleStatus(rawLifecycle)) {
        patch.lifecycle_status = rawLifecycle;
      }
      if (rawOdometer !== undefined) {
        patch.odometer_km = rawOdometer === '' || rawOdometer == null ? null : Number(rawOdometer);
      }
      if (rawEngineHours !== undefined) {
        patch.engine_hours = rawEngineHours === '' || rawEngineHours == null ? null : Number(rawEngineHours);
      }
      if (rawScoutUnitId !== undefined) {
        if (rawScoutUnitId === '' || rawScoutUnitId == null) {
          patch.scout_unit_id = null;
        } else {
          const n = Number(rawScoutUnitId);
          if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
            return NextResponse.json(
              { error: 'scout_unit_id должен быть целым положительным числом' },
              { status: 400 },
            );
          }
          patch.scout_unit_id = n;
        }
      }
      if (rawSpecs != null && typeof rawSpecs === 'object' && !Array.isArray(rawSpecs)) {
        const merged: Record<string, unknown> = {
          ...(existing.specs && typeof existing.specs === 'object' ? existing.specs : {}),
          ...rawSpecs,
        };
        // null в патче = сбросить поле (норма расхода и т.п.)
        for (const [k, v] of Object.entries(rawSpecs as Record<string, unknown>)) {
          if (v === null) delete merged[k];
        }
        patch.specs = sanitizeFleetSpecs(
          kind,
          syncVolumeIntoSpecs(kind, existing.volume, merged),
        );
      }
      const { data, error } = await supabase.from('mixers').update(patch).eq('id', id).select().single();
      if (error) {
        if (/lifecycle_status|odometer_km|scout_unit_id/i.test(error.message)) {
          return NextResponse.json({
            error: 'Выполните scripts/fleet-lifecycle.sql',
          }, { status: 400 });
        }
        throw error;
      }
      return NextResponse.json({ success: true, data });
    }

    // Частичное обновление только тарифов — не затирает физику/ФИО из устаревшего UI.
    if (id && tariffPatch != null && typeof tariffPatch === 'object' && !Array.isArray(tariffPatch)) {
      const { data: existing, error: exErr } = await supabase
        .from('mixers')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (exErr) throw exErr;
      if (!existing) {
        return NextResponse.json({ error: 'Единица не найдена' }, { status: 404 });
      }
      const kind: VehicleKind = isVehicleKind(existing.vehicle_kind)
        ? existing.vehicle_kind
        : 'mixer';
      const nextSpecs = sanitizeFleetSpecs(
        kind,
        mergeTariffIntoSpecs(
          existing.specs && typeof existing.specs === 'object' ? existing.specs : {},
          tariffPatch,
        ),
      );
      const { data, error } = await supabase
        .from('mixers')
        .update({ specs: nextSpecs, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single();
      if (error) {
        if (/vehicle_kind|specs/i.test(error.message)) {
          return NextResponse.json({
            error: 'Выполните scripts/fleet-vehicle-kind.sql — колонки vehicle_kind/specs ещё не в БД',
          }, { status: 400 });
        }
        throw error;
      }
      return NextResponse.json({ success: true, data });
    }

    const vehicle_kind: VehicleKind = isVehicleKind(rawKind) ? rawKind : 'mixer';
    const specs = sanitizeFleetSpecs(
      vehicle_kind,
      syncVolumeIntoSpecs(
        vehicle_kind,
        volume,
        rawSpecs && typeof rawSpecs === 'object' && !Array.isArray(rawSpecs) ? rawSpecs : {},
      ),
    );

    if (!number) {
      return NextResponse.json({ error: 'Госномер обязателен' }, { status: 400 });
    }

    const needsDriver = vehicleRequiresDriver(vehicle_kind);
    if (needsDriver && !driver) {
      return NextResponse.json({ error: 'Водитель обязателен' }, { status: 400 });
    }

    if (needsDriver && (!phone || !String(phone).trim())) {
      return NextResponse.json(
        { error: 'Телефон водителя обязателен — по нему водитель входит в мобильное приложение' },
        { status: 400 }
      );
    }

    if (type !== 'own' && type !== 'rented') {
      return NextResponse.json({ error: 'Укажите свою или наёмную технику' }, { status: 400 });
    }

    // Норма простоя — только для наёмных миксеров.
    if (
      vehicle_kind === 'mixer' &&
      type === 'rented' &&
      (unload_allowance_min === undefined || unload_allowance_min === null || unload_allowance_min === '')
    ) {
      return NextResponse.json(
        { error: 'Для наёмного миксера укажите норму разгрузки в минутах' },
        { status: 400 }
      );
    }
    const normalizedAllowance =
      vehicle_kind === 'mixer' && type === 'rented' ? Number(unload_allowance_min) : null;
    if (
      vehicle_kind === 'mixer' &&
      type === 'rented' &&
      (!Number.isFinite(normalizedAllowance) || normalizedAllowance! <= 0)
    ) {
      return NextResponse.json(
        { error: 'Норма разгрузки для наёмного миксера должна быть больше 0' },
        { status: 400 }
      );
    }

    const payload = {
      number,
      model: model || '',
      driver: driver || '',
      phone: phone ? String(phone).trim() : '',
      volume: vehicle_kind === 'tractor_unit' ? 0 : Number(volume) || 0,
      type,
      status: status || 'Доступен',
      unload_allowance_min: normalizedAllowance,
      vehicle_kind,
      // Голова без физических specs — но тарифы (hour_rate_rub и т.п.) храним в specs
      specs,
      updated_at: new Date().toISOString(),
    };

    if (id) {
      const { data, error } = await supabase
        .from('mixers')
        .update(payload)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        if (/vehicle_kind|specs/i.test(error.message)) {
          const { vehicle_kind: _vk, specs: _sp, ...legacyPayload } = payload;
          void _vk;
          void _sp;
          const { data: d2, error: e2 } = await supabase
            .from('mixers')
            .update(legacyPayload)
            .eq('id', id)
            .select()
            .single();
          if (e2) throw e2;
          return NextResponse.json({
            success: true,
            data: d2,
            warning: 'Выполните scripts/fleet-vehicle-kind.sql — колонки vehicle_kind/specs ещё не в БД',
          });
        }
        throw error;
      }
      return NextResponse.json({ success: true, data });
    }

    const { updated_at: _ua, ...insertPayload } = payload;
    void _ua;
    const { data, error } = await supabase
      .from('mixers')
      .insert([insertPayload])
      .select()
      .single();

    if (error) {
      if (/vehicle_kind|specs/i.test(error.message)) {
        const { vehicle_kind: _vk, specs: _sp, ...legacyPayload } = insertPayload;
        void _vk;
        void _sp;
        const { data: d2, error: e2 } = await supabase
          .from('mixers')
          .insert([legacyPayload])
          .select()
          .single();
        if (e2) throw e2;
        return NextResponse.json({
          success: true,
          data: d2,
          warning: 'Выполните scripts/fleet-vehicle-kind.sql — колонки vehicle_kind/specs ещё не в БД',
        });
      }
      throw error;
    }
    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    console.error('Mixers POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE — удаление (?id=)
export async function DELETE(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, FLEET_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const id = Number(request.nextUrl.searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 });
    }

    const { error } = await supabase.from('mixers').delete().eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Mixers DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
