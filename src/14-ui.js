<script>
/* =====================================================================
   UI: rendering, controls, tabs, and the content of the teaching tabs.
   ===================================================================== */
const $ = id => document.getElementById(id);
const el = (tag, cls, html) => { const e=document.createElement(tag);
  if(cls) e.className=cls; if(html!=null) e.innerHTML=html; return e; };

/* ---------- log ---------- */
function logLine(txt, cls){
  const box=$("log"); if(!box) return;
  const d=el("div", cls||"", txt);
  box.appendChild(d); box.scrollTop = box.scrollHeight;
  while(box.childNodes.length>400) box.removeChild(box.firstChild);
}

/* ---------- cards ---------- */
function cardEl(c, small, hidden){
  if(hidden) return el("div","card back"+(small?" sm":""));
  const d=el("div","card "+SUIT_CLASS[suitOf(c)]+(small?" sm":""));
  d.appendChild(el("span","r",RANKS[rankOf(c)]));
  d.appendChild(el("span","s",SUIT_GLYPH[suitOf(c)]));
  return d;
}
function fillCards(node, cards, small, hidden){
  node.innerHTML="";
  for(const c of cards) node.appendChild(cardEl(c, small, hidden));
}

/* ---------- HUD ---------- */
function renderHud(){
  const p = profit();
  const pe = $("hudProfit");
  pe.textContent = (p>=0?"+":"") + fmtA(p);
  pe.className = "v " + (p>0?"up":(p<0?"down":""));
  $("hudHands").textContent = G.hands;
  const wr = $("hudWr");
  if(G.hands>0){
    const w = p/G.hands*100;
    wr.textContent = (w>=0?"+":"") + (Math.round(w*10)/10) + "A";
    wr.className = "v " + (w>0?"up":(w<0?"down":""));
  } else { wr.textContent="--"; wr.className="v"; }
}

/* ---------- table ---------- */
function renderTable(){
  $("meStack").textContent = fmtA(G.stacks[0]);
  $("botStack").textContent = fmtA(G.stacks[1]);
  $("meBtnChip").innerHTML  = isBtn(0)?'<span class="btnchip">BTN</span>':"";
  $("botBtnChip").innerHTML = isBtn(1)?'<span class="btnchip">BTN</span>':"";
  $("myBet").textContent  = G.streetBet[0]>0 ? fmtA(G.streetBet[0]) : "";
  $("botBet").textContent = G.streetBet[1]>0 ? fmtA(G.streetBet[1]) : "";
  $("potVal").textContent = fmtA(G.pot);
  fillCards($("boardCards"), G.board, false, false);
  fillCards($("myCards"), G.live||G.showdownDone ? G.hole[0] : [], false, false);
  fillCards($("botCards"), (G.hole[1].length? G.hole[1]:[]), false, !G.revealBot);
  $("plateMe").classList.toggle("act", G.live && G.toAct===0);
  $("plateBot").classList.toggle("act", G.live && G.toAct===1);
  $("tableMsg").textContent = G.live ? (G.toAct===0 ? "Your action" : "Bot thinking...")
                                     : (G.lastMsg||"Press Deal to start");
  updateEngineTag();
  renderHud();
}

/* ---------- action controls ---------- */
function renderActions(){
  const row=$("actRow"), size=$("sizeRow");
  row.innerHTML=""; size.innerHTML="";
  $("btnNext").style.display = G.live ? "none" : "";
  $("btnNext").textContent = G.hands===0 ? "Deal first hand" : "Next hand →";
  if(!G.live || G.toAct!==0){ return; }

  const acts = legalActions(0);
  for(const a of acts){
    const cls = a.t==="fold" ? "btn fold" : (a.t==="raise" ? "btn raise" : "btn call");
    const b = el("button", cls, a.label);
    b.onclick = ()=>{ act(0,a); };
    row.appendChild(b);
  }
  /* free-form bet box */
  const raiseOpt = acts.find(a=>a.t==="raise");
  if(raiseOpt){
    const toCall = Math.max(0, G.currentBet - G.streetBet[0]);
    const minTo = round1(Math.max(G.currentBet + G.minRaiseInc, G.currentBet + 1));
    const maxTo = round1(Math.min(G.stacks[0]+G.streetBet[0],
                                  G.stacks[1]+G.streetBet[1]));
    const inp = el("input"); inp.type="number"; inp.step="0.5";
    inp.min=minTo; inp.max=maxTo; inp.placeholder="raise to";
    const go = el("button","btn sm raise","Bet this");
    const hint = el("span","muted","");
    const upd = ()=>{
      const v=parseFloat(inp.value);
      if(isNaN(v)) { hint.textContent=`any amount ${minTo}A - ${maxTo}A, in 0.5A steps`; return; }
      const snapped = A(Math.round(T(v)/5)*5);
      const f = snapFrac(snapped, 0);
      hint.textContent = `bet ${snapped.toFixed(1)}A → the bot reads it as `
        + `${f==="jam"?"a jam":Math.round(f*100)+"% pot"}`;
    };
    inp.oninput = upd; upd();
    go.onclick = ()=>{
      let v = parseFloat(inp.value);
      if(isNaN(v)) return;
      /* snap to the 0.5A grid: a real table has no 4.37-ante bet, and staying on the
         grid is what keeps the solved strategy reachable for the rest of the hand */
      v = A(Math.round(T(v)/5)*5);
      v = Math.max(minTo, Math.min(maxTo, v));
      act(0, {t:"raise", to:v, custom:true, label:"custom"});
    };
    size.appendChild(inp); size.appendChild(go); size.appendChild(hint);
  }
}

/* Say plainly how much of the bot is the solver and how much is the fallback. The split
   depends on how long the solve was run, so it is reported live rather than claimed. */
function updateEngineTag(){
  const tag = $("engineTag");
  if(!tag) return;
  if(!SOLVER.ready){
    tag.textContent = "Bot engine: heuristic fallback (solver not yet run)";
    return;
  }
  const tot = SOLVER.hits + SOLVER.misses;
  if(!tot){ tag.textContent = "Bot engine: solved strategy"; return; }
  const pct = Math.round(SOLVER.hits/tot*100);
  tag.textContent = `Bot engine: ${pct}% solved strategy, ${100-pct}% heuristic `
                  + `(${SOLVER.hits} of ${tot} decisions this session)`;
}

function afterStateChange(){
  renderTable(); renderActions();
  if(G.live && G.toAct===1) botTurn();
}

/* ---------- tabs ---------- */
document.querySelectorAll(".tab").forEach(t=>{
  t.onclick = ()=>{
    document.querySelectorAll(".tab").forEach(x=>x.classList.remove("on"));
    document.querySelectorAll(".panel").forEach(x=>x.classList.remove("on"));
    t.classList.add("on");
    $("panel-"+t.dataset.tab).classList.add("on");
    window.scrollTo(0,0);
  };
});

/* ---------- buttons ---------- */
$("btnNext").onclick = ()=>{ if(!G.live) newHand(); };
$("btnReset").onclick = ()=>{
  if(confirm("Reset profit, hand count and stacks back to zero?")){
    resetStats(); $("log").innerHTML=""; G.lastMsg="";
    logLine("Stats reset.","sys"); afterStateChange();
  }
};
$("btnAuto").onclick = ()=>{
  G.autoDeal=!G.autoDeal;
  $("btnAuto").textContent = "Auto-deal: " + (G.autoDeal?"on":"off");
  if(G.autoDeal && !G.live) newHand();
};

/* =====================================================================
   TEACHING CONTENT
   ===================================================================== */
function eqBar(a,b,tie,la,lb){
  const t=tie||0, aa=a, bb=b;
  return `<div class="eqbar" title="${la} ${a.toFixed(1)}% vs ${lb} ${b.toFixed(1)}%">
    <b class="a" style="width:${aa}%">${aa>=14?aa.toFixed(1)+"%":""}</b>
    <b class="b" style="width:${bb}%">${bb>=14?bb.toFixed(1)+"%":""}</b></div>`;
}

function renderStrategyContent(d){
  /* preflop matchups */
  let h = '<div class="scrollx"><table><thead><tr><th>Match-up</th><th class="num">Equity</th>'
        + '<th style="width:38%">Split</th><th>Why it matters</th></tr></thead><tbody>';
  for(const m of d.preflop_matchups){
    h += `<tr><td><b>${m.a}</b> vs <b>${m.b}</b></td>`
       + `<td class="num">${m.eq_a.toFixed(1)}% / ${m.eq_b.toFixed(1)}%</td>`
       + `<td>${eqBar(m.eq_a,m.eq_b,m.tie,m.a,m.b)}</td>`
       + `<td class="muted">${m.note}</td></tr>`;
  }
  $("sMatchups").innerHTML = h + "</tbody></table></div>";

  /* outs */
  let o = '<div class="scrollx"><table><thead><tr><th class="num">Outs</th>'
        + '<th class="num">Short deck, 1 card</th><th class="num">Rule of 3</th>'
        + '<th class="num">Short deck, 2 cards</th><th class="num">Rule of 6</th>'
        + '<th class="num">Holdem, 2 cards</th></tr></thead><tbody>';
  for(const r of d.outs_table){
    const err = Math.abs(r.sd_rule2 - r.sd_two_cards);
    o += `<tr><td class="num"><b>${r.outs}</b></td>`
       + `<td class="num">${r.sd_one_card}%</td>`
       + `<td class="num muted">${r.sd_rule}%</td>`
       + `<td class="num"><b>${r.sd_two_cards}%</b></td>`
       + `<td class="num" style="color:${err>4?'var(--bad)':(err>2?'var(--warn)':'var(--dim)')}">${r.sd_rule2}%</td>`
       + `<td class="num muted">${r.he_two_cards}%</td></tr>`;
  }
  $("sOuts").innerHTML = o + "</tbody></table></div>";

  /* draw outs */
  let dr = '<div class="scrollx"><table><thead><tr><th>Draw</th><th class="num">Outs (short deck)</th>'
         + '<th class="num">Outs (holdem)</th><th>Why</th></tr></thead><tbody>';
  for(const x of d.draw_outs){
    const flag = x.sd_outs<x.he_outs ? 'style="color:var(--bad)"' : '';
    dr += `<tr><td><b>${x.draw}</b></td><td class="num" ${flag}><b>${x.sd_outs}</b></td>`
        + `<td class="num muted">${x.he_outs}</td><td class="muted">${x.why}</td></tr>`;
  }
  $("sDraws").innerHTML = dr + "</tbody></table></div>";

  /* flop spots */
  let f = "";
  for(const m of d.flop_matchups){
    const bcards = parseCards(m.board).map(c=>
      `<span style="color:${['#4ec98a','#6cb6ff','#ff7b72','#e6edf3'][suitOf(c)]}">${RANKS[rankOf(c)]}${SUIT_GLYPH[suitOf(c)]}</span>`).join(" ");
    const outs = (m.outs_b!=null)
      ? `<span class="pill ${m.outs_b>=8?'ok':(m.outs_b>=5?'pend':'err')}">${m.outs_b} outs</span>`
      : `<span class="pill ok">already ahead</span>`;
    f += `<div class="cardbox" style="margin-bottom:9px">
      <h4>${m.name}</h4>
      <div class="muted" style="margin-bottom:6px">
        Board ${bcards} &nbsp;|&nbsp; <b>${m.a}</b> (${m.cat_a}) vs <b>${m.b}</b> (${m.cat_b}) ${outs}
      </div>
      ${eqBar(m.eq_a,m.eq_b,m.tie,m.a,m.b)}
      <p class="muted" style="margin:.55em 0 0">${m.note}</p></div>`;
  }
  $("sFlops").innerHTML = f;

  /* 81-hand ranking */
  let g = '<div class="rankgrid">';
  for(const r of d.preflop_ranking){
    const q = r.rank<=15?"var(--acc)":(r.rank<=40?"var(--gold)":(r.rank<=62?"var(--dim)":"var(--bad)"));
    g += `<div class="rankcell"><span style="color:${q}"><b>${r.hand}</b></span>`
       + `<b class="muted">${r.eq_vs_random.toFixed(1)}%</b></div>`;
  }
  $("sRanking").innerHTML = g + "</div>"
    + `<p class="muted">Ranked by equity against a random hand, `
    + `${d.preflop_ranking_samples.toLocaleString()} simulations each. Green = top 15, `
    + `gold = top 40, red = bottom 20.</p>`;

  /* feed the bot its preflop table, and keep the ranking for the English summary */
  PF_EQ = {};
  for(const r of d.preflop_ranking) PF_EQ[r.hand] = r.eq_vs_random;
  window.PF_RANKING = d.preflop_ranking;
}

/* ---------- solver tab: a walkable view of the solved tree ---------- */
const VIEW = { depth: 50, path: [] };     // path = list of node indices, [0] is the root

function curDepthData(){ return SOLVER.ready ? SOLVER.byDepth[VIEW.depth] : null; }

function actLabel(a, node){
  const potA = (node.c[0] + node.c[1]) / 10;
  switch(a[0]){
    case "f": return "Fold";
    case "x": return "Check";
    case "c": return "Call";
    case "r": {
      const to = a[1] / 10, tag = a[2];
      if(tag === -2) return `Jam ${to.toFixed(1)}A`;
      if(tag === -1) return `Min-raise to ${to.toFixed(1)}A`;
      return `${Math.round(tag*100)}% pot (to ${to.toFixed(1)}A)`;
    }
  }
  return "?";
}

function renderTree(){
  const D = curDepthData();
  const path = $("treePath"), here = $("treeHere"), acts = $("treeActs"),
        view = $("strategyView");
  if(!D){ path.textContent=""; here.textContent=""; acts.innerHTML="";
          view.innerHTML='<p class="muted">Nothing to show yet.</p>'; return; }
  if(!VIEW.path.length) VIEW.path = [D.meta.root];

  const idx = VIEW.path[VIEW.path.length-1];
  const node = D.meta.nodes[idx];

  path.textContent = "Line: " + (VIEW.path.length===1 ? "start of hand"
    : VIEW.path.slice(0,-1).map((p,i)=>{
        const parent = D.meta.nodes[p];
        const child = VIEW.path[i+1];
        const k = parent.kids.indexOf(child);
        return k>=0 ? actLabel(parent.a[k], parent) : "?";
      }).join("  →  "));

  if(node.k !== "D"){
    here.innerHTML = node.k==="S" ? "<b>Showdown.</b> The hand is over."
                                  : "<b>Hand over</b> - someone folded.";
    acts.innerHTML = ""; view.innerHTML = "";
    return;
  }

  const pot = (node.c[0]+node.c[1])/10;
  const seat = node.p===0 ? "Button (acts last)" : "Non-button (acts first)";
  const streetName = ["Preflop","Flop","Turn","River"][node.s];
  const toCall = (Math.max(node.st[4],node.st[5]) - node.st[node.p===0?4:5])/10;
  here.innerHTML = `<b>${streetName}</b> &nbsp;|&nbsp; pot <b>${pot.toFixed(1)}A</b>`
    + ` &nbsp;|&nbsp; to act: <b>${seat}</b>`
    + (toCall>0 ? ` &nbsp;|&nbsp; facing a bet of <b>${toCall.toFixed(1)}A</b>` : "")
    + ` &nbsp;|&nbsp; effective stack <b>${VIEW.depth}A</b>`;

  acts.innerHTML = "";
  node.a.forEach((a,i)=>{
    const b = el("button","btn sm", actLabel(a,node));
    b.onclick = ()=>{ VIEW.path.push(node.kids[i]); renderTree(); };
    acts.appendChild(b);
  });

  /* the strategy table */
  const rows = D.strat.get(idx);
  if(!rows || !rows.size){
    view.innerHTML = '<p class="muted">This spot was reached too rarely in the solve to '
      + 'be exported. Try a more common line.</p>';
    return;
  }
  const hdr = node.a.map(a=>`<th class="num">${actLabel(a,node)}</th>`).join("");
  let body = "";
  const entries = [...rows.entries()].sort((x,y)=>x[0]-y[0]);
  for(const [st, probs] of entries){
    let tot=0; for(const v of probs) tot+=v;
    if(tot<=0) continue;
    const label = node.s===0
      ? (SOLVER.tree.preflopClasses[st] || ("class "+st))
      : `${SOLVER.tree.bucketNames[st % SOLVER.tree.nBucket]}`
        + ` <span class="muted">(${SOLVER.tree.textureNames[Math.floor(st/SOLVER.tree.nBucket)]})</span>`;
    const cells = [...probs].map(v=>{
      const pct = v/tot*100;
      const col = pct>=60?"var(--acc)":(pct>=25?"var(--gold)":(pct>0?"var(--dim)":"var(--dim2)"));
      return `<td class="num" style="color:${col}">${pct>=0.5?pct.toFixed(0)+"%":"·"}</td>`;
    }).join("");
    body += `<tr><td>${label}</td>${cells}</tr>`;
  }
  view.innerHTML = `<div class="scrollx"><table><thead><tr>`
    + `<th>${node.s===0?"Starting hand":"Hand class"}</th>${hdr}</tr></thead>`
    + `<tbody>${body}</tbody></table></div>`
    + `<p class="muted">${entries.length} rows. Postflop rows are bucket names, not exact `
    + `hands - that is the abstraction described below.</p>`;
}

function renderSolverTab(){
  const st=$("solverStatus"), meta=$("solverMeta");
  if(SOLVER.ready){
    const t = SOLVER.tree;
    st.className="pill ok"; st.textContent="solved strategy loaded";
    meta.textContent = ` · ${(t.iterations||0).toLocaleString()} iterations per depth`
                     + ` · generated ${t.generated||"?"}`;
    $("solverMissing").style.display="none";
    $("engineTag").textContent = "Bot engine: solved strategy";
  } else {
    st.className="pill pend"; st.textContent="not solved yet";
    meta.textContent = " · Play tab is using the heuristic fallback bot";
    $("solverMissing").style.display="";
    $("engineTag").textContent = "Bot engine: heuristic fallback (solver not yet run)";
  }
  const dsel=$("selDepth");
  if(dsel && !dsel.options.length){
    for(const d of [10,15,20,30,40,50,65,80,100]){
      const o=el("option"); o.value=d; o.textContent=d+"A"; if(d===50) o.selected=true;
      dsel.appendChild(o);
    }
    dsel.onchange = ()=>{ VIEW.depth = +dsel.value; VIEW.path=[]; renderTree(); };
  }
  const cov = $("solverCoverage");
  if(cov && SOLVER.ready){
    const D = SOLVER.byDepth[50];
    const names=["Preflop","Flop","Turn","River"];
    const have=[0,0,0,0], want=[0,0,0,0];
    for(const n of D.meta.nodes){
      if(n.k!=="D") continue;
      want[n.s] += (n.s===0?81:1296);
    }
    for(const [idx,rows] of D.strat) have[D.meta.nodes[idx].s] += rows.size;
    let h='<table><thead><tr><th>Street</th><th class="num">Situations solved</th>'
        + '<th class="num">Of possible</th><th class="num">Share</th></tr></thead><tbody>';
    for(let i=0;i<4;i++){
      const pct = want[i]? have[i]/want[i]*100 : 0;
      const col = pct>50?"var(--acc)":(pct>10?"var(--gold)":"var(--bad)");
      h += `<tr><td>${names[i]}</td><td class="num">${have[i].toLocaleString()}</td>`
         + `<td class="num muted">${want[i].toLocaleString()}</td>`
         + `<td class="num" style="color:${col}">${pct.toFixed(1)}%</td></tr>`;
    }
    cov.innerHTML = h + '</tbody></table>'
      + '<p class="muted">At 50A. A situation is only included when the solver reached it '
      + 'enough times for the answer to mean something; everything else falls back to the '
      + 'heuristic bot, which is far better than shipping a coin flip. Longer solves fill '
      + 'this in from the top down - preflop converges first because it has ~2,900 '
      + 'situations against roughly 1.58 million after the flop.</p>';
  }
  $("btnTreeBack").onclick = ()=>{ if(VIEW.path.length>1){ VIEW.path.pop(); renderTree(); } };
  $("btnTreeRoot").onclick = ()=>{ VIEW.path=[]; renderTree(); };
  renderTree();
}

/* ---------- boot ---------- */
async function boot(){
  loadStats();
  try{
    const r = await fetch("data/strategy_content.json", {cache:"no-cache"});
    if(r.ok) renderStrategyContent(await r.json());
  }catch(e){ console.warn("teaching content not loaded", e); }
  try{
    await loadSolver();
  }catch(e){ console.warn("solved strategy not loaded:", e); }
  renderSolverTab();
  renderSolverEnglish(window.PF_RANKING);
  afterStateChange();
  logLine("Welcome. Both players ante 1A, the button posts an extra 1A. "
        + "The button acts LAST on every street.","sys");
  logLine("Press \"Deal first hand\" to start.","sys");
}
boot();
</script>
</body>
</html>
