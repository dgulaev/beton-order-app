import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_CIFRA_STAFF_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { setCompetitorLoadingPointsActive } from '@/lib/competitors/loadingPointLink';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ADMIN_CIFRA_STAFF_ROLES);
  if (auth.error) return auth.error;

  try {
    const activeOnly = request.nextUrl.searchParams.get('active') !== '0';
    let query = supabase
      .from('competitors')
      .select('*')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true });
    if (activeOnly) query = query.eq('active', true);

    const { data, error } = await query;
    if (error) {
      if (/competitors/i.test(error.message)) return NextResponse.json([]);
      throw error;
    }
    return NextResponse.json(data || []);
  } catch (e: any) {
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
      short_name,
      website,
      phone,
      contact,
      address,
      lat,
      lon,
      active = true,
      notes,
      parser_key,
      sort_order = 100,
    } = body;
    void contact;

    if (!name || !String(name).trim()) {
      return NextResponse.json({ error: 'Название обязательно' }, { status: 400 });
    }

    const payload = {
      name: String(name).trim(),
      short_name: short_name || null,
      website: website || null,
      phone: phone || null,
      contact: contact || null,
      address: address || null,
      lat: lat != null && lat !== '' ? Number(lat) : null,
      lon: lon != null && lon !== '' ? Number(lon) : null,
      active: Boolean(active),
      notes: notes || null,
      parser_key: parser_key || null,
      sort_order: Number(sort_order) || 100,
      updated_at: new Date().toISOString(),
    };

    if (id) {
      const { data, error } = await supabase
        .from('competitors')
        .update(payload)
        .eq('id', id)
        .select()
        .single();
      if (error) {
        if (/unique|duplicate|parser_key/i.test(error.message)) {
          return NextResponse.json(
            { error: 'Такой parser_key уже занят другим конкурентом' },
            { status: 409 },
          );
        }
        throw error;
      }
      await setCompetitorLoadingPointsActive(supabase, data, Boolean(active));
      return NextResponse.json({ success: true, data });
    }

    const { updated_at: _u, ...ins } = payload;
    void _u;
    const { data, error } = await supabase.from('competitors').insert([ins]).select().single();
    if (error) {
      if (/unique|duplicate|parser_key/i.test(error.message)) {
        return NextResponse.json(
          { error: 'Такой parser_key уже занят другим конкурентом' },
          { status: 409 },
        );
      }
      throw error;
    }
    return NextResponse.json({ success: true, data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, ['admin']);
  if (auth.error) return auth.error;

  try {
    const id = Number(request.nextUrl.searchParams.get('id'));
    const hard = request.nextUrl.searchParams.get('hard') === '1';
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json({ error: 'id обязателен' }, { status: 400 });
    }

    const { data: row } = await supabase
      .from('competitors')
      .select('id, name, short_name, parser_key')
      .eq('id', id)
      .maybeSingle();

    if (hard) {
      await supabase.from('competitor_price_snapshots').delete().eq('competitor_id', id);
      if (row) {
        // Точку не удаляем (может быть в заявках) — только скрываем
        await setCompetitorLoadingPointsActive(supabase, row, false);
      }
      const { error } = await supabase.from('competitors').delete().eq('id', id);
      if (error) throw error;
      return NextResponse.json({ success: true, hard: true });
    }

    const { error } = await supabase
      .from('competitors')
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
    if (row) await setCompetitorLoadingPointsActive(supabase, row, false);
    return NextResponse.json({ success: true, hard: false });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
