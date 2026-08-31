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
                       'basesOf', 'mainBases', 'STAPLES', 'parseQty', 'totalQty', 'shoppingList',
                       'generate', 'openSwap', 'rollover', 'WIRE_SLOTS', 'render', 'meatOf',
                       'openMeal', 'openPrep', 'openShop', 'openKindy',
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
/* Math.min(...arr) blows the stack past ~100k samples, which is exactly what
   WEEKS=20000 produces. Reduce instead. */
const min = a => a.reduce((x, y) => y < x ? y : x, Infinity);
const max = a => a.reduce((x, y) => y > x ? y : x, -Infinity);

/* ---------- run ---------- */
const app = loadApp();
const { MEALS, PREP, TARGETS, DAILY, DAYS, buildWeek, prepPlan, byId, pool, cal, pro,
        basesOf, mainBases, STAPLES, parseQty, totalQty, shoppingList } = app;

/* Which session covers a base for a given day, mirroring buildWeek. Day 0 is Monday. */
const sessionOf = (base, dayIdx) => (dayIdx + 1) <= (PREP[base].keeps || 4) ? 'sun' : 'mid';

console.log(`\n${path.basename(HTML)} \u2014 ${MEALS.length} meals, ${Object.keys(PREP).length} prep items, ${WEEKS} simulated weeks\n`);

/* --- static data --- */
console.log('data integrity');
const noPortions = MEALS.filter(m => !m.portions || !m.portions.length).map(m => m.id);
check('every meal has portions', noPortions.length === 0, noPortions.join(', '));

const declared = m => m.base ? (Array.isArray(m.base) ? m.base : [m.base]) : [];
const badBase = MEALS.filter(m => declared(m).some(b => !PREP[b])).map(m => m.id);
check('every meal base exists in PREP', badBase.length === 0, badBase.join(', '));

const noStorage = Object.keys(PREP).filter(k => !['fridge', 'freezer'].includes(PREP[k].storage));
check('every prep item says where it is stored', noStorage.length === 0, noStorage.join(', '));

/* Cooked rice is a prep item now. A meal that eats rice has to say so, or the rice
   never gets cooked and the meal quietly assumes leftovers that do not exist.
   Rice cakes, rice noodles and rice vinegar are not rice. */
const eatsRice = m => m.portions.some(x =>
  /\brice\b/i.test(x.n) && !/rice cake|rice noodle|rice vinegar/i.test(x.n));
const riceless = MEALS.filter(m => eatsRice(m) && !declared(m).includes('rice')).map(m => m.id);
check('every meal that eats rice depends on the rice prep', riceless.length === 0, riceless.join(', '));

const noKeeps = Object.keys(PREP).filter(k => !PREP[k].keeps);
check('every prep item declares a shelf life', noKeeps.length === 0, noKeeps.join(', '));

const CATS = ['Meat & fish', 'Fruit & veg', 'Dairy & eggs', 'Bakery', 'Frozen', 'Pantry'];
const badCat = [];
MEALS.forEach(m => (m.buy || []).forEach(b => { if (!CATS.includes(b.c)) badCat.push(`${m.id}:${b.c}`); }));
Object.entries(PREP).forEach(([k, p]) => (p.buy || []).forEach(b => { if (!CATS.includes(b.c)) badCat.push(`${k}:${b.c}`); }));
STAPLES.forEach(b => { if (!CATS.includes(b.c)) badCat.push(`STAPLES:${b.c}`); });
check('shopping categories are all valid', badCat.length === 0, badCat.join(', '));

/* One type of each staple. Two kinds of the same thing is one of them going off in
   the door of the fridge, so the shopping list may only ever name one milk, one
   rice and one bag of berries. Coconut milk, rice cakes and rice noodles are
   different groceries, not variants. */
const allBuys = [
  ...MEALS.flatMap(m => m.buy || []),
  ...Object.values(PREP).flatMap(p => p.buy || []),
  ...STAPLES
].map(b => b.n);
const ONE_OF = [
  { label: 'milk',    re: /milk/i,                  skip: /coconut/i },
  { label: 'rice',    re: /\brice\b/i,             skip: /cake|noodle|vinegar/i },
  { label: 'berries', re: /berr|blueberr|raspberr/i }
];
const manyTypes = ONE_OF
  .map(g => [g.label, [...new Set(allBuys.filter(n => g.re.test(n) && !(g.skip && g.skip.test(n))))]])
  .filter(([, names]) => names.length > 1);
check('only one type of milk, rice and berries on the shopping list',
      manyTypes.length === 0, manyTypes.map(([l, n]) => `${l}: ${n.join(' / ')}`).join('; '));

/* The shopping list adds amounts up (600g + 800g of thigh is 1.4kg) but takes one
   of anything sold as a container (three meals wanting soy sauce is one bottle).
   That only works if every source of an ingredient measures it the same way —
   "1 bag" and "4" cannot be combined, and the list falls back to printing both. */
const byName = {};
[...MEALS.flatMap(m => (m.buy || []).map(b => [m.id, b])),
 ...Object.entries(PREP).flatMap(([k, p]) => (p.buy || []).map(b => [k, b])),
 ...STAPLES.map(b => ['STAPLES', b])
].forEach(([id, b]) => (byName[b.n] = byName[b.n] || []).push({ id, q: b.q }));

const unparseable = [];
const mixedUnits = [];
Object.entries(byName).forEach(([n, rows]) => {
  if (rows.length < 2) return;                       // a lone line is printed as written
  const parsed = rows.map(r => parseQty(r.q));
  if (parsed.some(x => !x)) { unparseable.push(`${n}: ${rows.map(r => r.q).join(' / ')}`); return; }
  if (new Set(parsed.map(x => x.u)).size > 1) mixedUnits.push(`${n}: ${rows.map(r => r.q).join(' / ')}`);
});
check('every shared ingredient has a readable quantity', unparseable.length === 0, unparseable.join('; '));
check('sources of the same ingredient agree on the unit', mixedUnits.length === 0, mixedUnits.join('; '));

const qtyCases = [
  [['600g', '800g'], '1.4kg'],          // three batches of chicken really is more chicken
  [['1 jar', '1 jar', '1 jar'], '1 jar'],  // however many meals want it, it is one jar
  [['2', '2', '2'], '6'],
  [['250ml', '250ml'], '500ml'],
  [['1 × 400g', '1 × 400g'], '2 × 400g']
];
const qtyBad = qtyCases.filter(([qs, want]) => totalQty(qs) !== want)
                       .map(([qs, want]) => `${qs.join('+')} => ${totalQty(qs)}, want ${want}`);
check('quantities add up, packs do not', qtyBad.length === 0, qtyBad.join('; '));

/* Calories are the number this app exists for, so a portion drawn from a batch has
   to match the density of the batch it came from. A stew is meat AND sauce: 150g of
   curry base is not 150g of chicken, and pricing it as if it were is how a day quietly
   runs 300 kcal short of what it claims. per100 on the prep item is derived from that
   item's own recipe; the portions have to agree with it. */
const density = [];
Object.values(PREP).filter(p => p.portion && p.per100).forEach(pr => {
  MEALS.forEach(m => m.portions.forEach(x => {
    if (!x.n.startsWith(pr.portion)) return;
    const g = /^(\d+(?:\.\d+)?)\s*g$/.exec(x.a);
    if (!g) return;
    const want = +g[1] * pr.per100.c / 100;
    if (Math.abs(x.c - want) / want > 0.1)
      density.push(`${m.id} ${x.n} ${x.a}=${x.c} kcal, recipe says ${Math.round(want)}`);
  }));
});
check('batch portions match the density of their batch', density.length === 0, density.join('; '));

/* The one milk is full cream, because that is what the daily coffee needs. */
const wrongMilk = MEALS.filter(m => m.portions.some(x => /skim|low.fat|light milk/i.test(x.n))).map(m => m.id);
check('no meal asks for a milk other than full cream', wrongMilk.length === 0, wrongMilk.join(', '));

const budgetSum = SLOT_KEYS.reduce((s, k) => s + TARGETS[k], 0);
check(`slot budgets sum to ${DAILY.cal}`, budgetSum === DAILY.cal, `got ${budgetSum}`);

/* Staples are exempt: rice backs half the dinners and does not cluster the week. */
const thinBases = Object.keys(PREP).filter(b => {
  if (PREP[b].staple) return false;
  const n = pool('dinner').filter(d => declared(d).includes(b)).length;
  return n === 1;
});
check('each prep base backs 0 or 2+ dinners', thinBases.length === 0,
      `only one dinner for: ${thinBases.join(', ')} (inflates prep time)`);

/* --- generated weeks --- */
console.log('\ngenerated weeks');
let slotMismatch = 0, oatsAdjacent = 0, oatsWeekend = 0, breakfastRunOf3 = 0,
    lunchRepeat = 0, shelfViolations = 0, emptySlots = 0, uncoveredLunch = 0,
    proteinlessLunch = 0, freezerMidweek = 0, doubleCounted = 0, sameDayMarinade = 0,
    meatOverload = 0;
const seenMeal = new Set();
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
      seenMeal.add(m.id);
      c += cal(m); p += pro(m);
    });
    dayCal.push(c); dayPro.push(p);
  });

  /* Beef-heavy and chicken-heavy weeks were the complaint. Three nights of one
     protein out of seven is variety; four is a rut. */
  const meats = {};
  days.forEach(d => { const k = app.meatOf(byId(d.dinner)); meats[k] = (meats[k] || 0) + 1; });
  if (Object.entries(meats).some(([k, n]) => k !== 'other' && n > 3)) meatOverload++;

  const b = days.map(d => d.breakfast);
  for (let j = 1; j < 7; j++) if (b[j] === 'b-oats' && b[j - 1] === 'b-oats') oatsAdjacent++;
  for (let j = 2; j < 7; j++) if (b[j] === b[j - 1] && b[j - 1] === b[j - 2]) breakfastRunOf3++;
  if (b[5] === 'b-oats' || b[6] === 'b-oats') oatsWeekend++;

  const l = days.map(d => d.lunch);
  for (let j = 1; j < 7; j++) if (l[j] === l[j - 1] && l[j] !== 'l-reheat') lunchRepeat++;

  /* A lunch may only lean on a batch that some other meal is already cooking in the
     same session, otherwise it forces a second cook of the same thing. And the three
     "any cooked protein" lunches need an actual protein batch in the fridge that day. */
  const cover = {};
  days.forEach((d, j) => SLOT_KEYS.filter(k => k !== 'lunch').forEach(k => {
    mainBases(byId(d[k])).forEach(b => (cover[b] = cover[b] || new Set()).add(sessionOf(b, j)));
  }));
  days.forEach((d, j) => {
    const m = byId(d.lunch);
    mainBases(m).forEach(b => { if (!cover[b] || !cover[b].has(sessionOf(b, j))) uncoveredLunch++; });
    if (m.leftoverProtein) {
      const ready = Object.keys(cover).some(b => PREP[b].protein && cover[b].has(sessionOf(b, j)));
      if (!ready) proteinlessLunch++;
    }
  });

  const plan = prepPlan();
  sunMins.push(plan.sundayMins); midMins.push(plan.midweekMins);

  plan.sunday.forEach(x => x.days.forEach(d => { if (d > x.keeps) shelfViolations++; }));
  plan.midweek.forEach(x => (x.days || []).forEach(d => {
    if (d - 3 > x.keeps && !(x.late || []).includes(d)) shelfViolations++;
  }));

  /* A buy line is a week's worth of that meal, so a meal landing on two days must
     still only put its ingredients on the list once. */
  const sources = {};
  [...MEALS.map(m => [m.id, m.buy]), ...Object.entries(PREP).map(([k, p]) => [k, p.buy])]
    .forEach(([, buy]) => (buy || []).forEach(b => { sources[b.n.toLowerCase()] = (sources[b.n.toLowerCase()] || 0) + 1; }));
  STAPLES.forEach(b => { sources[b.n.toLowerCase()] = (sources[b.n.toLowerCase()] || 0) + 1; });
  shoppingList(live.current).forEach((row, k) => { if (row.qs.length > sources[k]) doubleCounted++; });

  /* Freezer items keep for weeks, so they should never need a Wednesday session. */
  plan.midweek.forEach(x => { if (PREP[x.id].storage === 'freezer') freezerMidweek++; });

  /* A marinade mixed on the afternoon it is eaten has not marinated. The joojeh
     recipe says 24 hours beats 2, so it has to be prepped at a session that is
     strictly before the first day it is needed. */
  if (plan.midweek.some(x => PREP[x.id].restsOvernight && x.days[0] <= 3)) sameDayMarinade++;
  if (plan.sunday.some(x => PREP[x.id].restsOvernight && x.days[0] <= 0)) sameDayMarinade++;

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
check('no lunch forces its own extra cook', uncoveredLunch === 0, `${uncoveredLunch} uncovered`);
check('leftover-protein lunches always have a protein batch that day',
      proteinlessLunch === 0, `${proteinlessLunch} occurrences`);
check('nothing frozen lands in the Wednesday top-up', freezerMidweek === 0, `${freezerMidweek} occurrences`);
check('a repeated meal is only shopped for once', doubleCounted === 0, `${doubleCounted} double-counted lines`);
check('a marinade is never made the day it is eaten', sameDayMarinade === 0, `${sameDayMarinade} occurrences`);

/* Only assembly items, the 2-day marinade and rice may appear in both sessions.
   Rice is the one real cook that repeats: it keeps four days, so a week needs two
   batches no matter how the meals fall. */
const ALLOWED_DUPES = ['oats', 'crunch-box', 'joojeh', 'rice'];
const badDupes = Object.keys(dupeCooks).filter(k => !ALLOWED_DUPES.includes(k));
check('no week has four dinners of the same protein', meatOverload === 0, `${meatOverload} weeks`);

/* A balancer that is too eager stops picking things at all: minimising the protein
   count instead of capping it silently dropped the creamy pasta from every week. */
const neverPicked = MEALS.filter(m => !seenMeal.has(m.id)).map(m => m.id);
check('every meal in the library still gets used', neverPicked.length === 0, neverPicked.join(', '));

check('no batch protein cooked twice in a week', badDupes.length === 0,
      badDupes.map(k => `${k} \u00d7${dupeCooks[k]}`).join(', '));

/* --- state: the paths nobody looks at until they break --- */
console.log('\nstate');

const sample = {
  current: { days: buildWeek(), kindy: [3, 4], locked: true },
  next:    { days: buildWeek(), kindy: [0, 6], locked: false },
  view: 'current'
};
app.setState(JSON.parse(JSON.stringify(sample)));

/* A share link is the whole plan in the URL. The slot order it encodes is frozen
   in WIRE_SLOTS precisely so that reordering the board cannot scramble old links. */
const link = app.encodeState();
const back = app.decodeState(link);
/* Compare slot by slot: buildWeek fills the keys in generation order and decode
   fills them in WIRE_SLOTS order, so stringifying the objects compares key order
   rather than the plan. */
const same = ['current', 'next'].every(k =>
  back[k].days.every((d, i) => SLOT_KEYS.every(s => d[s] === sample[k].days[i][s])) &&
  JSON.stringify(back[k].kindy) === JSON.stringify(sample[k].kindy) &&
  back[k].locked === sample[k].locked);
check('a share link round-trips both weeks exactly', same);
check('share link keeps its base64 padding', link.length % 4 === 0, `length ${link.length}`);
check('WIRE_SLOTS still covers every slot', app.WIRE_SLOTS.length === SLOT_KEYS.length
      && SLOT_KEYS.every(k => app.WIRE_SLOTS.includes(k)), app.WIRE_SLOTS.join(','));

/* A plan saved before any of this session's fields existed must still open. */
const legacy = JSON.stringify({
  current: { days: buildWeek(), kindy: [3, 4], locked: true },
  next:    { days: buildWeek(), kindy: [], locked: false },
  view: 'next'
});
let legacyOk = true, legacyErr = '';
try {
  app.setState(JSON.parse(legacy));
  prepPlan(); shoppingList(JSON.parse(legacy).current);
} catch (e) { legacyOk = false; legacyErr = e.message; }
check('a plan saved by the old build still loads', legacyOk, legacyErr);

/* Locked means locked, in the code and not just in the UI. */
const locked = { current: { days: buildWeek(), kindy: [], locked: true },
                 next: { days: buildWeek(), kindy: [], locked: false }, view: 'current' };
app.setState(locked);
const before = JSON.stringify(locked.current.days);
app.generate();
app.openSwap(0, 'dinner');
check('a locked week refuses to regenerate', JSON.stringify(locked.current.days) === before);

/* Rollover: next week becomes this week, locked, and a fresh next is drawn. */
const roll = { current: { days: buildWeek(), kindy: [1], locked: true },
               next: { days: buildWeek(), kindy: [3, 4], locked: false }, view: 'next' };
const wasNext = JSON.stringify(roll.next.days);
app.setState(roll);
app.rollover();
check('rollover promotes next week and locks it',
      JSON.stringify(roll.current.days) === wasNext && roll.current.locked === true
      && roll.next.locked === false && JSON.stringify(roll.next.days) !== wasNext
      && roll.view === 'current');

app.setState(live);

/* --- every drawer, on real weeks ---
   The generator tests never touch the rendering, so a renamed field or a template
   referring to something that no longer exists sails straight past them. This opens
   every drawer for every meal on every day of a lot of weeks. It asserts nothing
   about how they look — only that none of them throws. That is a low bar, and it is
   the bar that catches the mistake that actually gets made. */
console.log('\ndrawers');
let renders = 0, drawerErr = '';
try {
  for (let i = 0; i < 100; i++) {
    const w = { current: { days: buildWeek(), kindy: [3, 4], locked: false },
                next:    { days: buildWeek(), kindy: [], locked: false }, view: 'current' };
    app.setState(w);
    app.render();
    app.openPrep('sunday'); app.openPrep('midweek'); app.openShop(); app.openKindy();
    for (let d = 0; d < 7; d++) for (const s of SLOT_KEYS) {
      app.openMeal(d, s); app.openSwap(d, s); renders += 2;
    }
  }
} catch (e) { drawerErr = e.message; }
check(`every drawer renders (${renders} opened)`, drawerErr === '', drawerErr);
app.setState(live);

/* --- budgets --- */
console.log('\nbudgets (informational, not pass/fail)');
console.log(`  daily calories  avg ${avg(dayCal)}  (target ${DAILY.cal}, range ${min(dayCal)}\u2013${max(dayCal)})`);
console.log(`  daily protein   avg ${avg(dayPro)}g (target ${DAILY.protein}g, min ${min(dayPro)}g)`);
console.log(`  Sunday prep     avg ${avg(sunMins)} min`);
console.log(`  Wednesday prep  avg ${avg(midMins)} min`);
console.log(`  total prep      avg ${avg(sunMins) + avg(midMins)} min`);

const drift = Math.abs(avg(dayCal) - DAILY.cal);
if (drift > 120) console.log(`\n  ! average day is ${drift} kcal off target \u2014 consider rebalancing TARGETS or portion sizes`);

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
