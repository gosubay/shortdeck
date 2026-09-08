# HANDOFF — Short Deck HU Trainer

**Last updated:** 2026-09-08
**Live site:** https://gosubay.github.io/shortdeck
**Repo:** gosubay/shortdeck (branch `main`)

---

## What this project is

A four-tab web app for heads-up Short Deck (6+) hold'em:

1. **Play** — play against the solver bot, with profit / hand count / winrate-per-100.
2. **GTO Solver** — walk the solved game tree and read the real action frequencies.
3. **Strategy** — plain-English teaching, every number computed rather than guessed.
4. **Rules** — short deck rules and why two hand rankings change.

**All parameters are locked in [SPEC.md](SPEC.md). Read it before changing anything.**

---

## Current state — everything works end to end

| Piece | Status |
|---|---|
| `index.html`, all 4 tabs | **Done, verified in-browser** |
| Hand evaluator (Python / JS / Rust — three ports) | **Done, all three exhaustively tested** |
| Teaching content (equities, outs, 81-hand ranking) | **Done, computed** |
| Rust CFR solver | **Done, runs, exports** |
| Browser plays the solved strategy | **Done — 99.4% of bot decisions** |
| 50M-iteration solve, shipped and live | **Done** |
| Long (3 billion) solve | **Not yet run** — see "The one thing left" |

---

## The one thing left

The shipped `data/strategy.bin` is a **50 million iteration** run (66 minutes, measured).
Preflop is genuinely converged at that count (~17,000 visits per situation). Postflop is
not, and the app says so rather than pretending otherwise.

Galvin agreed a **~72 hour** budget. To use it, he double-clicks:

    solver\RUN-LONG-SOLVE.bat

which runs 3 billion hands per depth — **about two days** on this machine. Then commit
`data/strategy.json` and `data/strategy.bin`; nothing else changes, the site picks them up.

**Do not estimate solve time by scaling small runs linearly.** Nine threads on eight cores
contend for memory bandwidth. Measured at 50M: 10A = 286s, 20A = 827s, 100A = 3,939s.

### Measured bot strength (25,000 hands vs the heuristic, 27,000-hand control)

    solver vs heuristic   +30.46 A/100  (se 13.52)
    control               -8.24  A/100  (se 11.01)   <- should be ~0, and is
    difference            z = 2.2

Per-hand standard deviation is **21 antes**, so any win-rate claim needs a very large
sample. The direction is solid; treat the magnitude as approximate. The previous
undertrained export scored -75.45 A/100 on the same test.

Also still outstanding from the agreed scope: the **~40 card-perfect benchmark flop
solves** for the Strategy tab (the "High + teaching solves" tier). Not started.

Also still outstanding from the agreed scope: the **~40 card-perfect benchmark flop
solves** for the Strategy tab (the "High + teaching solves" tier). Not started.

---

## How to work on this

### Build the site
`index.html` is a **generated file**. Source lives in `src/`.

```bash
python build.py
```

Never hand-edit `index.html`. `build.py` sanity-checks the output.

### Preview locally
The page fetches JSON/binary, so `file://` will not work.

```bash
python -m http.server 8765
```

### Run the solver
```bash
cd solver
cargo run --release -- --iters 20000000
```
Needs only `winget install Rustlang.Rustup`. The GNU toolchain is pinned in
`solver/rust-toolchain.toml` precisely so that Visual Studio is NOT required.

### Regenerate the teaching numbers
```bash
cd tools
python test_evaluator.py     # must pass first
python generate_content.py   # ~3 min
python flop_spots.py         # re-verifies the 10 flop spots
```

---

## Verification you can re-run any time

Open the site, then in the browser console:

| Command | What it proves |
|---|---|
| `selfTest()` | JS evaluator matches an exhaustive 376,992-hand census |
| `await verifySolverAbstraction()` | JS hand-bucketing matches the Rust **exactly**, on 4,000 samples |
| `SOLVER.hits / SOLVER.misses` | how often the bot found its spot in the solved tree |

The solver binary re-runs the evaluator census at startup and refuses to solve if it fails.

**These are not decoration.** The abstraction check exists because if the JS and Rust
bucketings ever disagree, the bot reads the wrong row of the strategy table and plays
nonsense with no error message.

---

## Key facts established (do not re-derive)

- **630 preflop combos collapse to exactly 81 classes**, losslessly.
- **573 suit-isomorphic flop classes** (vs 1,755 in holdem).
- **Card-perfect postflop is ~140 GB per stack depth.** Bucketing is mandatory.
- Ranking: **flush beats full house, straight still beats trips** (Triton standard).
  Enumerated: flush 480 / boat 1,728; straight 6,120 / trips 16,128.
- **Flush draws have 5 outs, not 9.** Straight draws still have 8.
- Rule of **3 and 6**; the rule of 6 over-counts above ~6 outs.
- The **pair cliff**: AA-TT are ranks 1-5 of 81, then 99 is 20th, 88 is 42nd, 77 is 61st,
  66 is **78th**.
- On `9c8c6h` vs AA: gutshot 30.8%, flush draw 39.2%, straight draw **52.0%**,
  combo draw **65.8%**. One board, four draws — the whole thesis in one table.

---

## Gotchas that will bite you

- Seat 0 is the human and seat 1 the bot in the JS. In the **solver**, seat 0 is always
  the **button**. `solverSeat()` converts. Do not conflate them.
- The **button acts LAST preflop** here (it posts the extra ante). Opposite of heads-up
  holdem. It is correct — do not "fix" it.
- `src/11-game.js legalActions()` is a deliberate **mirror** of
  `solver/src/tree.rs build_node()` — same bet menu, same 0.5A rounding, same raise cap.
  Change one, change both, or the bot silently loses its strategy.
- Depth lookup uses `G.effStart` (effective stack when the hand STARTED), never `eff()`,
  which collapses to 0 the moment someone is all in.
- `profit()` counts chips in a live pot as not-yet-lost, so the HUD reads flat mid-hand.
- Stats persist in `localStorage` under `shortdeck.stats.v1`.
- The Bash tool on this machine mangles backslashes inside heredocs. Use the Edit/Write
  tools for anything containing them.
