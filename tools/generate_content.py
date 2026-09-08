"""Generates every number the Strategy tab quotes. Output: ../data/strategy_content.json"""
import json, os, random, time, sys
from itertools import combinations
from evaluator import score, hand, card_str, RANKS, category
from equity import class_vs_class, equity_exact, outs_equity, combos_for, DECK

OUT = os.path.join(os.path.dirname(__file__), "..", "data", "strategy_content.json")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
t0 = time.time()
res = {"generated": time.strftime("%Y-%m-%d"), "deck": 36}

def log(m): print(f"[{time.time()-t0:6.1f}s] {m}", flush=True)

# ---------- 1. preflop matchups (exact) ----------
MATCHUPS = [
    ("AA","KK","The classic cooler. In holdem this is 81%; short deck compresses it."),
    ("AA","QQ","Still dominant, but note how much closer it is than holdem."),
    ("AA","AKs","Domination is worth less when everything runs closer."),
    ("AA","JTs","Best pair vs a premium suited connector."),
    ("AA","87s","Even the worst connector holds a real share against aces."),
    ("KK","AKo","The classic pair-vs-overcard race."),
    ("QQ","AKo","Pair vs two overcards - a genuine coinflip in holdem."),
    ("QQ","AKs","Suitedness matters less here: only 5 flush outs, not 9."),
    ("JTs","AJo","Galvin's spot: connected+suited vs dominating top card."),
    ("AKo","99","Overcards vs a middle pair."),
    ("AKs","99","Same race with the suit added."),
    ("87s","AKo","Small connector vs big cards."),
    ("KQs","99","Two big connected cards vs a pair."),
    ("TT","98s","Pair vs connector directly under it."),
    ("AKo","QJs","Big cards vs connected suited."),
    ("77","66","Pair over pair, the small end."),
    ("AQo","KJs","Domination-free big card clash."),
]
log(f"preflop matchups: {len(MATCHUPS)}")
res["preflop_matchups"] = []
for a, b, note in MATCHUPS:
    e1, e2, tie, k = class_vs_class(a, b)
    res["preflop_matchups"].append({"a":a,"b":b,"eq_a":round(e1*100,2),
                                    "eq_b":round(e2*100,2),"tie":round(tie*100,2),
                                    "note":note})
    log(f"  {a} vs {b}: {e1*100:.2f}%")

# ---------- 2. flop matchups (exact, 465 runouts each) ----------
FLOPS = [
    ("One pair (overpair) vs open-ended straight draw",
     "AhAs","JsTd","9c8d6h",
     "JT needs a Q or a 7: 8 outs. In short deck 8 outs twice is ~44%."),
    ("One pair (overpair) vs flush draw",
     "AhAs","KcQc","Jc7c6d",
     "The flush draw has only 5 outs here, not 9. This is the single biggest "
     "difference from holdem."),
    ("Top pair top kicker vs flush draw",
     "AhKd","QcJc","Ac7c6d",
     "Even with two extra overcard outs, the bare flush draw is a big underdog."),
    ("One pair vs combo draw (flush + straight)",
     "AhAs","JcTc","9c8d6h",
     "Flush draw plus open-ender: now it is a real fight."),
    ("Set vs open-ended straight draw",
     "7h7s","JsTd","9c8d7c",
     "Sets are gold in short deck: the board must pair or the straight must come."),
    ("Set vs flush draw",
     "7h7s","KcQc","Jc7d6c",
     "5 outs twice against a hand that can still fill up."),
    ("Trips vs straight-flush draw",
     "9d9h","JcTc","9c8c6h",
     "Galvin's spot. The SFD has flush outs, straight outs and straight-flush outs."),
    ("Two overcards vs middle pair",
     "AhKd","8s8c","Jc9d6h",
     "Only 6 outs, and short deck outs are each worth more."),
    ("Overpair vs gutshot",
     "AhAs","QsJd","9c8d6h",
     "A gutshot is 4 outs - roughly 12% by the river, not the 16% holdem gives you."),
    ("Flush draw vs open-ended straight draw",
     "KcQc","JsTd","9c8c6h",
     "In holdem the flush draw wins this. In short deck it does not."),
]
log("flop matchups")
res["flop_matchups"] = []
for name, h1, h2, b, note in FLOPS:
    H1, H2, B = hand(h1), hand(h2), hand(b)
    e1, e2, tie = equity_exact(H1, H2, B)
    res["flop_matchups"].append({
        "name":name, "a":h1, "b":h2, "board":b,
        "eq_a":round(e1*100,2), "eq_b":round(e2*100,2), "tie":round(tie*100,2),
        "cat_a":category(H1+B), "cat_b":category(H2+B), "note":note})
    log(f"  {name}: {e1*100:.1f}% / {e2*100:.1f}%")

# ---------- 3. rule of 3 and 6 ----------
log("outs table")
res["outs_table"] = []
for n in range(1, 16):
    sd_turn  = outs_equity(n,1)*100
    sd_both  = outs_equity(n,2)*100
    hu_turn  = n/47*100
    hu_both  = (1-((47-n)/47)*((46-n)/46))*100
    res["outs_table"].append({
        "outs":n,
        "sd_one_card":round(sd_turn,1), "sd_two_cards":round(sd_both,1),
        "sd_rule":n*3, "sd_rule2":n*6,
        "he_one_card":round(hu_turn,1), "he_two_cards":round(hu_both,1),
        "he_rule":n*2, "he_rule2":n*4})

res["draw_outs"] = [
    {"draw":"Flush draw","sd_outs":5,"he_outs":9,
     "why":"Only 9 cards of each suit exist (6 through A). You hold 2 and the board "
           "shows 2, so just 5 are left."},
    {"draw":"Open-ended straight draw","sd_outs":8,"he_outs":8,
     "why":"Unchanged - two ranks x four suits. This is why straight draws overtake "
           "flush draws in short deck."},
    {"draw":"Gutshot","sd_outs":4,"he_outs":4,"why":"Unchanged, but each out is worth ~50% more."},
    {"draw":"Flush draw + open-ender","sd_outs":11,"he_outs":15,
     "why":"5 flush outs + 8 straight outs, minus 2 counted twice."},
    {"draw":"Two overcards","sd_outs":6,"he_outs":6,"why":"Unchanged count, higher value per out."},
    {"draw":"Set looking to fill up","sd_outs":7,"he_outs":7,"why":"Board pairs or you hit quads."},
]

# ---------- 4. all 81 starting hands ranked (Monte Carlo vs random hand) ----------
log("ranking all 81 starting hands (Monte Carlo)")
SAMPLES = 40000
rng = random.Random(20260908)
classes = []
for i, r1 in enumerate(RANKS):
    classes.append(r1+r1)
    for r2 in RANKS[:i]:
        classes.append(r1+r2+"s"); classes.append(r1+r2+"o")
rank_rows = []
for ci, cls in enumerate(classes):
    hero = list(combos_for(cls)[0])
    live = [c for c in DECK if c not in hero]
    w = t = 0
    for _ in range(SAMPLES):
        d = rng.sample(live, 7)
        vil, board = d[:2], d[2:]
        s1 = score(hero+board); s2 = score(vil+board)
        if s1 > s2: w += 1
        elif s1 == s2: t += 1
    eq = (w + t/2)/SAMPLES*100
    rank_rows.append({"hand":cls, "eq_vs_random":round(eq,2)})
    if ci % 10 == 0: log(f"  {ci}/{len(classes)} {cls} {eq:.1f}%")
rank_rows.sort(key=lambda r: -r["eq_vs_random"])
for i, r in enumerate(rank_rows): r["rank"] = i+1
res["preflop_ranking"] = rank_rows
res["preflop_ranking_samples"] = SAMPLES

# ---------- 5. 5-card frequency table ----------
res["hand_frequencies"] = [
    {"cat":"Straight flush","sd":24,"he":40},
    {"cat":"Four of a kind","sd":288,"he":624},
    {"cat":"Flush","sd":480,"he":5108},
    {"cat":"Full house","sd":1728,"he":3744},
    {"cat":"Straight","sd":6120,"he":10200},
    {"cat":"Three of a kind","sd":16128,"he":54912},
    {"cat":"Two pair","sd":36288,"he":123552},
    {"cat":"One pair","sd":193536,"he":1098240},
    {"cat":"High card","sd":122400,"he":1302540},
]
res["total_5card"] = {"sd":376992,"he":2598960}

json.dump(res, open(OUT,"w"), indent=1)
log(f"WROTE {OUT}")
