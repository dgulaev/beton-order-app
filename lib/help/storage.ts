const COMPLETED_PREFIX = 'helpOnboardingCompleted:';
const READ_PREFIX = 'helpOnboardingRead:';

/** Старый ключ без роли — читаем для совместимости. */
function legacyCompletedKey(userId: number | string): string {
  return `${COMPLETED_PREFIX}${userId}`;
}

function completedKey(userId: number | string, role: string): string {
  return `${COMPLETED_PREFIX}${userId}:${role}`;
}

function readKey(userId: number | string, role: string): string {
  return `${READ_PREFIX}${userId}:${role}`;
}

export function isHelpOnboardingCompleted(
  userId: number | string | null | undefined,
  role?: string | null,
): boolean {
  if (userId == null || typeof window === 'undefined') return false;
  try {
    if (role) {
      if (localStorage.getItem(completedKey(userId, role)) === '1') return true;
    }
    // Совместимость со старым ключом без роли
    return localStorage.getItem(legacyCompletedKey(userId)) === '1';
  } catch {
    return false;
  }
}

export function markHelpOnboardingCompleted(
  userId: number | string,
  role?: string | null,
): void {
  if (typeof window === 'undefined') return;
  try {
    if (role) {
      localStorage.setItem(completedKey(userId, role), '1');
    }
    // Дублируем в legacy — чтобы старый код/вкладки тоже считали пройденным
    localStorage.setItem(legacyCompletedKey(userId), '1');
  } catch {
    /* ignore quota */
  }
}

export function loadHelpOnboardingReadIds(
  userId: number | string | null | undefined,
  role: string | null | undefined,
): string[] {
  if (userId == null || !role || typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(readKey(userId, role));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveHelpOnboardingReadIds(
  userId: number | string,
  role: string,
  ids: Iterable<string>,
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(readKey(userId, role), JSON.stringify([...ids]));
  } catch {
    /* ignore */
  }
}

export function resetHelpOnboarding(userId: number | string, role?: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(legacyCompletedKey(userId));
    if (role) {
      localStorage.removeItem(completedKey(userId, role));
      localStorage.removeItem(readKey(userId, role));
    }
  } catch {
    /* ignore */
  }
}
