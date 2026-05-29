// app/api/adminCifra/clients/assign/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const { clientId, staffId } = await request.json();

    if (!clientId || !staffId) {
      return NextResponse.json({ error: 'clientId и staffId обязательны' }, { status: 400 });
    }

    const { error } = await supabase
      .from('users')
      .update({ assigned_to: staffId })
      .eq('user_id', clientId);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Assign error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}