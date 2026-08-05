/**
 * Информация о сборке (продакшен).
 * Обновляется скриптом `scripts/bump-build.mjs` перед каждым деплоем в main.
 * Не править вручную при обычной разработке — только через bump.
 *
 * Формат версии: MAJOR.MINOR.PATCH (старт с 1.0.1).
 * При каждом деплое поднимается PATCH: 1.0.1 → 1.0.2 → …
 */
export const BUILD_VERSION = '1.0.30';

/** Дата/время сборки в формате ДД.ММ.ГГГГ ЧЧ:ММ (Москва). Пишется при деплое целиком. */
export const BUILD_AT = '05.08.2026 13:12';

/** Короткий ярлык: «v1.0.1» */
export function formatBuildVersion(): string {
  return `v${BUILD_VERSION}`;
}

/** Дата без времени: «29.07.2026» */
export function formatBuildDate(): string {
  return BUILD_AT.split(' ')[0] ?? BUILD_AT;
}

/** Строка для подвала: «v1.0.1 · ДД.ММ.ГГГГ» (без времени) */
export function formatBuildLabel(): string {
  return `v${BUILD_VERSION} · ${formatBuildDate()}`;
}

/** Полная метка с временем: «v1.0.1 · ДД.ММ.ГГГГ ЧЧ:ММ» (для title/тултипа) */
export function formatBuildLabelFull(): string {
  return `v${BUILD_VERSION} · ${BUILD_AT}`;
}
