"""Short deck equity calculator: exact enumeration, with suit-canonicalisation.

Hand classes ("AKs", "JTo", "99") are expanded to concrete combos. Hero's combo is
pinned to one canonical suit assignment (legal because suits are symmetric before the
board is dealt), and every non-conflicting villain combo is enumerated and averaged.
"""
import random
from itertools import combinations
from evaluator import score, RANKS

DECK = list(range(36))

def combos_for(cls):
    """'AA' -> pairs, 'AKs' -> suited, 'AKo' -> offsuit. Returns list of (c1,c2)."""
    r1 = RANKS.index(cls[0]); r2 = RANKS.index(cls[1])
    out = []
    if r1 == r2:
        for a, b in combinations(range(4), 2):
            out.append((r1*4+a, r1*4+b))
    elif cls[2] == 's':
        for s in range(4):
            out.append((r1*4+s, r2*4+s))
    else:
        for a in range(4):
            for b in range(4):
                if a != b:
                    out.append((r1*4+a, r2*4+b))
    return out

def _canonical_hero(cls):
    """One representative hero combo (suit symmetry makes the rest identical)."""
    return combos_for(cls)[0]

def equity_exact(h1, h2, board=(), _cache={}):
    """Exact equity of h1 vs h2 given (0,3,4)-card board. Returns (eq1, eq2, ties)."""
    dead = set(h1) | set(h2) | set(board)
    rest = [c for c in DECK if c not in dead]
    need = 5 - len(board)
    w = t = n = 0
    b = list(board)
    for extra in combinations(rest, need):
        full = b + list(extra)
        s1 = score(h1 + full); s2 = score(h2 + full)
        n += 1
        if s1 > s2: w += 1
        elif s1 == s2: t += 1
    e1 = (w + t/2) / n
    return e1, 1-e1, t/n

def class_vs_class(c1, c2, board=()):
    """Average equity of hand class c1 vs class c2 (hero pinned, villain enumerated)."""
    hero = list(_canonical_hero(c1))
    if any(c in board for c in hero):
        for cand in combos_for(c1):
            if not any(c in board for c in cand):
                hero = list(cand); break
    tot = 0.0; ties = 0.0; k = 0
    for v in combos_for(c2):
        if set(v) & (set(hero) | set(board)):
            continue
        e1, _, ti = equity_exact(hero, list(v), board)
        tot += e1; ties += ti; k += 1
    return tot/k, 1-tot/k, ties/k, k

def outs_equity(n_outs, cards_to_come):
    """Chance of hitting >=1 of n_outs. Short deck: 31 unseen on flop, 30 on turn."""
    if cards_to_come == 1:
        return n_outs / 31.0
    miss = ((31-n_outs)/31.0) * ((30-n_outs)/30.0)
    return 1 - miss
