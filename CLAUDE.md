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

## File layout

Everything is in `index.html`, in this order:

1. `<style>` — CSS, design tokens at the top as CSS custom properties
2. `<body>` — static markup skeleton (header, rail, board, drawer)
3. `<script>`:
   - `SYNC` — optional cloud sync config
   - `TARGETS` / `DAILY` — calorie budgets
   - `PREP` — batch prep items
   - `MEALS` — the meal library
   - `KINDY` — kindy box components
   - `/* ===== APP ===== */` banner, then all logic

**Everything above the APP banner is data and is meant to be edited. Below it is logic.**
Adding meals should never require touching anything below that line.

## Data model

```js
// A meal
{ id, slot, name, mins, base, blurb, portions:[], steps:[], buy:[], weekend? }
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
- `base` names a `PREP` entry this meal depends on, or `null`. Must exist in `PREP`.
- `buy[]` is `{n, q, c}` — category `c` must be one of: `Meat & fish`, `Fruit & veg`,
  `Dairy & eggs`, `Bakery`, `Frozen`, `Pantry`. Anything else silently vanishes from
  the shopping list.
- `steps[]` optional. Omit for assembly-only meals; the docket says so itself.

```js
// A prep item
{ name, mins, feeds, keeps, topUpMins?, steps:[], buy:[] }
```

- `keeps` is shelf life in days. **Required.** It drives the whole prep schedule.
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

## Invariants

These were all found by testing and regressions are easy. Keep them true.

1. Slot budgets in `TARGETS` sum to `DAILY.cal` exactly.
2. Every meal lands in a slot matching its own `slot` field.
3. No meal is ever prepped beyond its `keeps` window.
4. Oats never appear on consecutive mornings, and only Mon–Fri.
5. No breakfast appears three days running.
6. No lunch repeats back to back (leftovers excepted).
7. No batch protein is cooked twice in one week. Only assembly items
   (oats, crunch box) and the 2-day joojeh marinade may appear in both sessions.
8. Every day has all five slots filled.

## Generation rules

- **Dinners** are clustered by prep base: one base feeds the early week off the
  Sunday session, another feeds the late week off Wednesday. Three remaining nights
  are cook-fresh or bought. This is what keeps prep at ~70 min total instead of ~145.
- **Give every new prep base two dinners.** A base with one dinner forces the
  generator to spread prep across more bases and inflates both sessions.
- **Base-dependent lunches** may only land on days already covered by that base's
  session, or they force a second cook.
- **Oats** pick 2–3 non-adjacent days from Mon–Fri, retrying up to 8 times.
- Pancakes are pinned to one weekend day and are the one deliberate calorie overshoot.

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

Run it after any change to generation or prep scheduling. Averages over 1000+ weeks
catch things that eyeballing one generated week never will — the oats bug, the
duplicate-cook bug and the shelf-life bug were all invisible in a single sample.
