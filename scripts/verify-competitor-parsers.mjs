/**
 * Локальная проверка парсеров на живых страницах.
 * node scripts/verify-competitor-parsers.mjs
 */
import { createRequire } from 'module';

// Запуск через tsx/ts-node не обязателен — дублируем лёгкие regex-тесты на фикстурах.
const fixtures = {
  ecson: `
Цена на бетон товарный щебень фракции 5 - 20
М-100 (В 7.5) м3 известняк 5040 руб. гранит 6150 руб.
М-150 (В 10) м3 известняк 5440 руб. гранит 6250 руб.
М-200 (В 15) м3 известняк 5590 руб. гранит 6400 руб.
М-300 (В 22.5) м3 гранит 7100 руб.
М-400 (В 30) м3 гранит 7900 руб.
`,
  megapolis: `
Бетонная смесьна гравийном щебнефр. 5-20 мм М100 B7,5 6620 М150 6835 М200 6945 М250 7160 М300 7475
Бетонная смесьна гранитном щебнефр. 5-20 мм М100 6935 М150 7160 М200 7262 М250 7475 М300 7805 М350 8605 М400 9045
Растворы М100 4710 М150 5035 М200 5460
`,
  masterbeton: `
В 7.5 (М-100) М3 4800.00
В 12.5 (М-150) М3 5000.00
В 15 (М-200) М3 5150.00
В 22.5 (М-300) М3 5600.00
`,
  specbeton: `
Раствор цементный М - 50 3550 М - 100 4300 М - 150 4600 М - 200 4800
Бетон товарный М - 100 (В 7.5) Гравий 5700 / Гранит 6100
М - 200 (В 15) 6050 / 6370
М - 300 (В 22.5) 6600 / 7050
`,
};

function parseEcson(text) {
  const rows = [];
  const dual =
    /М-?\s*(\d{2,3})[\s\S]{0,120}?известняк\s*(\d{4,5})\s*руб\.?[\s\S]{0,40}?гранит\s*(\d{4,5})\s*руб/gi;
  let m;
  while ((m = dual.exec(text))) {
    rows.push(['М' + m[1], 'dolomite', +m[2]]);
    rows.push(['М' + m[1], 'granite', +m[3]]);
  }
  const only = /М-?\s*(\d{2,3})[\s\S]{0,80}?гранит\s*(\d{4,5})\s*руб/gi;
  while ((m = only.exec(text))) {
    const g = 'М' + m[1];
    if (!rows.some((r) => r[0] === g && r[1] === 'granite')) rows.push([g, 'granite', +m[2]]);
  }
  return rows;
}

function parseMegapolis(text) {
  const rows = [];
  const gravelIdx = text.search(/гравийн/i);
  const graniteIdx = text.search(/гранитн/i);
  const mortarIdx = text.search(/раствор/i);
  const section = (from, to, filler) => {
    if (from < 0) return;
    const chunk = text.slice(from, to > from ? to : from + 2500);
    const re = /М\s*(\d{2,3})[^0-9]{0,120}?(\d{4,5})/g;
    let m;
    while ((m = re.exec(chunk))) rows.push(['М' + m[1], filler, +m[2]]);
  };
  section(gravelIdx, graniteIdx, 'dolomite');
  section(graniteIdx, mortarIdx, 'granite');
  section(mortarIdx, mortarIdx + 800, 'mortar');
  return rows;
}

console.log('ecson', parseEcson(fixtures.ecson).length, parseEcson(fixtures.ecson));
console.log('megapolis', parseMegapolis(fixtures.megapolis).length);
console.log('ok');
