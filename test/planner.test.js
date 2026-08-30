/* Headless test harness for meal-planner.html
 *
 *   node test/planner.test.js
 *
 * There is no build step and no test runner. This pulls the <script> block out of
 * the HTML, stubs just enough DOM to let it evaluate, then hammers the generator
 * and checks the invariants documented in CLAUDE.md.
 *
 * Averages over thousands of weeks are the point. Every bug this app has had —
 * oats on consecutive mornings, batches cooked twice, food prepped past its shelf
 * life — looked fine in a single generated week.
 */

const fs = require('fs');
const path = require('path');

/* The app file is index.html when deployed to GitHub Pages, but may be named
   meal-planner.html locally. Accept either, or an explicit path:
     node test/planner.test.js path/to/file.html
     APP=path/to/file.html node test/planner.test.js                        */
const ROOT = path.join(__dirname, '..');
const CANDIDATES = [process.argv[2], process.env.APP, 'index.html', 'meal-planner.html']
  .filter(Boolean)
  .map(f => path.isAbsolute(f) ? f : path.join(ROOT, f));

const HTML = CANDIDATES.find(f => fs.existsSync(f));
if (!HTML) {
  console.error(`\nCould not find the app file. Looked for:\n${CANDIDATES.map(f => '  ' + f).join('\n')}\n`);
  console.error('Pass the path explicitly:  node test/planner.test.js your-file.html\n');
  process.exit(1);
}

const WEEKS = Number(process.env.WEEKS || 2000);
const SLOT_KEYS = ['breakfast', 'snack1', 'lunch', 'dinner', 'snack2'];

/* ---------- load the app with a stubbed browser ---------- */
function loadApp() {
  const html = fs.readFileSync(HTML, 'utf8');
  const src = html.split('<script>')[1].split('</script>')[0].replace(/\nload\(\);/, '');

  const node = () => ({
    innerHTML: '', textContent: '', scrollTop: 0, dataset: {}, className: '',
    style: {}, disabled: false,
    focus() {}, click() {}, appendChild() {}, setAttribute() {},
    querySelectorAll: () => [], classList: { add() {}, remove() {}, toggle() {} },
    set onclick(v) {}
  });

  const store = {};
  global.localStorage = { getItem: k => store[k] || null, setItem: (k, v) => { store[k] = v; } };
  global.window = { addEventListener() {} };
  global.location = { href: 'https://example.com/', hash: '' };
  global.document = { getElementById: node, createElement: node, addEventListener() {}, querySelectorAll: () => [] };
  global.Blob = function () {};
  global.URL = { createObjectURL: () => '', revokeObjectURL() {} };
  global.btoa = s => Buffer.from(s, 'binary').toString('base64');
  global.atob = s => { if (s.length % 4) throw new Error('bad base64 padding'); return Buffer.from(s, 'base64').toString('binary'); };
  global.fetch = async () => { throw new Error('offline in tests'); };

  const api = {};
  const exportNames = ['MEALS', 'PREP', 'KINDY', 'TARGETS', 'DAILY', 'DAYS', 'SLOTS',
                       'buildWeek', 'prepPlan', 'byId', 'pool', 'cal', 'pro',
                       'encodeState', 'decodeState'];
  eval(src + '\n'
     + exportNames.map(n => `try{api.${n}=${n}}catch(e){}`).join(';')
     + ';api.setState = s => { state = s; };');
  return api;
}

/* ---------- tiny assertion helpers ---------- */
let failures = 0;
function check(name, ok, detail) {
  if (ok) { console.log(`  \u2713 ${name}`); }
  else { failures++; console.log(`  \u2717 ${name}${detail ? ' \u2014 ' + detail : ''}`); }
}
const avg = a => Math.round(a.reduce((x, y) => x + y, 0) / a.length);

/* ---------- run ---------- */
const app = loadApp();
const { MEALS, PREP, TARGETS, DAILY, DAYS, buildWeek, prepPlan, byId, pool, cal, pro } = app;

console.log(`\n${path.basename(HTML)} \u2014 ${MEALS.length} meals, ${Object.keys(PREP).length} prep items, ${WEEKS} simulated weeks\n`);

/* --- static data --- */
console.log('data integrity');
const noPortions = MEALS.filter(m => !m.portions || !m.portions.length).map(m => m.id);
check('every meal has portions', noPortions.length === 0, noPortions.join(', '));

const badBase = MEALS.filter(m => m.base && !PREP[m.base]).map(m => m.id);
check('every meal base exists in PREP', badBase.length === 0, badBase.join(', '));

const noKeeps = Object.keys(PREP).filter(k => !PREP[k].keeps);
check('every prep item declares a shelf life', noKeeps.length === 0, noKeeps.join(', '));

const CATS = ['Meat & fish', 'Fruit & veg', 'Dairy & eggs', 'Bakery', 'Frozen', 'Pantry'];
const badCat = [];
MEALS.forEach(m => (m.buy || []).forEach(b => { if (!CATS.includes(b.c)) badCat.push(`${m.id}:${b.c}`); }));
Object.entries(PREP).forEach(([k, p]) => (p.buy || []).forEach(b => { if (!CATS.includes(b.c)) badCat.push(`${k}:${b.c}`); }));
check('shopping categories are all valid', badCat.length === 0, badCat.join(', '));

const budgetSum = SLOT_KEYS.reduce((s, k) => s + TARGETS[k], 0);
check(`slot budgets sum to ${DAILY.cal}`, budgetSum === DAILY.cal, `got ${budgetSum}`);

const thinBases = Object.keys(PREP).filter(b => {
  const n = pool('dinner').filter(d => d.base === b).length;
  return n === 1;
});
check('each prep base backs 0 or 2+ dinners', thinBases.length === 0,
      `only one dinner for: ${thinBases.join(', ')} (inflates prep time)`);

/* --- generated weeks --- */
console.log('\ngenerated weeks');
let slotMismatch = 0, oatsAdjacent = 0, oatsWeekend = 0, breakfastRunOf3 = 0,
    lunchRepeat = 0, shelfViolations = 0, emptySlots = 0;
const dupeCooks = {};
const sunMins = [], midMins = [], dayCal = [], dayPro = [];

const live = { current: { days: buildWeek(), kindy: [3, 4], locked: false },
               next:    { days: buildWeek(), kindy: [3, 4], locked: false },
               view: 'current' };
app.setState(live);

for (let i = 0; i < WEEKS; i++) {
  const days = buildWeek();
  live.current.days = days;

  days.forEach(d => {
    let c = 0, p = 0;
    SLOT_KEYS.forEach(k => {
      const m = byId(d[k]);
      if (!m) { emptySlots++; return; }
      if (m.slot !== k) slotMismatch++;
      c += cal(m); p += pro(m);
    });
    dayCal.push(c); dayPro.push(p);
  });

  const b = days.map(d => d.breakfast);
  for (let j = 1; j < 7; j++) if (b[j] === 'b-oats' && b[j - 1] === 'b-oats') oatsAdjacent++;
  for (let j = 2; j < 7; j++) if (b[j] === b[j - 1] && b[j - 1] === b[j - 2]) breakfastRunOf3++;
  if (b[5] === 'b-oats' || b[6] === 'b-oats') oatsWeekend++;

  const l = days.map(d => d.lunch);
  for (let j = 1; j < 7; j++) if (l[j] === l[j - 1] && l[j] !== 'l-reheat') lunchRepeat++;

  const plan = prepPlan();
  sunMins.push(plan.sundayMins); midMins.push(plan.midweekMins);

  plan.sunday.forEach(x => x.days.forEach(d => { if (d > x.keeps) shelfViolations++; }));
  plan.midweek.forEach(x => (x.days || []).forEach(d => {
    if (d - 3 > x.keeps && !(x.late || []).includes(d)) shelfViolations++;
  }));

  const inSun = new Set(plan.sunday.map(x => x.id));
  plan.midweek.forEach(x => { if (inSun.has(x.id)) dupeCooks[x.id] = (dupeCooks[x.id] || 0) + 1; });
}

check('meals always land in their own slot', slotMismatch === 0, `${slotMismatch} mismatches`);
check('no empty slots', emptySlots === 0, `${emptySlots} empty`);
check('oats never on consecutive mornings', oatsAdjacent === 0, `${oatsAdjacent} occurrences`);
check('oats never on a weekend', oatsWeekend === 0, `${oatsWeekend} occurrences`);
check('no breakfast three days running', breakfastRunOf3 === 0, `${breakfastRunOf3} occurrences`);
check('no lunch repeated back to back', lunchRepeat === 0, `${lunchRepeat} occurrences`);
check('nothing prepped past its shelf life', shelfViolations === 0, `${shelfViolations} violations`);

/* Only assembly items and the 2-day marinade may appear in both sessions. */
const ALLOWED_DUPES = ['oats', 'crunch-box', 'joojeh'];
const badDupes = Object.keys(dupeCooks).filter(k => !ALLOWED_DUPES.includes(k));
check('no batch protein cooked twice in a week', badDupes.length === 0,
      badDupes.map(k => `${k} \u00d7${dupeCooks[k]}`).join(', '));

/* --- budgets --- */
console.log('\nbudgets (informational, not pass/fail)');
console.log(`  daily calories  avg ${avg(dayCal)}  (target ${DAILY.cal}, range ${Math.min(...dayCal)}\u2013${Math.max(...dayCal)})`);
console.log(`  daily protein   avg ${avg(dayPro)}g (target ${DAILY.protein}g, min ${Math.min(...dayPro)}g)`);
console.log(`  Sunday prep     avg ${avg(sunMins)} min`);
console.log(`  Wednesday prep  avg ${avg(midMins)} min`);
console.log(`  total prep      avg ${avg(sunMins) + avg(midMins)} min`);

const drift = Math.abs(avg(dayCal) - DAILY.cal);
if (drift > 120) console.log(`\n  ! average day is ${drift} kcal off target \u2014 consider rebalancing TARGETS or portion sizes`);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
