# Meal planner — repo context

Single-file weekly meal planner. `index.html` is the whole app: no build step, no
framework, no dependencies, no package.json. Hosted on GitHub Pages. Open the file in
a browser and it works.

## Who it's for

One household, three people. Poya weighs his own portions to hold a deficit; his wife
and their four-year-old eat the same meals unmeasured. Everything in the app serves
that asymmetry — meals are built from separable components (protein / carb / veg /
sauce) so one plate can be weighed while the others are served freely.

## Fixed parameters

Don't change these unless asked directly.

| | |
|---|---|
| Daily target | 1650 kcal, 140g protein |
| Slot budgets | must sum to `DAILY.cal` **exactly** |
| Kindy box days | Thursday and Friday (2 supplied days) |
| Weeknight cooking cap | 20–30 min, or he orders in instead |
| Prep sessions | Sunday before the week (~45 min) + Wednesday top-up (~30 min) |
| Daily coffee | one full-cream flat white, 120 kcal, counted in every breakfast |
| Groceries | one type of each staple — one milk, one rice, one bag of berries |

## File layout

Everything is in `index.html`, in this order:

1. `<style>` — CSS, design tokens at the top as CSS custom properties
2. `<body>` — static markup skeleton (header, rail, board, drawer)
3. `<script>`:
   - `SYNC` — optional cloud sync config
   - `TARGETS` / `DAILY` — calorie budgets
   - `PREP` — batch prep items
   - `STAPLES` — bought every week regardless of the board (coffee, milk)
   - `MEALS` — the meal library
   - `KINDY` — kindy box components
   - `/* ===== APP ===== */` banner, then all logic

**Everything above the APP banner is data and is meant to be edited. Below it is logic.**
Adding meals should never require touching anything below that line.

## Data model

```js
// A meal
{ id, slot, name, mins, base, blurb, portions:[], steps:[], buy:[], weekend?, leftoverProtein? }
```

- `slot` is one of `breakfast | snack1 | lunch | dinner | snack2`. `snack1` is the
  **afternoon** snack — it sits between lunch and dinner on the board. The keys keep
  their old names because share links encode slots positionally; `WIRE_SLOTS` holds
  that frozen order and must not be reordered to match `SLOTS`.
- **Calories and protein are derived from `portions`, never stored.** `cal(m)` and
  `pro(m)` sum the portion array. Never hardcode a total — the board and the docket
  read from the same source so they can't disagree.
- `portions[]` is `{n: name, a: amount, c: calories, p: protein}`. Amounts are
  strings ("150g", "2 slices") because some are countable.
- `base` names a `PREP` entry this meal depends on, or a **list** of them, or
  `null`. Every id must exist in `PREP`. Use `basesOf(m)` to read it — never
  `m.base` directly, it may be a string or an array. `mainBases(m)` drops staples.
- `leftoverProtein: true` marks a meal whose portions say "any cooked protein" —
  it only lands on a day when a batch protein is actually in the fridge.
- `buy[]` is `{n, q, c}` — category `c` must be one of: `Meat & fish`, `Fruit & veg`,
  `Dairy & eggs`, `Bakery`, `Frozen`, `Pantry`. Anything else silently vanishes from
  the shopping list.
- **`q` is a week's worth of that ingredient for this meal**, not a per-serve amount
  and not a per-day amount. A meal landing on three days is still shopped for once.
  See **Shopping quantities**.
- `steps[]` optional. Omit for assembly-only meals; the docket says so itself.

```js
// A prep item
{ name, mins, feeds, keeps, storage, portion?, per100?, topUpMins?, staple?,
  protein?, freezes?, steps:[], buy:[] }
```

- `keeps` is shelf life in days. **Required.** It drives the whole prep schedule.
- `storage` is `'fridge'` or `'freezer'`. **Required.** Everything is fridge except
  frozen grapes. `keeps` is a *fridge* shelf life unless storage says otherwise.
- `freezes: true` is display only — it tells you a batch can be doubled and half put
  away, nothing in the scheduler reads it.
- `staple: true` means the item is prepped and scheduled like anything else but does
  not cluster the week. Rice is the only one. See the generation rules.
- `protein: true` marks the five batch proteins. Only these satisfy a
  `leftoverProtein` meal.
- `portion` is the portion name meals use for this batch, and `per100` is `{c, p}`
  for 100g of the **finished** batch, derived from that item's own recipe. Together
  they let a test hold every portion to the density of the thing it came from. See
  **Calories**.
- `topUpMins` is the cheaper cost when the item is already made in the earlier
  session and only needs a small second batch. Only for assembly items (oats,
  cut veg), never for anything that involves actual cooking.

## Prep scheduling model

Days are numbered from the Sunday session: Sunday prep is **day 0**, Mon = 1, …
Sun = 7. The Wednesday top-up is **day 3**.

An item is prepped at the latest session that still lands inside its shelf life for
the day it's needed. So a 3-day item needed Thursday (day 4) can't come from Sunday
and moves to Wednesday. An item needed on days either side of its keep window
appears in **both** sessions — that's correct, not a bug.

The two prep cards sit in a rail **above** the calendar, deliberately outside the
seven days, because neither session happens on a day shown in the week.

Rice is the exception that proves the model: it keeps 4 days, so a full week always
needs two batches. That is a genuine second cook, not a top-up, and it is why rice
has no `topUpMins`.

## Invariants

These were all found by testing and regressions are easy. Keep them true.

1. Slot budgets in `TARGETS` sum to `DAILY.cal` exactly.
2. Every meal lands in a slot matching its own `slot` field.
3. No meal is ever prepped beyond its `keeps` window.
4. Oats never appear on consecutive mornings, and only Mon–Fri.
5. No breakfast appears three days running.
6. No lunch repeats back to back (leftovers excepted).
7. No batch protein is cooked twice in one week. Only assembly items
   (oats, crunch box), the 2-day joojeh marinade and rice may appear in both
   sessions.
8. Every day has all five slots filled.
9. Every meal whose portions include cooked rice declares the `rice` base. This is
   the bug class that started all of this — a meal quietly assuming leftovers the
   plan never created.
10. A lunch never forces its own extra cook: every main base a lunch leans on is
    already being cooked that session for some other meal.
11. A `leftoverProtein` meal only lands on a day with a covered `protein` batch.
12. Nothing stored in the freezer appears in the Wednesday top-up.
13. The shopping list names one milk, one rice and one type of berry. See
    **One of each thing**.
14. Every portion drawn from a batch matches that batch's `per100` within 10%.

## Generation rules

- **Dinners** are clustered by prep base: one base feeds the early week off the
  Sunday session, another feeds the late week off Wednesday. Three remaining nights
  are cook-fresh or bought. This is what keeps prep at ~70 min total instead of ~145.
- **Give every new prep base two dinners.** A base with one dinner forces the
  generator to spread prep across more bases and inflates both sessions.
- **Staples don't cluster.** Rice backs half the dinners, so clustering on it would
  put two rice dinners together and defeat the protein clustering entirely. Dinner
  placement, the filler pool and the batch/plain lunch split all read `mainBases()`,
  which drops staples. Staples need no coverage check — the prep scheduler cooks
  them for whatever day asks.
- **Base-dependent lunches** may only land on days already covered by that base's
  session, or they force a second cook.
- **Oats** pick 2–3 non-adjacent days from Mon–Fri, retrying up to 8 times.
- Pancakes are pinned to one weekend day and are the one deliberate calorie overshoot.

## Calories

Calories are the number this app exists for, so the portion table has to be right
about what a weighed amount actually is.

A batch is not the meat that went into it. 1.2kg of raw thigh, a tin of tomato, two
onions and a spoon of oil make **1975g** of curry base carrying 1900 kcal — that is
96 kcal per 100g, and the chicken is a bit over half of it by weight. So a 265 kcal
serve of curry is **276g on the scale**, not 150g. Pricing 150g of a stew as if it
were 150g of chicken is how a day quietly runs 300 kcal short of what it claims.

Every batch declares `per100` derived from its own recipe, and a test fails if any
portion drawn from it is more than 10% off. When you change a batch recipe, redo
`per100` and re-weigh the portions that use it.

Portion **calories** are the fixed point: they were tuned against the slot budgets,
so when a density is corrected the grams move and the calories stay. The gram amounts
then set the batch sizes, which is why `buy` quantities and the numbers in `steps`
have to be revisited at the same time.

Densities that check out against reference values and should be left alone: poached
breast at 165/100g, rice at 130, pasta at 350 dry, oats at 375, the dairy, the oils.

## Shopping quantities

The list merges lines by ingredient name and then has to decide what the merged
quantity is. Two meals wanting the same thing is not the same as needing twice as
much, so `totalQty()` splits on the unit:

- **Pack words** — jar, bottle, pkt, bag, tub, loaf, box, bunch, head, knob, bulb,
  punnet, carton, block, tin, can, dozen — are containers. Three meals wanting soy
  sauce is **one bottle**, so packs take the max. A unit that merely *mentions* a
  pack counts as one, so `500g tub` is a tub, not 500 grams.
- **Everything else** is an amount and amounts **add up**: 600g of thigh for the
  joojeh plus 800g for the air fryer is 1.4kg of thigh. `kg`/`L` normalise to `g`/`ml`
  and come back out as kg or L over 1000.

Two consequences for the data. Sources of the same ingredient must **agree on the
unit** — `1 bag` and `4` cannot be added, and there's a test that fails if any two
sources disagree. And anything that should accumulate must be written as a weight or
a bare count, never as a pack: eggs are `10`, `8`, `4` rather than `1 dozen` three
times, tuna is `2` rather than `4 tins`.

Batch sizes assume the household eats it: a dinner is Poya's portion **×2.5** (two
adults and the four-year-old), a lunch is **×2**, breakfasts and snacks are his
alone. A base used in a week gets eaten to the tune of roughly a kilo of finished
food, which is what the buy quantities are sized against.

## State and storage

```js
state = { current: WEEK, next: WEEK, view: 'current'|'next' }
WEEK  = { days: [{slot: mealId} × 7], kindy: [dayIdx], locked: bool }
```

- Two weeks. `current` is locked by default; `next` is editable.
- Locked means no generate, no swap, no kindy toggle. Enforced in `generate()`,
  `openSwap()` and the kindy handler, not just hidden in the UI.
- Rollover is manual (`Start new week`). There is deliberately **no date awareness** —
  this was considered and rejected.
- `localStorage` under `weekservice:v2`, always written first so the app survives
  offline.
- Share links encode both weeks into the URL hash as base64. Keep the padding —
  some browsers' `atob` throws without it.

## Cloud sync

`SYNC.url` + `SYNC.path` at the top of the script. Firebase Realtime Database over
plain `fetch`, no SDK. Blank `url` means local-only and zero network calls.

`SYNC.path` is effectively a shared password sitting in a public repo. That's an
accepted trade for meal data. **Never put anything sensitive behind it**, and if the
security model needs to be real, the next step is Firebase Anonymous Auth with rules
scoped to two known UIDs.

Last write wins. No conflict resolution.

## Design language

The visual metaphor is a **kitchen service docket** — stainless bench, paper cards,
weights that read like a scale display.

- Colours are CSS custom properties on `:root`. Use them; don't introduce new hex
  values inline.
- `--tile` (teal) is structure and actions. `--saffron` is the signal colour for
  prep and calorie data. `--warn` (rust) means over budget or a destructive confirm.
- Type: Archivo Narrow for headings and labels, Archivo for body, **IBM Plex Mono for
  every number** — weights, calories, minutes. Numbers are always tabular and
  right-aligned in the portion table.
- Destructive actions use tap-again-to-confirm, never `window.confirm()` — the app is
  used on a phone.
- Below 640px the board becomes one day per row with 48px touch targets.

## One of each thing

Two kinds of the same grocery means one of them goes off in the fridge door, so the
library buys **one** of each staple and every meal bends to it:

- **Milk is full cream**, because the daily coffee needs it. Nothing asks for skim.
- **Rice is basmati**, for the poke bowl as much as the curry. No sushi rice.
- **Berries are one bag of frozen mixed**, in the oats, on the pancakes, in the late
  snack. No separate punnet of blueberries or bag of raspberries.
- Heat comes from the **sambal** jar, not a second bottle of sriracha.

`STAPLES` covers the things bought every week whatever the board says. It exists
because the coffee is in all seven breakfasts and its milk was on no shopping list
at all. Two tests guard this: one fails if the shopping list ever names two milks,
two rices or two berries, and one fails if a portion asks for a milk that isn't full
cream. If you add a meal, use the ingredient that's already there.

Still deliberately two of a kind, because they are genuinely different foods:
Greek yoghurt (sauces, marinade) vs protein yoghurt (single-serve, 20g protein);
brown onion (cooking) vs red (raw); chicken stock vs beef stock.

## Writing style for meal content

Blurbs are one or two sentences, plain and practical, second person. They say why a
meal earns its place or what the trade-off is — not how delicious it is. Be honest
about weaknesses: the dhal blurb states its protein is low, the pancakes blurb states
it's the biggest breakfast. Steps are imperative and assume competence. No exclamation
marks, no food-writing adjectives.

## Testing

There's no test runner. The pattern that caught every bug in this app's history is a
headless harness: extract the `<script>` contents, stub the DOM, and call
`buildWeek()` / `prepPlan()` a few thousand times checking the invariants above.
`test/planner.test.js` does this. Run it from the repo root with
`node test/planner.test.js`. It finds `index.html` or `meal-planner.html`
automatically, or takes a path as its first argument. `WEEKS=20000` for a longer run.

The static-data checks are the cheap ones and they catch the expensive mistakes:
a meal eating rice without declaring the base, a prep item with no `storage`, a
base with exactly one dinner.

Run it after any change to generation or prep scheduling. Averages over 1000+ weeks
catch things that eyeballing one generated week never will — the oats bug, the
duplicate-cook bug and the shelf-life bug were all invisible in a single sample.
