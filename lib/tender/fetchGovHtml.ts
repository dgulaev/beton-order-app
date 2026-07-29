import https from 'node:https';
import { URL } from 'node:url';

/**
 * Российские госсайты (zakupki.gov.ru и др.) часто отдают цепочку с корневым
 * сертификатом, который Node/браузеры без системных CA не доверяют.
 * Для чтения публичных карточек ЕИС допускаем insecure TLS только на этих хостах.
 */
const INSECURE_TLS_HOSTS = new Set([
  'zakupki.gov.ru',
  'www.zakupki.gov.ru',
]);

const MAX_REDIRECTS = 5;

function needsInsecureTls(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (INSECURE_TLS_HOSTS.has(h)) return true;
  return h.endsWith('.gosuslugi.ru') || h.endsWith('.gov.ru');
}

function fetchOnce(
  urlStr: string,
  timeoutMs: number,
): Promise<{ status: number; location: string | null; body: string }> {
  const url = new URL(urlStr);
  const insecure = needsInsecureTls(url.hostname);

  return new Promise((resolve, reject) => {
    let settled = false;
    const req = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        servername: url.hostname,
        rejectUnauthorized: !insecure,
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          if (settled) return;
          settled = true;
          const status = res.statusCode || 0;
          const loc = res.headers.location;
          const location =
            typeof loc === 'string' ? loc : Array.isArray(loc) ? loc[0] || null : null;
          resolve({
            status,
            location,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      if (!settled) {
        settled = true;
        reject(new Error(`Таймаут ${timeoutMs}ms`));
      }
    });
    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    req.end();
  });
}

/**
 * Скачать HTML (или любой текст) с публичной страницы ЕИС/госсайта.
 * На zakupki.gov.ru — с обходом проверки сертификата (иначе TLS fails).
 * Следуем редиректам (до MAX_REDIRECTS).
 */
export async function fetchGovHtml(
  urlStr: string,
  opts?: { timeoutMs?: number },
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 30_000;
  let current = urlStr;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const { status, location, body } = await fetchOnce(current, timeoutMs);

    if (status >= 300 && status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }

    if (status < 200 || status >= 400) {
      throw new Error(`Не удалось открыть страницу (${status})`);
    }
    if (!body || body.length < 200) {
      throw new Error('Пустой ответ площадки');
    }
    return body;
  }

  throw new Error(`Слишком много редиректов (>${MAX_REDIRECTS})`);
}
