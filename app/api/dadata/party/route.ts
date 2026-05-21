// app/api/dadata/party/route.ts
import { NextRequest, NextResponse } from 'next/server';

const DADATA_TOKEN = process.env.DADATA_API_KEY; // добавь в .env.local

export async function POST(req: NextRequest) {
  const { query } = await req.json();

  const res = await fetch('https://suggestions.dadata.ru/suggestions/api/4_1/rs/findById/party', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Token ${DADATA_TOKEN}`,
    },
    body: JSON.stringify({ query }),
  });

  const data = await res.json();
  return NextResponse.json(data);
}