import { NextRequest, NextResponse } from 'next/server';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  getIntegrationSettings,
  publicIntegrationView,
  saveIntegrationSettings,
  type IntegrationSettingsPatch,
} from '@/lib/integrations/settings';

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function parseOptionalNumber(
  raw: unknown,
  opts: { min?: number; max?: number; label: string },
): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === '' || raw == null) return { ok: true, value: null };
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    return { ok: false, error: `${opts.label}: некорректное число` };
  }
  if (opts.min != null && n < opts.min) {
    return { ok: false, error: `${opts.label}: минимум ${opts.min}` };
  }
  if (opts.max != null && n > opts.max) {
    return { ok: false, error: `${opts.label}: максимум ${opts.max}` };
  }
  return { ok: true, value: n };
}

/** Просмотр статусов — admin / manager (секреты в ответе только флагами). */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin', 'manager']);
  if (auth.error) return auth.error;

  try {
    const settings = await getIntegrationSettings(true);
    return NextResponse.json({
      success: true,
      settings: publicIntegrationView(settings),
    });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Ошибка загрузки' },
      { status: 500 },
    );
  }
}

/** Сохранение — только admin. */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const patch: IntegrationSettingsPatch = {};

    if (typeof body.avito_enabled === 'boolean') patch.avito_enabled = body.avito_enabled;
    if (typeof body.avito_demand_messenger === 'boolean') {
      patch.avito_demand_messenger = body.avito_demand_messenger;
    }
    if (typeof body.gosplan_enabled === 'boolean') patch.gosplan_enabled = body.gosplan_enabled;
    if (typeof body.demand_demo === 'boolean') patch.demand_demo = body.demand_demo;

    if ('avito_client_id' in body) patch.avito_client_id = body.avito_client_id;
    if ('avito_user_id' in body) {
      const uid = typeof body.avito_user_id === 'string' ? body.avito_user_id.trim() : body.avito_user_id;
      if (uid != null && uid !== '' && !/^\d+$/.test(String(uid))) {
        return NextResponse.json(
          { success: false, error: 'User ID Авито должен быть числом' },
          { status: 400 },
        );
      }
      patch.avito_user_id = uid;
    }

    if ('gosplan_base_url' in body) {
      const url =
        typeof body.gosplan_base_url === 'string' ? body.gosplan_base_url.trim() : body.gosplan_base_url;
      if (url != null && url !== '' && !isHttpUrl(String(url))) {
        return NextResponse.json(
          { success: false, error: 'Base URL ГосПлан: нужен http(s)://' },
          { status: 400 },
        );
      }
      patch.gosplan_base_url = url;
    }

    if ('gosplan_regions' in body) {
      const regions =
        typeof body.gosplan_regions === 'string' ? body.gosplan_regions.trim() : body.gosplan_regions;
      if (regions != null && regions !== '') {
        const parts = String(regions)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        if (parts.length === 0 || parts.some((p) => !/^\d{1,3}$/.test(p))) {
          return NextResponse.json(
            { success: false, error: 'Регионы ЕИС: коды через запятую, например 32' },
            { status: 400 },
          );
        }
      }
      patch.gosplan_regions = regions;
    }

    if ('demand_feed_url' in body) {
      const url =
        typeof body.demand_feed_url === 'string' ? body.demand_feed_url.trim() : body.demand_feed_url;
      if (url != null && url !== '' && !isHttpUrl(String(url))) {
        return NextResponse.json(
          { success: false, error: 'JSON-лента: нужен http(s)://' },
          { status: 400 },
        );
      }
      patch.demand_feed_url = url;
    }

    if ('demand_home_regions' in body) patch.demand_home_regions = body.demand_home_regions;

    // Секреты: пустая строка без clear_* = не трогать
    if (typeof body.avito_client_secret === 'string' && body.avito_client_secret.trim()) {
      patch.avito_client_secret = body.avito_client_secret.trim();
    } else if (body.clear_avito_client_secret === true) {
      patch.avito_client_secret = null;
    }

    if (typeof body.avito_webhook_secret === 'string' && body.avito_webhook_secret.trim()) {
      patch.avito_webhook_secret = body.avito_webhook_secret.trim();
    } else if (body.clear_avito_webhook_secret === true) {
      patch.avito_webhook_secret = null;
    }

    if (typeof body.gosplan_api_key === 'string' && body.gosplan_api_key.trim()) {
      patch.gosplan_api_key = body.gosplan_api_key.trim();
    } else if (body.clear_gosplan_api_key === true) {
      patch.gosplan_api_key = null;
    }

    if ('demand_min_volume_m3' in body) {
      const parsed = parseOptionalNumber(body.demand_min_volume_m3, {
        min: 0,
        max: 10_000,
        label: 'Мин. объём',
      });
      if (!parsed.ok) {
        return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
      }
      patch.demand_min_volume_m3 = parsed.value;
    }
    if ('demand_alert_score' in body) {
      const parsed = parseOptionalNumber(body.demand_alert_score, {
        min: 0,
        max: 100,
        label: 'Порог алерта',
      });
      if (!parsed.ok) {
        return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
      }
      patch.demand_alert_score = parsed.value;
    }

    const settings = await saveIntegrationSettings(patch);
    return NextResponse.json({
      success: true,
      settings: publicIntegrationView(settings),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Ошибка сохранения';
    const missingTable = /does not exist|relation|42P01/i.test(msg);
    return NextResponse.json(
      {
        success: false,
        error: missingTable
          ? 'Таблица integration_settings ещё не создана. Выполни scripts/integration-settings-schema.sql в Supabase.'
          : msg,
      },
      { status: missingTable ? 503 : 500 },
    );
  }
}
