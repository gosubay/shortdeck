# Short Deck HU Trainer — Specification

Live site: https://gosubay.github.io/shortdeck
Repo: gosubay/shortdeck (branch: main)

This file is the source of truth. If chat and this file disagree, this file wins
until Galvin says otherwise. Every rule/constant/decision goes here.

---

## 1. Product

Four tabs in `index.html`:

1. **Play** — play heads-up vs the solver bot. Top-right HUD: net profit (in antes),
   hand count, winrate per 100 hands. Persists in browser localStorage. Reset button.
2. **GTO Solver** — view/browse the solved strategy (ranges, frequencies, by street/node).
3. **Strategy** — plain-English explanation of the solved strategy + short deck equity
   education (rule of 3/6, hand-vs-hand matchups, preflop equities).
4. **Rules** — short deck rules and hand rankings.

Must work on mobile (phone) as well as desktop.

## 2. Game rules (CONFIRMED)

- 36-card deck: ranks 6,7,8,9,T,J,Q,K,A in 4 suits. 2/3/4/5 removed.
- Heads-up only (2 players).
- Ace plays low for straights: **A-6-7-8-9 is a straight**.
- Flush beats full house.
- Hand ranking order (CONFIRMED, Triton standard):
  **Straight Flush > Quads > Flush > Full House > Straight > Trips > Two Pair > One Pair > High Card**
  Only ONE thing changes vs holdem: flush beats full house. Straight still beats trips.
  Verified by enumeration (`tools/shortdeck_math.py`), 5-card hands from 36 cards:
  flush 480, full house 1,728 (flush is 3.6x rarer -> flush wins);
  straight 6,120, trips 16,128 (trips still 2.6x more common -> straight wins).
  Quirk worth teaching: high card (122,400) is RARER than one pair (193,536).
- Betting: no-limit. Currency = antes (A).

### Stack rules (CONFIRMED)
- Starting stack: **50A**.
- Any player below **10A** is force-topped-up to **50A**.
- Any player above **100A** is force-ratholed down to **100A** (excess banked as profit).
- Therefore all live stacks sit in **[10A, 100A]**.
- **Effective stack** = min(stack1, stack2). All strategy is indexed by effective stack.

### Ante / button structure (CONFIRMED)
- Both players ante **1A**. The button posts an **extra 1A button ante** -> button in
  for 2A, opponent in for 1A, **preflop pot = 3A**.
- Because the button has the largest forced bet, the **button acts LAST preflop and
  LAST postflop** — position on every street. (Opposite of heads-up holdem.)
- Button alternates every hand.

## 3. Bet size abstraction (CONFIRMED)

### Preflop
| Action | Definition |
|---|---|
| Limp | call to 1A (match the ante/blind) |
| Min-raise | raise to 2A |
| 50% pot raise | raise-to = call_amount + 0.50 × (pot after the call) |
| 100% pot raise | raise-to = call_amount + 1.00 × (pot after the call) |
| Jam | all-in for effective stack |

### Postflop
25% pot, 50% pot, 100% pot, 150% pot, Jam.
(For raises: raise-to = call_amount + fraction × (pot after the call).)

### Snapping the human's bet to the abstraction
A human may type any legal bet. It is snapped to the nearest abstract size for the
purpose of looking up the bot's strategy, using **geometric midpoints** (sizes are
multiplicative, so 30% is closer in character to 25% than 45% is to 50%):

| Player's bet as % of pot | Snapped to |
|---|---|
| under 35.4% | 25% |
| 35.4% – 70.7% | 50% |
| 70.7% – 122.5% | 100% |
| 122.5% – midpoint(150%, jam) | 150% |
| above that | Jam |

The player's ACTUAL bet size is what goes in the pot — snapping only affects which
strategy row the bot looks up.

### Raise cap
Max 4 bets per street (bet, raise, re-raise, re-re-raise), after which the only
raise option is Jam. Prevents tree explosion.

## 4. Solver design (CONFIRMED so far)

### Preflop card abstraction: LOSSLESS
- 630 combos = C(36,2). 54 pairs + 144 suited + 432 offsuit.
- Before a board exists, suits are fully interchangeable, so those 630 combos collapse
  to **81 strategically identical classes** (9 pairs + 36 suited + 36 offsuit).
  AdAc plays identically to AcAh; AsKs plays identically to AhKh. This is exact,
  not an approximation.
- Preflop is therefore solved with **no card abstraction at all**.

### Postflop card abstraction (CONFIRMED)
Bucketing is mandatory, not a shortcut: a card-perfect postflop strategy for one stack
depth is ~140 GB (573 flop classes x ~100k decision points x 630 combos). It cannot be
downloaded by a browser. Bucketing gets it to tens of MB.

- **Potential-aware buckets**: two hands share a bucket only if they have a similar
  *distribution* of equity across future runouts, not merely the same current equity.
  (Stops a bare flush draw being lumped with middle pair.)
- Target: **~60 board texture classes, ~128 buckets per street**, all 9 stack depths.
- Fidelity tier chosen: **High + teaching solves (~72h budget)**.
  Plus card-perfect (no card abstraction) solves on ~40 benchmark flops, used to
  generate accurate Strategy-tab content and to validate the bucketed bot.

### Implementation (CONFIRMED)
- Solver core in **Rust** (install once: `winget install Rustlang.Rustup`), run with
  `cargo run --release`. ~10-30x faster than Python, which buys bucket count.
- Python (`tools/`) for enumeration, equity tables and content generation.

### Stack depth grid (CONFIRMED)
Solve separately at effective stacks of **10, 15, 20, 30, 40, 50, 65, 80, 100 antes**.
At the table, snap to the nearest grid point.

### Useful short deck counts (computed)
- Total flops: C(36,3) = 7,140. Suit-isomorphic flop classes: **573**.
- Turn cards unseen (from one player's view): 31. River: 30.

## 5. Deployment (CONFIRMED)

- `index.html` at repo root = the whole app UI + game engine. User only needs
  https://gosubay.github.io/shortdeck
- Strategy data ships as separate file(s) fetched by index.html (kept off the HTML so
  the page loads fast and the bot can be updated independently).
- If the strategy blob outgrows what is sane for GitHub Pages, it moves to external
  hosting and index.html links to it.
- `solver/` folder holds the offline solver source (not needed by visitors).

## 6. Honesty rule

The bot is an **abstracted** equilibrium approximation, not true GTO. The app must say
so plainly rather than claiming perfect play.

---

## Open questions

None blocking. All parameters locked 2026-09-08.
