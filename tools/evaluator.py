"""Short deck (36-card) 7-card hand evaluator.

Ranking (Triton standard, locked in SPEC.md):
  Straight Flush > Quads > Flush > Full House > Straight > Trips > Two Pair > Pair > High
Only change vs holdem: FLUSH BEATS FULL HOUSE.
Ace plays low: A-6-7-8-9 is a straight (the "wheel").

Ranks 6,7,8,9,T,J,Q,K,A -> 0..8.  Card = rank*4 + suit (0..35).
score() returns an int; higher is better; directly comparable.
"""

RANKS = "6789TJQKA"
SUITS = "cdhs"
NRANK = 9

SF, QUADS, FLUSH, BOAT, STRAIGHT, TRIPS, TWOPAIR, PAIR, HIGH = 8,7,6,5,4,3,2,1,0

# straight rank-masks -> high card index (wheel A6789 is 9-high = index 3)
STRAIGHT_MASKS = []
for lo in range(5):
    STRAIGHT_MASKS.append((sum(1 << (lo+i) for i in range(5)), lo+4))
STRAIGHT_MASKS.append(((1 << 8) | 0b1111, 3))          # A,6,7,8,9
STRAIGHT_MASKS.sort(key=lambda t: -t[1])                # best first

def card(txt):
    return RANKS.index(txt[0].upper())*4 + SUITS.index(txt[1].lower())

def card_str(c):
    return RANKS[c >> 2] + SUITS[c & 3]

def hand(txt):
    txt = txt.replace(" ", "")
    return [card(txt[i:i+2]) for i in range(0, len(txt), 2)]

def _straight_high(mask):
    for m, hi in STRAIGHT_MASKS:
        if (mask & m) == m:
            return hi
    return -1

def score(cards):
    """cards: iterable of 5..7 card ints. Returns comparable int."""
    rank_count = [0]*NRANK
    suit_mask  = [0]*4
    suit_count = [0]*4
    mask = 0
    for c in cards:
        r, s = c >> 2, c & 3
        rank_count[r] += 1
        suit_mask[s] |= 1 << r
        suit_count[s] += 1
        mask |= 1 << r

    # flush / straight flush
    flush_suit = -1
    for s in range(4):
        if suit_count[s] >= 5:
            flush_suit = s
            break
    if flush_suit >= 0:
        fm = suit_mask[flush_suit]
        sf = _straight_high(fm)
        if sf >= 0:
            return (SF << 20) | sf
        # top 5 of the flush suit
        top, v = 0, 0
        for r in range(NRANK-1, -1, -1):
            if fm >> r & 1:
                v = (v << 4) | r
                top += 1
                if top == 5:
                    break
        return (FLUSH << 20) | v

    quads = [r for r in range(NRANK) if rank_count[r] == 4]
    if quads:
        q = max(quads)
        kick = max(r for r in range(NRANK) if rank_count[r] and r != q)
        return (QUADS << 20) | (q << 4) | kick

    trips = sorted((r for r in range(NRANK) if rank_count[r] == 3), reverse=True)
    pairs = sorted((r for r in range(NRANK) if rank_count[r] == 2), reverse=True)
    if trips and (pairs or len(trips) > 1):
        t = trips[0]
        p = max(pairs[0] if pairs else -1, trips[1] if len(trips) > 1 else -1)
        return (BOAT << 20) | (t << 4) | p

    sh = _straight_high(mask)
    if sh >= 0:
        return (STRAIGHT << 20) | sh

    if trips:
        t = trips[0]
        ks = [r for r in range(NRANK-1, -1, -1) if rank_count[r] and r != t][:2]
        return (TRIPS << 20) | (t << 8) | (ks[0] << 4) | ks[1]

    if len(pairs) >= 2:
        a, b = pairs[0], pairs[1]
        ks = [r for r in range(NRANK-1, -1, -1) if rank_count[r] and r != a and r != b]
        return (TWOPAIR << 20) | (a << 8) | (b << 4) | (ks[0] if ks else 0)

    if len(pairs) == 1:
        p = pairs[0]
        ks = [r for r in range(NRANK-1, -1, -1) if rank_count[r] and r != p][:3]
        v = 0
        for k in ks: v = (v << 4) | k
        return (PAIR << 20) | (p << 12) | v

    ks = [r for r in range(NRANK-1, -1, -1) if rank_count[r]][:5]
    v = 0
    for k in ks: v = (v << 4) | k
    return (HIGH << 20) | v

CAT_NAME = {SF:"straight flush", QUADS:"quads", FLUSH:"flush", BOAT:"full house",
            STRAIGHT:"straight", TRIPS:"trips", TWOPAIR:"two pair", PAIR:"one pair",
            HIGH:"high card"}

def category(cards):
    return CAT_NAME[score(cards) >> 20]
