import { NextRequest, NextResponse } from 'next/server';
import { ADMIN_MUTATION_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { normalizeSourceKey } from '@/lib/integrations/requestPresets';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

const KINDS = ['marketplace', 'demand', 'other'] as const;
const STATUSES = ['requested', 'in_progress', 'wired', 'cancelled'] as const;
const RESERVED_KEYS = new Set(['avito', 'gosplan', 'demand', 'stub', 'feed', 'demo']);

const LIMITS = {
  title: 120,
  notes: 4000,
  credentials_hint: 4000,
  account_info: 500,
  docs_url: 500,
} as const;

function isKind(v: unknown): v is (typeof KINDS)[number] {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v);
}

function isStatus(v: unknown): v is (typeof STATUSES)[number] {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

function clip(raw: unknown, max: number): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s) return null;
  return s.slice(0, max);
}

function isHttpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** Список заявок — admin / manager. */
export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ADMIN_MUTATION_ROLES);
  if (auth.error) return auth.error;

  const { data, error } = await supabaseAdmin
    .from('integration_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    const missing = /does not exist|relation|42P01/i.test(error.message);
    return NextResponse.json(
      {
        success: false,
        error: missing
          ? 'Таблица integration_requests не создана. Выполни scripts/integration-requests-schema.sql'
          : error.message,
        table_ready: !missing,
      },
      { status: missing ? 503 : 500 },
    );
  }

  return NextResponse.json({ success: true, items: data ?? [], table_ready: true });
}

/** Создать заявку — admin / manager. Секреты сюда не принимаем. */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ADMIN_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const title = clip(body.title, LIMITS.title);
    const sourceKey = normalizeSourceKey(
      typeof body.source_key === 'string' && body.source_key.trim()
        ? body.source_key
        : title || '',
    );
    const kind = isKind(body.kind) ? body.kind : 'marketplace';
    const notes = clip(body.notes, LIMITS.notes);
    const credentialsHint = clip(body.credentials_hint, LIMITS.credentials_hint);
    const docsUrl = clip(body.docs_url, LIMITS.docs_url);
    const accountInfo = clip(body.account_info, LIMITS.account_info);

    if (!title) {
      return NextResponse.json({ success: false, error: 'Укажите название' }, { status: 400 });
    }
    if (!sourceKey || sourceKey.length < 2) {
      return NextResponse.json(
        {
          success: false,
          error: 'Ключ площадки: латиница (youla, cian…). Кириллица в ключе не подходит.',
        },
        { status: 400 },
      );
    }
    if (RESERVED_KEYS.has(sourceKey)) {
      return NextResponse.json(
        {
          success: false,
          error: `Ключ «${sourceKey}» зарезервирован — выбери другой (например avito_2)`,
        },
        { status: 400 },
      );
    }
    if (docsUrl && !isHttpUrl(docsUrl)) {
      return NextResponse.json(
        { success: false, error: 'Ссылка: нужен http(s)://' },
        { status: 400 },
      );
    }

    const { data, error } = await supabaseAdmin
      .from('integration_requests')
      .insert({
        source_key: sourceKey,
        title,
        kind,
        status: 'requested',
        notes,
        credentials_hint: credentialsHint,
        docs_url: docsUrl,
        account_info: accountInfo,
        created_by: auth.user.user_id,
        created_by_name: auth.user.full_name,
        updated_at: new Date().toISOString(),
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { success: false, error: `Площадка с ключом «${sourceKey}» уже есть` },
          { status: 409 },
        );
      }
      const missing = /does not exist|relation|42P01/i.test(error.message);
      return NextResponse.json(
        {
          success: false,
          error: missing
            ? 'Таблица integration_requests не создана. Выполни scripts/integration-requests-schema.sql'
            : error.message,
        },
        { status: missing ? 503 : 500 },
      );
    }

    return NextResponse.json({ success: true, item: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Ошибка' },
      { status: 500 },
    );
  }
}

/** Обновить статус/заметки — admin / manager. */
export async function PATCH(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ADMIN_MUTATION_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const id = Number(body.id);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ success: false, error: 'Некорректный id' }, { status: 400 });
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.status != null) {
      if (!isStatus(body.status)) {
        return NextResponse.json({ success: false, error: 'Некорректный статус' }, { status: 400 });
      }
      patch.status = body.status;
    }
    if ('notes' in body) patch.notes = clip(body.notes, LIMITS.notes);
    if ('credentials_hint' in body) {
      patch.credentials_hint = clip(body.credentials_hint, LIMITS.credentials_hint);
    }
    if ('account_info' in body) patch.account_info = clip(body.account_info, LIMITS.account_info);
    if ('docs_url' in body) {
      const docsUrl = clip(body.docs_url, LIMITS.docs_url);
      if (docsUrl && !isHttpUrl(docsUrl)) {
        return NextResponse.json(
          { success: false, error: 'Ссылка: нужен http(s)://' },
          { status: 400 },
        );
      }
      patch.docs_url = docsUrl;
    }
    if ('title' in body) {
      const title = clip(body.title, LIMITS.title);
      if (!title) {
        return NextResponse.json({ success: false, error: 'Название не может быть пустым' }, { status: 400 });
      }
      patch.title = title;
    }

    if (Object.keys(patch).length <= 1) {
      return NextResponse.json({ success: false, error: 'Нет изменений' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('integration_requests')
      .update(patch)
      .eq('id', id)
      .select('*')
      .maybeSingle();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ success: false, error: 'Не найдено' }, { status: 404 });
    }

    return NextResponse.json({ success: true, item: data });
  } catch (e) {
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Ошибка' },
      { status: 500 },
    );
  }
}
