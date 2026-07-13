// app/api/geocode/route.ts
// Геокодирование адреса в координаты через DaData (для построения маршрутов
// в Яндекс.Картах). Ключ держим только на сервере, поэтому обычная ссылка
// <a href="https://yandex.ru/maps/?rtext=адрес~адрес"> недостаточно надёжна:
// Яндекс.Браузер (и, судя по всему, другие Chromium-based браузеры на
// телефоне) передаёт такую ссылку напрямую в приложение Яндекс.Карт, минуя
// геокодер веб-версии, а приложение понимает в rtext только координаты
// "lat,lon~lat,lon". Поэтому перед построением ссылки адрес нужно превратить
// в координаты здесь, на сервере.
import { NextRequest, NextResponse } from 'next/server';

const DADATA_TOKEN = process.env.DADATA_API_KEY;
const DADATA_URL = 'https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address';

type DadataSuggestion = { data: { geo_lat: string | null; geo_lon: string | null } };

async function suggest(query: string, toBound?: string): Promise<DadataSuggestion[]> {
  const body: Record<string, unknown> = {
    query,
    count: 5,
    // Регион по умолчанию — вся доставка в Брянской области, это отсекает
    // случайные совпадения названий населённых пунктов/СНТ в других регионах
    // (например "СНТ Восход" есть и в Брянской, и в Смоленской области).
    locations: [{ region: 'Брянская' }],
  };
  if (toBound) body.to_bound = { value: toBound };

  const res = await fetch(DADATA_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Token ${DADATA_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) return [];
  const data = await res.json();
  return data?.suggestions || [];
}

/**
 * Геокодирует адрес с постепенным "упрощением" запроса, если точного
 * совпадения не нашлось. DaData возвращает ПУСТОЙ список предложений, если
 * какой-то хвост адреса (например номер дома, которого нет в её базе —
 * новостройка, частный сектор, СНТ) не удаётся сопоставить, даже если улица
 * и город распознаются отлично. Чтобы маршрут всё равно строился (пусть и до
 * улицы/города, а не точного дома — это всё равно многократно лучше, чем
 * никакого маршрута), при пустом результате отрезаем последний фрагмент
 * адреса (после запятой) и пробуем снова, максимум 3 раза.
 */
async function geocodeWithFallback(rawQuery: string): Promise<{ lat: number; lon: number } | null> {
  let query = rawQuery;

  for (let attempt = 0; attempt < 4; attempt++) {
    const suggestions = await suggest(query);

    // Берём ПЕРВОЕ предложение, у которого реально есть координаты — самое
    // релевантное совпадение (например просто "Брянск") часто оказывается на
    // первом месте без geo_lat/geo_lon (это агрегат уровня области), а нужный
    // нам город/улица с координатами — на втором.
    const withCoords = suggestions.find((s) => s.data.geo_lat && s.data.geo_lon);
    if (withCoords) {
      return { lat: parseFloat(withCoords.data.geo_lat!), lon: parseFloat(withCoords.data.geo_lon!) };
    }

    const parts = query.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length <= 1) break;
    parts.pop();
    query = parts.join(', ');
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const { address } = await req.json();
    const query = (address || '').trim();

    if (!query || !DADATA_TOKEN) {
      return NextResponse.json({ lat: null, lon: null });
    }

    const coords = await geocodeWithFallback(query);
    if (!coords) {
      return NextResponse.json({ lat: null, lon: null });
    }

    return NextResponse.json(coords);
  } catch (err) {
    console.error('Ошибка геокодирования адреса:', err);
    return NextResponse.json({ lat: null, lon: null });
  }
}
