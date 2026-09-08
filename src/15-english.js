<script>
/* =====================================================================
   Turns the solved preflop strategy into English.

   Nothing here is hand-written poker advice. Every sentence is computed from the
   strategy file that is currently loaded, so it cannot drift away from what the bot
   actually does, and it improves automatically when a longer solve is committed.
   ===================================================================== */

/* how many of the 630 combos each of the 81 classes represents */
function classCombos(name){
  if(name.length === 2) return 6;              // a pair
  return name[2] === "s" ? 4 : 12;             // suited : offsuit
}
const TOTAL_COMBOS = 630;

/* Weighted action frequencies across every starting hand at one decision node. */
function preflopSummary(D, nodeIdx){
  const node = D.meta.nodes[nodeIdx];
  const rows = D.strat.get(nodeIdx);
  if(!rows || !rows.size) return null;
  const nact = node.a.length;
  const weight = new Array(nact).fill(0);
  let seen = 0;
  const perHand = [];
  for(const [st, probs] of rows){
    const name = SOLVER.tree.preflopClasses[st];
    if(!name) continue;
    const w = classCombos(name);
    let tot = 0; for(const v of probs) tot += v;
    if(tot <= 0) continue;
    seen += w;
    const f = [...probs].map(v => v / tot);
    for(let a = 0; a < nact; a++) weight[a] += f[a] * w;
    perHand.push({name, f, w});
  }
  if(!seen) return null;
  return {node, nact, perHand, seen,
          freq: weight.map(v => v / seen * 100)};
}

/* index of an action of a given kind, or -1 */
function actIdx(node, kind){ return node.a.findIndex(a => a[0] === kind); }

function describeNode(D, nodeIdx, heading, intro){
  const S = preflopSummary(D, nodeIdx);
  if(!S) return "";
  const {node, perHand, freq} = S;

  const fi = actIdx(node, "f"), ci = actIdx(node, "c"), xi = actIdx(node, "x");
  const raiseIdx = node.a.map((a,i)=>a[0]==="r"?i:-1).filter(i=>i>=0);
  const passiveIdx = ci >= 0 ? ci : xi;
  const raisePct = raiseIdx.reduce((a,i)=>a+freq[i], 0);
  const foldPct = fi >= 0 ? freq[fi] : 0;
  const passivePct = passiveIdx >= 0 ? freq[passiveIdx] : 0;

  /* hands sorted by how often they take aggressive action */
  const agg = perHand.map(h => ({
    name: h.name,
    raise: raiseIdx.reduce((a,i)=>a+h.f[i], 0),
    fold: fi >= 0 ? h.f[fi] : 0
  }));
  const topRaise = agg.slice().sort((a,b)=>b.raise-a.raise).slice(0,12);
  const mostFolded = agg.slice().sort((a,b)=>b.fold-a.fold).slice(0,12);
  const neverFold = agg.filter(h=>h.fold < 0.02).length;

  let s = `<h3>${heading}</h3><p>${intro}</p><ul>`;
  s += `<li>It puts money in (bets or raises) with <b>${raisePct.toFixed(1)}%</b> of all hands.</li>`;
  if(fi >= 0) s += `<li>It folds <b>${foldPct.toFixed(1)}%</b> of hands.</li>`;
  s += `<li>It ${ci>=0?"just calls":"checks"} with <b>${passivePct.toFixed(1)}%</b>.</li>`;
  if(fi >= 0) s += `<li><b>${neverFold}</b> of the 81 starting hands are essentially never folded here.</li>`;
  s += `</ul>`;

  s += `<p class="muted">Most aggressive hands: `
     + topRaise.map(h=>`<b>${h.name}</b> ${(h.raise*100).toFixed(0)}%`).join(", ") + `.</p>`;
  if(fi >= 0){
    s += `<p class="muted">Most folded hands: `
       + mostFolded.map(h=>`<b>${h.name}</b> ${(h.fold*100).toFixed(0)}%`).join(", ") + `.</p>`;
  }
  return s;
}

/* Compare the solver's aggression against the raw-equity ranking, and report where the
   two genuinely disagree. This is the interesting part: it shows which hands are worth
   more (or less) than their all-in equity suggests. */
function describeDisagreements(D, nodeIdx, ranking){
  const S = preflopSummary(D, nodeIdx);
  if(!S || !ranking) return "";
  const node = S.node;
  const raiseIdx = node.a.map((a,i)=>a[0]==="r"?i:-1).filter(i=>i>=0);
  const rank = {}; ranking.forEach(r => rank[r.hand] = r.rank);
  const rows = S.perHand.map(h=>({
      name: h.name,
      aggr: raiseIdx.reduce((a,i)=>a+h.f[i],0),
      eqRank: rank[h.name]
    })).filter(r=>r.eqRank);
  if(rows.length < 20) return "";
  /* rank hands by aggression, compare to equity rank */
  const byAggr = rows.slice().sort((a,b)=>b.aggr-a.aggr);
  byAggr.forEach((r,i)=> r.aggrRank = i+1);
  const over = byAggr.filter(r=>r.eqRank - r.aggrRank >= 14)
                     .sort((a,b)=>(b.eqRank-b.aggrRank)-(a.eqRank-a.aggrRank)).slice(0,8);
  const under = byAggr.filter(r=>r.aggrRank - r.eqRank >= 14)
                      .sort((a,b)=>(b.aggrRank-b.eqRank)-(a.aggrRank-a.eqRank)).slice(0,8);
  if(!over.length && !under.length) return "";
  let s = `<h3>Where the solver disagrees with raw equity</h3>`
        + `<p>Each hand has an all-in equity ranking (section 5) and a rank by how hard the `
        + `solver plays it here. Where those two disagree, the difference is playability - `
        + `and that is the part a ranking table cannot teach you.</p>`;
  if(over.length){
    s += `<p><b>Played harder than their equity deserves:</b> `
       + over.map(r=>`${r.name} <span class="muted">(equity #${r.eqRank}, aggression #${r.aggrRank})</span>`).join(", ")
       + `. These make straights and flushes, so they keep playing after the flop.</p>`;
  }
  if(under.length){
    s += `<p><b>Played softer than their equity suggests:</b> `
       + under.map(r=>`${r.name} <span class="muted">(equity #${r.eqRank}, aggression #${r.aggrRank})</span>`).join(", ")
       + `. These win a showdown when they are ahead but flop badly and cannot continue.</p>`;
  }
  return s;
}

function renderSolverEnglish(ranking){
  const box = document.getElementById("sSolverEnglish");
  if(!box) return;
  if(!SOLVER.ready){
    box.innerHTML = '<div class="note warn">No solved strategy is loaded, so there is '
      + 'nothing to describe yet. Run the solver (see the GTO Solver tab) and this '
      + 'section writes itself.</div>';
    return;
  }
  const D = SOLVER.byDepth[50];
  if(!D){ box.innerHTML = '<p class="muted">50A solve not available.</p>'; return; }

  const root = D.meta.root;
  let html = `<div class="note">Generated from the loaded solve: `
           + `<b>${(SOLVER.tree.iterations||0).toLocaleString()}</b> iterations per stack `
           + `depth, at a <b>50A</b> effective stack. Preflop converges long before `
           + `postflop does, so these preflop statements are the trustworthy ones.</div>`;

  html += describeNode(D, root,
    "Out of position, facing the button's extra ante",
    "This is the very first decision of the hand. The non-button has 1A in and the button "
    + "has 2A in, so it costs 1A to continue into a 3A pot.");

  /* the button's reply to a limp: follow the "call" branch from the root */
  const rootNode = D.meta.nodes[root];
  const ci = actIdx(rootNode, "c");
  if(ci >= 0){
    html += describeNode(D, rootNode.kids[ci],
      "On the button, after the opponent just calls",
      "The button has position on every street and already has 2A in. This is the spot "
      + "where the positional advantage of the button ante gets used.");
  }
  html += describeDisagreements(D, root, ranking);
  box.innerHTML = html;
}
window.renderSolverEnglish = renderSolverEnglish;
</script>
