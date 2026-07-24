// app/api/adminCifra/heartbeat/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();
    if (!userId) return NextResponse.json({ success: false }, { status: 400 });

    const parsedId = parseInt(String(userId), 10);
    if (!Number.isFinite(parsedId) || parsedId <= 0) {
      return NextResponse.json({ success: false }, { status: 400 });
    }

    // Выкинутый force-logout не должен светиться в «Кто в онлайн»
    const { data: user } = await supabase
      .from('users')
      .select('force_logout_version')
      .eq('user_id', parsedId)
      .maybeSingle();

    if (!user) {
      return NextResponse.json({ success: false, forcedLogout: true }, { status: 403 });
    }

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
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Heartbeat catch:', error);
    return NextResponse.json({ success: false }, { status: 500 });
  }
}
