import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_CIFRA_STAFF_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { BRYANSK_COMPETITORS } from '@/lib/competitorsCatalog';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const KINDS = new Set(['concrete', 'aggregate', 'cement', 'mixed']);
const OWNERSHIPS = new Set(['own', 'partner']);

/** Нельзя активировать точку конкурента, пока сам конкурент скрыт. */
async function assertCompetitorAllowsActivePoint(
  externalKey: string | null | undefined,
): Promise<NextResponse | null> {
  if (!externalKey || !String(externalKey).startsWith('competitor:')) return null;
  const key = String(externalKey).slice('competitor:'.length);
  const seed = BRYANSK_COMPETITORS.find((s) => s.key === key || s.parser_key === key);
  if (!seed) return null;

  let comp: { name: string; active: boolean | null } | null = null;
  if (seed.parser_key) {
    const { data } = await supabase
      .from('competitors')
      .select('name, active')
      .eq('parser_key', seed.parser_key)
      .maybeSingle();
    comp = data;
  }
  if (!comp) {
    const { data } = await supabase
      .from('competitors')
      .select('name, active')
      .ilike('name', seed.name)
      .maybeSingle();
    comp = data;
  }
  if (comp && comp.active === false) {
    return NextResponse.json(
      {
        error: `Сначала восстановите конкурента «${comp.name}» в разделе Конкуренты — точка привязана к скрытому заводу`,
      },
      { status: 400 },
    );
  }
  return null;
}

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ADMIN_CIFRA_STAFF_ROLES);
  if (auth.error) return auth.error;

  try {
    const kind = request.nextUrl.searchParams.get('kind');
    const activeOnly = request.nextUrl.searchParams.get('active') !== '0';

    let query = supabase
      .from('loading_points')
      .select('*')
      .order('is_default', { ascending: false })
      .order('name', { ascending: true });

    if (activeOnly) query = query.eq('active', true);
    if (kind && KINDS.has(kind)) query = query.eq('kind', kind);

    const { data, error } = await query;
    if (error) {
      if (/loading_points/i.test(error.message)) {
        return NextResponse.json([]);
      }
      throw error;
    }
    return NextResponse.json(data || []);
  } catch (e: any) {
    console.error('loading-points GET', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    const {
      id,
      name,
      kind,
      ownership = 'own',
      address,
      lat,
      lon,
      is_default = false,
      active = true,
      notes,
      external_key,
    } = body;

    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: 'Название обязательно' }, { status: 400 });
    }
    if (!KINDS.has(kind)) {
      return NextResponse.json({ error: 'Некорректный kind' }, { status: 400 });
    }
    if (!OWNERSHIPS.has(ownership)) {
      return NextResponse.json({ error: 'Некорректный ownership' }, { status: 400 });
    }

    const payload: Record<string, unknown> = {
      name: String(name).trim(),
      kind,
      ownership,
      address: address || null,
      lat: lat != null && lat !== '' ? Number(lat) : null,
      lon: lon != null && lon !== '' ? Number(lon) : null,
      is_default: Boolean(is_default),
      active: Boolean(active),
      notes: notes || null,
      updated_at: new Date().toISOString(),
    };

    // external_key трогаем только если явно передали — иначе sync-связь не сотрётся
    if (Object.prototype.hasOwnProperty.call(body, 'external_key')) {
      payload.external_key = external_key || null;
    }

    if (payload.is_default) {
      await supabase
        .from('loading_points')
        .update({ is_default: false, updated_at: new Date().toISOString() })
        .eq('kind', kind)
        .eq('is_default', true);
    }

    if (id) {
      let existingExternalKey: string | null = null;
      if (Boolean(active)) {
        const { data: existing } = await supabase
          .from('loading_points')
          .select('external_key')
          .eq('id', id)
          .maybeSingle();
        existingExternalKey = Object.prototype.hasOwnProperty.call(body, 'external_key')
          ? external_key || null
          : existing?.external_key || null;
        const blocked = await assertCompetitorAllowsActivePoint(existingExternalKey);
        if (blocked) return blocked;
      }

      const { data, error } = await supabase
        .from('loading_points')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return NextResponse.json({ success: true, data });
    }

    const insertPayload = {
      ...payload,
      external_key: external_key || null,
    };
    delete (insertPayload as { updated_at?: string }).updated_at;
    const { data, error } = await supabase
      .from('loading_points')
      .insert([insertPayload])
      .select()
      .single();
    if (error) throw error;
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    console.error('loading-points POST', e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) return auth.error;

  try {
    const id = Number(request.nextUrl.searchParams.get('id'));
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 });
    }
    const { error } = await supabase
      .from('loading_points')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
