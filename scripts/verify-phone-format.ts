import { formatPhoneDisplay } from '../lib/phone';

const cases: Array<[string, string]> = [
  ['+79003650044', '+7 900 365-00-44'],
  ['89003650044', '+7 900 365-00-44'],
  ['84832321303', '+7 (4832) 32-13-03'],
  ['+7 (4832) 32-13-03', '+7 (4832) 32-13-03'],
  ['84951234567', '+7 (495) 123-45-67'],
  ['88121234567', '+7 (812) 123-45-67'],
];

let fail = 0;
for (const [raw, expect] of cases) {
  const got = formatPhoneDisplay(raw);
  const ok = got === expect;
  console.log(ok ? '✓' : '✗', raw, '→', got, ok ? '' : `(ожидали ${expect})`);
  if (!ok) fail += 1;
}

if (fail) {
  console.error(`FAIL: ${fail}`);
  process.exit(1);
}
console.log('OK phone format');
