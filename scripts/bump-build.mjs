#!/usr/bin/env node
/**
 * Поднимает PATCH-версию сборки (1.0.1 → 1.0.2) и проставляет дату+время (Europe/Moscow).
 * Запускать перед коммитом деплоя в production (main).
 *
 *   node scripts/bump-build.mjs
 *
 * В `BUILD_AT` пишется «ДД.ММ.ГГГГ ЧЧ:ММ».
 * В подвале UI показывается только дата (`formatBuildLabel`), время — в BUILD_AT и в title.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, '..', 'lib', 'buildInfo.ts');
const src = fs.readFileSync(file, 'utf8');

const m = src.match(/export const BUILD_VERSION = '(\d+)\.(\d+)\.(\d+)';/);
if (!m) {
  console.error("Не найден BUILD_VERSION вида 'X.Y.Z' в lib/buildInfo.ts");
  process.exit(1);
}

const major = Number(m[1]);
const minor = Number(m[2]);
const patch = Number(m[3]) + 1;
const next = `${major}.${minor}.${patch}`;

const now = new Date();
const fmt = new Intl.DateTimeFormat('ru-RU', {
  timeZone: 'Europe/Moscow',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});
const builtAt = fmt.format(now).replace(',', '');

const out = [
  '/**',
  ' * Информация о сборке (продакшен).',
  ' * Обновляется скриптом `scripts/bump-build.mjs` перед каждым деплоем в main.',
  ' * Не править вручную при обычной разработке — только через bump.',
  ' *',
  ' * Формат версии: MAJOR.MINOR.PATCH (старт с 1.0.1).',
  ' * При каждом деплое поднимается PATCH: 1.0.1 → 1.0.2 → …',
  ' */',
  `export const BUILD_VERSION = '${next}';`,
  '',
  '/** Дата/время сборки в формате ДД.ММ.ГГГГ ЧЧ:ММ (Москва). Пишется при деплое целиком. */',
  `export const BUILD_AT = '${builtAt}';`,
  '',
  '/** Короткий ярлык: «v1.0.1» */',
  'export function formatBuildVersion(): string {',
  '  return `v${BUILD_VERSION}`;',
  '}',
  '',
  '/** Дата без времени: «29.07.2026» */',
  'export function formatBuildDate(): string {',
  "  return BUILD_AT.split(' ')[0] ?? BUILD_AT;",
  '}',
  '',
  '/** Строка для подвала: «v1.0.1 · ДД.ММ.ГГГГ» (без времени) */',
  'export function formatBuildLabel(): string {',
  '  return `v${BUILD_VERSION} · ${formatBuildDate()}`;',
  '}',
  '',
  '/** Полная метка с временем: «v1.0.1 · ДД.ММ.ГГГГ ЧЧ:ММ» (для title/тултипа) */',
  'export function formatBuildLabelFull(): string {',
  '  return `v${BUILD_VERSION} · ${BUILD_AT}`;',
  '}',
  '',
].join('\n');

fs.writeFileSync(file, out, 'utf8');
console.log(`✅ ${next} · ${builtAt}`);
