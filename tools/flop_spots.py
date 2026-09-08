"""Recomputes the flop matchups and PATCHES data/strategy_content.json.

Every spot is auto-verified: the script counts the villain's real outs and the made
category of both hands, and refuses to write if the label contradicts the maths.
"""
import json, os, sys
from itertools import combinations
from evaluator import score, hand, category, card_str
from equity import equity_exact, DECK

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "strategy_content.json")

def outs_count(h_hero, h_vill, board):
    """How many single turn cards give villain the current lead (and how many of those
    make a flush / straight / straight flush)."""
    dead = set(h_hero) | set(h_vill) | set(board)
    live = [c for c in DECK if c not in dead]
    ahead_now = score(h_vill + board) > score(h_hero + board)
    outs = []
    for c in live:
        b2 = board + [c]
        if score(h_vill + b2) > score(h_hero + b2):
            outs.append(c)
    return outs, ahead_now

SPOTS = [
    # --- one board, four different draws, same overpair: the headline comparison ---
    ("Overpair vs open-ended straight draw", "AhAs", "JsTs", "9c8c6h", 8,
     "JT needs a Q or a 7 to make the straight: 8 outs. Note the draw is the FAVOURITE. "
     "In holdem the aces would be about 57%."),
    ("Overpair vs flush draw", "AhAs", "KcQc", "9c8c6h", 5,
     "Same board, same aces, but the draw is now clubs. Only 5 clubs remain, and pairing "
     "the K or Q is worthless against aces. This is the short deck lesson in one row."),
    ("Overpair vs combo draw (flush + straight)", "AhAs", "JcTc", "9c8c6h", 11,
     "5 flush outs plus 8 straight outs, minus 2 counted twice, and the Qc and 7c make a "
     "STRAIGHT FLUSH. Now the draw is a clear favourite."),
    ("Overpair vs gutshot", "AhAs", "QsJs", "9c8c6h", 4,
     "Only the ten completes it: 4 outs. A gutshot is worth about 24% by the river here, "
     "against 16% in holdem."),
    # --- made hands ---
    ("Set vs straight-flush draw", "9d9h", "JcTc", "9c8c6h", 11,
     "Galvin's spot. Even a flopped set is barely ahead of a big combo draw, because the "
     "straight-flush outs cannot be redrawn against."),
    ("Set vs open-ended straight draw", "7h7s", "JsTs", "7c9dQh", 8,
     "A set against a clean 8-outer. This is the shape you want your money in."),
    ("Set vs flush draw", "7h7s", "Tc9c", "7cQcAd", 5,
     "Against a bare 5-out flush draw the set is a big favourite - and it can still fill "
     "up to beat the flush when it does come."),
    ("Top pair top kicker vs flush draw + overcards", "AhKd", "QcJc", "Ac7c6d", 0,
     "The draw has 5 flush outs plus a Q or J to pair, and is still a clear underdog. "
     "Top pair is not always thin here - against a DRAW it holds up fine."),
    ("Two overcards vs an underpair", "AhKd", "8s8c", "Jc9d6h", 0,
     "Six outs and nothing else. In short deck the small pair is a solid favourite."),
    ("Overpair vs flopped two pair", "AhAs", "9s8d", "9c8c6h", 0,
     "The nightmare. Two pair flops constantly in short deck because every hand is made "
     "of big connected cards."),
]

def main():
    data = json.load(open(OUT))
    rows, problems = [], []
    for name, h1, h2, b, want_outs, note in SPOTS:
        H1, H2, B = hand(h1), hand(h2), hand(b)
        if len(set(H1+H2+B)) != len(H1)+len(H2)+len(B):
            problems.append(f"{name}: duplicate card"); continue
        e1, e2, tie = equity_exact(H1, H2, B)
        outs, ahead = outs_count(H1, H2, B)
        c1, c2 = category(H1+B), category(H2+B)
        if want_outs and len(outs) != want_outs:
            problems.append(f"{name}: label claims {want_outs} outs, actual {len(outs)} "
                            f"({' '.join(card_str(c) for c in outs)})")
        if "draw" in name.lower() and c2 not in ("high card","one pair"):
            problems.append(f"{name}: villain labelled a DRAW but already has {c2}")
        rows.append({"name":name,"a":h1,"b":h2,"board":b,
                     "eq_a":round(e1*100,2),"eq_b":round(e2*100,2),"tie":round(tie*100,2),
                     "cat_a":c1,"cat_b":c2,
                     "outs_b":(None if ahead else len(outs)),
                     "b_ahead":ahead,
                     "outs_cards":("" if ahead else " ".join(card_str(c) for c in outs)),
                     "note":note})
        print(f"{name:<46} {e1*100:5.1f}% / {e2*100:5.1f}%   "
              f"[{c1} vs {c2}] villain outs={len(outs)}")
    if problems:
        print("\nLABEL CHECK FAILED:")
        for p in problems: print("  -", p)
        sys.exit(1)
    data["flop_matchups"] = rows
    json.dump(data, open(OUT,"w"), indent=1)
    print(f"\nAll {len(rows)} spots verified. Patched {OUT}")

if __name__ == "__main__":
    main()
