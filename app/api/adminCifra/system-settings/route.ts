// GET — staff (для mute/баннера/меню); PUT — только admin.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import {
  DEFAULT_SYSTEM_SETTINGS,
  ROLE_ACCESS_SCHEMA_VERSION,
  mergeSystemSettings,
  type SystemSettingsData,
} from '@/lib/systemSettings';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function loadMerged(): Promise<SystemSettingsData> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('data')
    .eq('id', 1)
    .maybeSingle();

  if (error || !data) {
    return DEFAULT_SYSTEM_SETTINGS;
  }
  const merged = mergeSystemSettings(data.data);
  const raw = data.data && typeof data.data === 'object' ? (data.data as Record<string, unknown>) : {};
  const rawSchema = Number(raw.roleAccessSchemaVersion);
  const needsSeedPersist =
    !Number.isFinite(rawSchema) || rawSchema < ROLE_ACCESS_SCHEMA_VERSION;
  // Одноразово зафиксировать seed новых ролей (mehanik → Техника), иначе версия
  // останется 0 в БД и галочки будут «возвращаться» после каждого GET.
  if (needsSeedPersist) {
    void supabase
      .from('system_settings')
      .upsert(
        {
          id: 1,
          data: merged,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' },
      )
      .then(({ error: upsertError }) => {
        if (upsertError) {
          console.warn('system_settings seed persist failed:', upsertError.message);
        }
      });
  }
  return merged;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request);
  if (auth.error) return auth.error;
  const settings = await loadMerged();
  return NextResponse.json(settings);
}

export async function PUT(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 });
  }

  // Мержим с уже сохранённым JSON — частичный PUT не затирает остальные секции дефолтами.
  const existing = await loadMerged();
  const merged = mergeSystemSettings(body, existing);

  const { data, error } = await supabase
    .from('system_settings')
    .upsert(
      {
        id: 1,
        data: merged,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    )
    .select('data, updated_at')
    .single();

  if (error) {
    // Таблица ещё не создана
    if (/relation .*system_settings.* does not exist/i.test(error.message || '')) {
      return NextResponse.json(
        {
          error:
            'Таблица system_settings не найдена. Выполни scripts/system-settings-schema.sql в Supabase.',
        },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(mergeSystemSettings(data?.data));
}
