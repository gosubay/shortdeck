"""Short deck (36-card) hand frequency enumeration.

Ranks: 6,7,8,9,T,J,Q,K,A -> indices 0..8.  Ace plays low for A-6-7-8-9.
Category counts for 5-card hands are ranking-INDEPENDENT (the categories are
mutually exclusive), which is how hand rankings are conventionally derived.
"""
from itertools import combinations
from collections import Counter
from math import comb

RANKS = "6789TJQKA"
DECK = [(r, s) for r in range(9) for s in range(4)]

# straights as 9-bit rank masks
STRAIGHTS = []
for lo in range(5):                      # 6789T .. TJQKA
    STRAIGHTS.append(sum(1 << (lo + i) for i in range(5)))
STRAIGHTS.append((1 << 8) | 0b1111)      # A6789 wheel
STRAIGHTS = sorted(set(STRAIGHTS))

def classify5(cards):
    rc = Counter(c[0] for c in cards)
    sc = Counter(c[1] for c in cards)
    mask = 0
    for r in rc: mask |= 1 << r
    flush = max(sc.values()) == 5
    straight = any((mask & s) == s for s in STRAIGHTS)
    counts = sorted(rc.values(), reverse=True)
    if flush and straight: return "straight flush"
    if counts[0] == 4:     return "quads"
    if flush:              return "flush"
    if counts[:2] == [3,2]:return "full house"
    if straight:           return "straight"
    if counts[0] == 3:     return "trips"
    if counts[:2] == [2,2]:return "two pair"
    if counts[0] == 2:     return "one pair"
    return "high card"

def main():
    n5 = Counter()
    for h in combinations(DECK, 5):
        n5[classify5(h)] += 1
    total5 = comb(36, 5)
    order = ["straight flush","quads","flush","full house","straight",
             "trips","two pair","one pair","high card"]
    print(f"=== 5-card hands out of C(36,5) = {total5:,} ===")
    print(f"{'category':<15}{'count':>12}{'1 in':>12}")
    for k in order:
        c = n5[k]
        print(f"{k:<15}{c:>12,}{total5/c:>12,.1f}")
    assert sum(n5.values()) == total5

    # 52-card comparison for the two contested pairs
    D52 = [(r, s) for r in range(13) for s in range(4)]
    print("\n=== same two categories, 52-card deck, 5-card hands ===")
    st52 = 10 * (4**5 - 4)
    tr52 = 13 * 4 * comb(12,2) * 16
    fl52 = (4 * (comb(13,5) - 10))
    fh52 = 13 * 4 * 12 * 6
    print(f"straight {st52:,}   trips {tr52:,}   ratio trips/straight {tr52/st52:.2f}")
    print(f"flush    {fl52:,}   boat  {fh52:,}   ratio boat/flush     {fh52/fl52:.2f}")
    print("\n=== same, 36-card deck ===")
    print(f"straight {n5['straight']:,}   trips {n5['trips']:,}   "
          f"ratio trips/straight {n5['trips']/n5['straight']:.2f}")
    print(f"flush    {n5['flush']:,}   boat  {n5['full house']:,}   "
          f"ratio boat/flush     {n5['full house']/n5['flush']:.2f}")

if __name__ == "__main__":
    main()
