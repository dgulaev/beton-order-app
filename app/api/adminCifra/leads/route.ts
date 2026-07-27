import { NextRequest, NextResponse } from 'next/server';
import { SALES_ROLES, requireAdminCifraStaff } from '@/lib/adminCifraAuth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { upsertLead } from '@/lib/leadService';
import type { LeadDraft } from '@/lib/leads';

export async function GET(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  const status = request.nextUrl.searchParams.get('status');
  const source = request.nextUrl.searchParams.get('source');
  const limit = Math.min(Number(request.nextUrl.searchParams.get('limit') || 100), 300);

  let query = supabaseAdmin
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (status) query = query.eq('status', status);
  if (source) query = query.eq('source', source);

  const { data, error } = await query;
  if (error) {
    console.error('[leads GET]', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, leads: data ?? [] });
}

/** Ручное создание лида (источник manual). */
export async function POST(request: NextRequest) {
  const auth = await requireAdminCifraStaff(request, SALES_ROLES);
  if (auth.error) return auth.error;

  try {
    const body = await request.json();
    // Ручное создание из админки — всегда manual (нельзя подменить source на avito/demand).
    let volume: number | null = null;
    if (body.volume_m3 != null && body.volume_m3 !== '') {
      const n = Number(body.volume_m3);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json({ success: false, error: 'Некорректный объём' }, { status: 400 });
      }
      volume = n;
    }

    const draft: LeadDraft = {
      source: 'manual',
      external_id: null,
      phone: body.phone ?? null,
      name: body.name ?? null,
      chat_url: null,
      raw_text: body.raw_text || body.comment || '',
      grade: body.grade ?? null,
      volume_m3: volume,
      address: body.address ?? null,
      city: body.city ?? null,
      desired_date: body.desired_date ?? null,
      status: 'new',
      score: 50,
      raw_payload: { created_by: auth.user.user_id },
    };

    const result = await upsertLead(draft);
    if (!result) {
      return NextResponse.json({ success: false, error: 'Не удалось создать лид' }, { status: 400 });
    }

    return NextResponse.json({ success: true, lead: result.lead, created: result.created });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Ошибка';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
