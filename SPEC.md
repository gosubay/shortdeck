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

### Raise cap and the re-raise menu — AS BUILT (differs from the original request)
**Galvin asked for all five postflop sizes at every decision. That is kept for the
OPENING bet on each street. It is NOT kept for re-raises.** As built:

| Situation | Sizes available |
|---|---|
| Opening bet, preflop | min-raise (4A), 50% pot, 100% pot, jam |
| Opening bet, postflop | 25%, 50%, 100%, 150% pot, jam |
| Any raise after that | 50% pot, 100% pot, jam |
| After 3 raises on a street | fold or call only |

**Why:** with the full menu at every raise depth the tree grows past what can be solved
or downloaded. Sizing knowledge that a player actually uses lives in the opening bet;
almost nobody is studying third-re-raise sizing. This is a single table at the top of
`solver/src/tree.rs` (`PF_OPEN`, `POST_OPEN`, `RERAISE`, `MAX_RAISES`) and the matching
constants in `src/11-game.js`, so it can be widened later in one place.

**The live game and the solver MUST agree on this menu exactly.** If they drift, the
player can reach betting states that do not exist in the solved tree and the bot silently
falls back to heuristics. `src/11-game.js legalActions()` is a deliberate mirror of
`solver/src/tree.rs build_node()`.

### All money sits on a 0.5A grid
Every bet target is rounded to the nearest 0.5 antes (`QUANT` in the solver, `quantRaise`
in the JS). Free-form human bets are rounded to 0.5A too. This keeps the live game's pot
and stack numbers identical to the solver's, which is what makes strategy lookup work.

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

**AS BUILT** (`solver/src/abstraction.rs`): buckets are **hand-crafted and
potential-aware**, not learned by k-means.

```
bucket  = category(9) x strength(4) x flush-draw(2) x straight-draw(3) = 216
texture = suit pattern(3) x paired(2)                                  = 6
card state = texture * 216 + bucket                                    = 1,296
```

- Draws are explicit features, so a flush draw and a middle pair with identical raw
  equity can never collapse together — which is the exact failure "potential-aware"
  exists to prevent.
- **Every bucket has a name** ("top pair + open-ender", "overpair + flush draw"). This
  is what makes the Strategy tab possible: the solver can explain itself in English
  instead of citing "cluster 47". This was the deciding argument over k-means.
- River has no draws, so fd/sd collapse to 0 there automatically.

### Betting-tree abstraction — THE KEY TRICK (as built)
Subtrees are memoised on the betting **state** (street, each player's committed chips,
whose turn, raises so far, who was last aggressive, who still owes an action, minimum
legal raise) rather than on the full action history. Two routes to the same pot and
stacks share one subtree.

Without this a four-street tree is exponential and unsolvable. With it:

| Depth | Nodes | Decision nodes |
|---|---|---|
| 10A | 596 | 244 |
| 50A | 3,212 | 1,256 |
| 100A | 4,915 | 1,916 |

**The cost:** the solver cannot tell "bet-bet-call" from "check-raise-call" when both
leave the same pot and stacks. The last aggressor IS kept, so most of the distinction
survives. This is a standard, disclosed abstraction.

### Implementation (AS BUILT)
- Solver core in **Rust**, external-sampling MCCFR with regret matching+.
- **Pinned to the GNU toolchain** (`solver/rust-toolchain.toml`). Rust's default Windows
  toolchain (msvc) needs the multi-gigabyte Visual Studio C++ build tools, which are NOT
  installed and were not part of what was agreed. The gnu toolchain links with bundled
  components, so `winget install Rustlang.Rustup` then `cargo run --release` is genuinely
  all that is needed.
- **No crate dependencies at all** — builds offline, cannot break on a crate update.
- Parallel across stack depths (one thread each, no shared state, no locks).
- Python (`tools/`) for enumeration, equity tables and content generation.

### Output format (as built)
- `data/strategy.json` — the tree structure only (~2 MB). Each node carries its ten-field
  betting-state key so the browser can find it.
- `data/strategy.bin` — the strategies, **one byte per action probability**. As JSON the
  same data runs past 100 MB at high iteration counts.
- `data/abstraction_check.json` — 4,000 samples of hand+board to card-state, written by
  the Rust binary (`--dump-states`). The browser's port of the abstraction is checked
  against it by `verifySolverAbstraction()`. **If these ever disagree the bot reads the
  wrong row and plays nonsense, silently — so this check must stay.**

### Iteration counts: the thing that actually determines quality
**At 50A there are ~1.58 million infosets per stack depth.** This dominates everything.

A 300,000-iteration run gives **0.19 visits per infoset**. The resulting strategy is not
"roughly right" — it is noise. Measured: that bot lost **75 antes per 100 hands** to the
much simpler heuristic bot, and 13% of its exported postflop rows were literally uniform.

Two rules follow, and neither is optional:

1. **Never export an undertrained row.** `--min-visits` (default **300**) drops any
   infoset the sampler did not reach enough times. A missing row makes the browser fall
   back to the heuristic, which is a far better opponent than a coin flip. The floor is
   not the quality dial — iterations are. Do not lower it to "get more coverage".
2. **Iterations needed, per depth:**

| Iterations | Visits per infoset | What is actually solved |
|---|---|---|
| 300k | 0.2 | nothing; noise |
| 20M | ~13 | preflop only, weakly |
| 50M | ~32 | preflop well; little postflop |
| 1B | ~630 | preflop + common postflop lines |
| 5B | ~3,200 | the agreed 72-hour target |

**Timing — measured, not extrapolated.** Small runs scale much better than large ones
because nine threads on eight cores start contending for memory bandwidth. At 50M
iterations: 10A took 286s, 15A 540s, 20A 827s, and 100A (8x the tree of 10A) is the
long pole at roughly 2,900s.

| Hands per depth | Wall clock |
|---|---|
| 300k | 14 seconds |
| 50M | ~50 minutes |
| 1B | ~16 hours |
| 3B | **~2 days** |

Do not estimate these by scaling the 14-second run linearly — that under-predicts badly,
and it is what produced an earlier wrong estimate of 40 hours for the 3B run.

Preflop converges enormously faster than postflop because it has only ~2,900 infosets per
depth against ~1.58M. This is why a partial solve still produces a genuinely strong
preflop strategy while postflop correctly falls back to the heuristic.

### Matching a live hand to a solved node
1. Depth = nearest grid point to the effective stack **as the hand started**
   (`G.effStart`). Using the live `eff()` is wrong: it collapses to 0 once someone is
   all in, and sends the lookup to the 10A tree.
2. Exact ten-field key lookup.
3. If that fails (real stacks drift off the grid, so a 47A jam has no twin in the 50A
   tree), fall back to the closest node of the same shape, rejecting matches further
   than 25% of the pot away.
4. If still nothing, the heuristic bot takes the decision. Measured coverage: **99.4%**
   of bot decisions come from the solved strategy.

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
