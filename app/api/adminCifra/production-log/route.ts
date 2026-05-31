import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ==================== GET — Получить список отгруженных рейсов ====================
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('production_logs')
      .select(`
        *,
        orders!inner (
          delivery_date,
          delivery_time
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase GET error:', error);
      return NextResponse.json([], { status: 500 });
    }

    return NextResponse.json(data || []);
  } catch (error: any) {
    console.error('Production log GET error:', error);
    return NextResponse.json([], { status: 500 });
  }
}

// ==================== POST — Запись новой отгрузки ====================
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const { 
      order_id, 
      order_mixer_id, 
      mixer_name, 
      concrete_grade, 
      volume, 
      podvizhnost,
      start_time 
    } = body;

    const end_time = new Date().toISOString();

    const durationMinutes = start_time 
      ? Math.round((new Date(end_time).getTime() - new Date(start_time).getTime()) / 60000) 
      : null;

    const { data, error } = await supabase
      .from('production_logs')
      .insert([{
        order_id,
        order_mixer_id,
        mixer_name,
        concrete_grade,
        volume,
        podvizhnost,
        start_time,
        end_time,
        duration_minutes: durationMinutes
      }])
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });

  } catch (error: any) {
    console.error('Production log POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}