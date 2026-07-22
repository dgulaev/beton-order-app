// app/api/dadata/party/route.ts
import { NextRequest, NextResponse } from 'next/server';

const DADATA_TOKEN = process.env.DADATA_API_KEY;

export async function POST(req: NextRequest) {
  try {
    if (!DADATA_TOKEN) {
      return NextResponse.json({ error: 'DADATA_API_KEY не задан' }, { status: 500 });
    }

    const { query, mode } = await req.json();
    const q = String(query || '').trim();
    if (!q) {
      return NextResponse.json({ suggestions: [] });
    }

    // findById — по ИНН/ОГРН; suggest — по названию организации.
    // Если mode не передан: цифры 10–12 → findById, иначе suggest.
    const digits = q.replace(/\D/g, '');
    const useFindById =
      mode === 'findById' ||
      (mode !== 'suggest' && (digits.length === 10 || digits.length === 12) && digits === q.replace(/\s/g, ''));

    const url = useFindById
      ? 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party'
      : 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/party';

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Token ${DADATA_TOKEN}`,
      },
      body: JSON.stringify({ query: useFindById ? digits : q, count: 5 }),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.ok ? 200 : res.status });
  } catch (error: any) {
    console.error('DaData party error:', error);
    return NextResponse.json({ error: error.message || 'Ошибка DaData' }, { status: 500 });
  }
}
