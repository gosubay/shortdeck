"""Self-tests for the short deck evaluator. Must all pass before anything is built on it."""
from evaluator import score, hand, category, CAT_NAME
from itertools import combinations
from collections import Counter
from math import comb

fails = []
def chk(desc, cond):
    if not cond: fails.append(desc)

# --- category detection ---
cases = [
    ("6c7c8c9cTc", "straight flush"),
    ("Ac6c7c8c9c", "straight flush"),       # wheel steel wheel
    ("AcAdAhAs6c", "quads"),
    ("Ac9c8c6cTc", "flush"),
    ("AcAdAh6c6d", "full house"),
    ("Ac6d7h8s9c", "straight"),             # ace-low straight
    ("TcJdQhKsAc", "straight"),
    ("AcAdAh6c7d", "trips"),
    ("AcAd6c6d7h", "two pair"),
    ("AcAd6c7d8h", "one pair"),
    ("Ac6d7h9sJc", "high card"),
]
for h, want in cases:
    chk(f"{h} should be {want}, got {category(hand(h))}", category(hand(h)) == want)

# --- THE short deck ranking rules ---
chk("flush must beat full house", score(hand("Ac9c8c6cTc")) > score(hand("AcAdAh6c6d")))
chk("straight must beat trips",   score(hand("Ac6d7h8s9c")) > score(hand("AcAdAh6c7d")))
chk("quads beat flush",           score(hand("AcAdAhAs6c")) > score(hand("Ac9c8c6cTc")))
chk("SF beats quads",             score(hand("6c7c8c9cTc")) > score(hand("AcAdAhAs6c")))
chk("boat beats straight",        score(hand("AcAdAh6c6d")) > score(hand("Ac6d7h8s9c")))

# --- straight ordering, wheel is lowest ---
chk("TJQKA > 9TJQK", score(hand("TcJdQhKsAc")) > score(hand("9c TdJhQsKc".replace(" ",""))))
chk("6789T > A6789 (wheel lowest)", score(hand("6c7d8h9sTc")) > score(hand("Ac6d7h8s9c")))

# --- 7-card picks the best 5 ---
chk("7 cards find the flush", category(hand("Ac9c8c6cTc2h".replace("2h","7d")+"Jd")) == "flush")
chk("7 cards find wheel straight", category(hand("Ac6d7h8sQcKd9c")) in ("straight","flush"))

# --- exhaustive: 5-card category counts must match the known enumeration ---
DECK = list(range(36))
cnt = Counter()
for h in combinations(DECK, 5):
    cnt[category(h)] += 1
expect = {"straight flush":24, "quads":288, "flush":480, "full house":1728,
          "straight":6120, "trips":16128, "two pair":36288, "one pair":193536,
          "high card":122400}
for k, v in expect.items():
    chk(f"count {k}: got {cnt[k]:,} want {v:,}", cnt[k] == v)
chk("total 5-card hands", sum(cnt.values()) == comb(36,5))

if fails:
    print(f"FAILED {len(fails)}:")
    for f in fails: print("  -", f)
    raise SystemExit(1)
print(f"All evaluator tests passed ({len(cases)+len(expect)+8} checks, "
      f"including exhaustive {comb(36,5):,}-hand enumeration).")
