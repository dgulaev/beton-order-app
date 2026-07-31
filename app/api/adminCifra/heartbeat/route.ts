// app/api/adminCifra/heartbeat/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { ADMIN_CIFRA_STAFF_ROLES } from '@/lib/adminCifraAuth';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const ALLOWED = new Set(ADMIN_CIFRA_STAFF_ROLES.map((r) => r.toLowerCase()));

export async function POST(request: NextRequest) {
  try {
    const rawHeader = request.headers.get('x-user-id');
    const headerId = rawHeader ? parseInt(rawHeader, 10) : NaN;
    if (!Number.isFinite(headerId) || headerId <= 0) {
      return NextResponse.json({ error: 'Доступ запрещён' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const rawBodyId = body?.userId;
    const bodyId = rawBodyId != null ? parseInt(String(rawBodyId), 10) : NaN;

    // Body userId (если есть) обязан совпадать с сессией — иначе подмена «онлайна»
    if (Number.isFinite(bodyId) && bodyId > 0 && bodyId !== headerId) {
      return NextResponse.json({ success: false, message: 'userId mismatch' }, { status: 403 });
    }

    const parsedId = headerId;

    const { data: user, error: userErr } = await supabase
      .from('users')
      .select('user_id, role, force_logout_version')
      .eq('user_id', parsedId)
      .maybeSingle();

    if (userErr) {
      console.error('Heartbeat users lookup:', userErr);
      return NextResponse.json(
        { success: false, message: 'upstream', code: 'auth_upstream' },
        { status: 503 },
      );
    }

    if (!user) {
      return NextResponse.json({ success: false, forcedLogout: true }, { status: 403 });
    }

    const role = String(user.role || '').toLowerCase();
    if (!ALLOWED.has(role) || role === 'guest') {
      return NextResponse.json({ success: false, message: 'role' }, { status: 403 });
    }

    // Force-logout: убираем из «Кто в онлайн» и сигналим клиенту
    if (Number(user.force_logout_version || 0) > 0) {
      await supabase.from('active_sessions').delete().eq('user_id', parsedId);
      return NextResponse.json({ success: false, forcedLogout: true }, { status: 403 });
    }

    // x-forwarded-for может содержать список через запятую (клиент, затем
    // промежуточные прокси/CDN) — реальный IP клиента всегда первый в списке.
    const forwardedFor = request.headers.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0]?.trim()
      || request.headers.get('x-real-ip')?.trim()
      || 'unknown';
    const userAgent = request.headers.get('user-agent') || 'unknown';

    const { error } = await supabase
      .from('active_sessions')
      .upsert({
        user_id: parsedId,
        ip,
        user_agent: userAgent,
        last_active: new Date().toISOString(),
      }, {
        onConflict: 'user_id',
      });

    if (error) {
      console.error('Heartbeat error:', error);
      return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Heartbeat catch:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
