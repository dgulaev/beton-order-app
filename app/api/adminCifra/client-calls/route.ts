// app/api/adminCifra/client-calls/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get('clientId');

    if (!clientId) {
      return NextResponse.json({ error: 'clientId обязателен' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('client_calls')
      .select('*')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Ошибка получения звонков:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

   // console.log(`📞 Загружено ${data?.length || 0} звонков для клиента ${clientId}`);
    return NextResponse.json(data || []);
  } catch (err: any) {
    console.error('❌ Ошибка в client-calls API:', err);
    return NextResponse.json({ error: err.message || 'Внутренняя ошибка' }, { status: 500 });
  }
}