/**
 * fetch с жёстким таймаутом (AbortController + Promise.race).
 *
 * На Samsung Internet AbortController.abort() иногда не рвёт зависший запрос —
 * полоска загрузки висит 60–70 с (TCP timeout). Promise.race гарантирует, что
 * вызывающий код выйдет через timeoutMs даже если abort «не сработал».
 */

export const DEFAULT_FETCH_TIMEOUT_MS = 12_000;

export const FETCH_TIMEOUT_MESSAGE = 'Fetch timeout';

export type FetchWithTimeoutInit = RequestInit & { timeoutMs?: number };

/** AbortError от нашего таймаута (не «user aborted» от следующего тика/unmount). */
export function isFetchTimeoutError(err: unknown): boolean {
  return (
    err instanceof DOMException
    && err.name === 'AbortError'
    && String(err.message || '').includes(FETCH_TIMEOUT_MESSAGE)
  );
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: FetchWithTimeoutInit,
): Promise<Response> {
  const { timeoutMs = DEFAULT_FETCH_TIMEOUT_MS, signal: userSignal, ...rest } = init || {};
  const controller = new AbortController();

  let abortTimer: ReturnType<typeof setTimeout> | undefined;
  let raceTimer: ReturnType<typeof setTimeout> | undefined;

  const onUserAbort = () => {
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  };

  if (userSignal) {
    if (userSignal.aborted) onUserAbort();
    else userSignal.addEventListener('abort', onUserAbort, { once: true });
  }

  abortTimer = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  }, timeoutMs);

  const fetchPromise = fetch(input, { ...rest, signal: controller.signal });
  // Поздний abort после race не должен давать UnhandledRejection.
  void fetchPromise.catch(() => {});

  try {
    return await Promise.race([
      fetchPromise,
      new Promise<Response>((_, reject) => {
        raceTimer = setTimeout(() => {
          reject(new DOMException(FETCH_TIMEOUT_MESSAGE, 'AbortError'));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (abortTimer !== undefined) clearTimeout(abortTimer);
    if (raceTimer !== undefined) clearTimeout(raceTimer);
    if (userSignal) userSignal.removeEventListener('abort', onUserAbort);
  }
}

/** fetch без throw: сеть / таймаут → null. */
export async function safeFetch(
  input: RequestInfo | URL,
  init?: FetchWithTimeoutInit,
): Promise<Response | null> {
  try {
    return await fetchWithTimeout(input, init);
  } catch {
    return null;
  }
}
