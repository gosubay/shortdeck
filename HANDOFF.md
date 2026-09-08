# HANDOFF — Short Deck HU Trainer

**Last updated:** 2026-09-08
**Live site:** https://gosubay.github.io/shortdeck
**Repo:** gosubay/shortdeck (branch `main`)

---

## What this project is

A four-tab web app for heads-up Short Deck (6+) hold'em:

1. **Play** — play against a bot, with profit / hand count / winrate-per-100 in the corner.
2. **GTO Solver** — browse the solved strategy, and instructions to re-run the solve.
3. **Strategy** — plain-English teaching, all numbers computed not guessed.
4. **Rules** — short deck rules and why the rankings change.

**All parameters are locked in [SPEC.md](SPEC.md). Read it before changing anything.**

---

## Current state

| Piece | Status |
|---|---|
| `index.html` (all 4 tabs, game engine, UI) | **Done and verified** |
| Hand evaluator (Python + JS, identical) | **Done, exhaustively tested** |
| Teaching content (equities, outs, rankings) | **Done, computed** |
| Fallback bot (heuristic) | **Done** — real opponent, not the solver |
| Rust CFR solver | **NOT STARTED** — next task |
| `data/strategy.json` (solved output) | Does not exist yet |

The app is fully playable right now. The Play tab uses the **heuristic fallback bot** and
says so on screen. When `data/strategy.json` appears, the app switches to it automatically
and the GTO Solver tab fills in — no code change needed.

---

## How to work on this

### Build the site
Source lives in `src/` as separate pieces; `index.html` is a **generated file**.

```bash
python build.py
```

Never hand-edit `index.html` — edit `src/*` and rebuild. `build.py` sanity-checks the
output (one `<html>`, exactly 4 panels, balanced `<script>` tags).

### Preview locally
The page fetches JSON, so `file://` will not work. Serve it:

```bash
python -m http.server 8765
```
Then open http://localhost:8765

### Regenerate the teaching numbers
```bash
cd tools
python test_evaluator.py     # must pass before anything else
python generate_content.py   # ~3 min, writes data/strategy_content.json
python flop_spots.py         # re-verifies the 10 flop spots, patches the JSON
```
`flop_spots.py` **refuses to write** if a spot's label contradicts the maths (it counts
the real outs). That check already caught two mislabelled spots — keep it.

### Verify in-browser
Open the console and run `selfTest()`. It runs an exhaustive 376,992-hand census against
known-correct counts and must print PASSED.

---

## Key facts established (do not re-derive)

- **630 preflop combos collapse to exactly 81 classes**, losslessly. Preflop needs no
  card abstraction.
- **573 suit-isomorphic flop classes** exist (vs 1,755 in holdem).
- **Card-perfect postflop is ~140 GB per stack depth.** Bucketing is mandatory, not lazy.
- Hand ranking: **flush beats full house, straight still beats trips** (Triton standard).
  Verified by enumeration: flush 480 / boat 1,728; straight 6,120 / trips 16,128.
- **Flush draws have 5 outs, not 9.** Straight draws still have 8. This is the single
  biggest strategic difference from holdem.
- Rule of **3 and 6** (31 unseen cards after the flop), and the rule of 6 over-counts
  above ~6 outs.
- The **pair cliff**: AA-TT are ranks 1-5 of 81, then 99 is 20th, 88 is 42nd, 77 is 61st,
  66 is **78th**.

---

## Next task: the Rust CFR solver

Lives in `solver/` (not yet written). Design is fixed in SPEC.md section 4:

1. Enumerate the 573 isomorphic flop classes, cluster to ~60 board texture classes.
2. Potential-aware hand bucketing, ~128 buckets per street (cluster on the *distribution*
   of equity across runouts, not on current equity).
3. Bucket-to-bucket transition probabilities per street.
4. CFR+ / MCCFR over the abstracted tree, 9 stack depths, bet sizes per SPEC.
5. Export `data/strategy.json`, plus ~40 card-perfect benchmark flop solves for the
   Strategy tab.

Galvin still needs to install Rust once:
```
winget install Rustlang.Rustup
```

Compute budget agreed: **~72 hours** ("High + teaching solves" tier).

---

## Gotchas

- Seat 0 is the human, seat 1 is the bot, everywhere in the code.
- The **button acts LAST preflop** here (it posts the extra ante). This is the opposite
  of heads-up holdem and it is correct — do not "fix" it.
- `profit()` counts chips in a live pot as not-yet-lost, so the HUD reads flat mid-hand.
- Stats persist in `localStorage` under `shortdeck.stats.v1`.
