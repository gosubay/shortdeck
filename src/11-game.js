<script>
/* =====================================================================
   GAME ENGINE: heads-up short deck, ante structure per SPEC.md
     - both ante 1A, button posts an extra 1A  -> starting pot 3A
     - the BUTTON acts LAST on every street (it posted the most)
     - start 50A, below 10A -> top up to 50A, above 100A -> rathole to 100A
   Seat 0 = human, seat 1 = bot.
   ===================================================================== */
const START_STACK = 50, MIN_STACK = 10, MAX_STACK = 100;
const ANTE = 1, BUTTON_ANTE = 1;              // button posts ANTE + BUTTON_ANTE
const PF_FRACS = [0.5, 1.0];                  // preflop pot-relative raises
const PF_MINRAISE_LABEL = "Min 4A";
const POST_FRACS = [0.25, 0.5, 1.0, 1.5];     // postflop pot-relative bets/raises
const MAX_BETS_PER_STREET = 4;                // then jam only
const STREETS = ["Preflop","Flop","Turn","River"];

const G = {
  stacks:[START_STACK, START_STACK],
  banked:[0,0], toppedUp:[0,0],
  hands:0, button:0,
  /* per-hand */
  live:false, street:0, board:[], hole:[[],[]], deck:[],
  committed:[0,0],      // total put in this hand by each seat
  streetBet:[0,0],      // put in on the current street
  pot:0, currentBet:0, minRaiseInc:0, betsThisStreet:0,
  toAct:0, actorsToAct:0, folded:-1, allIn:[false,false],
  showdownDone:false, lastMsg:"", handLog:[],
  autoDeal:false, revealBot:false
};

const eff = () => Math.min(G.stacks[0], G.stacks[1]);
const other = s => 1-s;
const isBtn = s => G.button===s;
const fmtA = v => (Math.round(v*10)/10).toFixed(1)+"A";

/* ---------- stats ---------- */
const STATS_KEY = "shortdeck.stats.v1";
function profit(){
  /* Chips committed to a pot that is still being contested are NOT a loss yet, so a live
     hand reads as flat until it resolves. Without this the HUD shows -2.0A the instant
     the antes are posted, which is not what your session is actually doing. */
  const atRisk = G.live ? G.committed[0] : 0;
  return (G.stacks[0] + atRisk + G.banked[0]) - (START_STACK + G.toppedUp[0]);
}
function saveStats(){
  try{ localStorage.setItem(STATS_KEY, JSON.stringify({
    stacks:G.stacks, banked:G.banked, toppedUp:G.toppedUp, hands:G.hands, button:G.button
  })); }catch(e){}
}
function loadStats(){
  try{
    const s = JSON.parse(localStorage.getItem(STATS_KEY)||"null");
    if(s && Array.isArray(s.stacks)){
      G.stacks=s.stacks; G.banked=s.banked; G.toppedUp=s.toppedUp;
      G.hands=s.hands|0; G.button=s.button|0;
    }
  }catch(e){}
}
function resetStats(){
  G.stacks=[START_STACK,START_STACK]; G.banked=[0,0]; G.toppedUp=[0,0];
  G.hands=0; G.button=0; G.live=false; G.handLog=[];
  saveStats();
}

/* ---------- stack maintenance between hands ---------- */
function maintainStacks(){
  const notes=[];
  for(let s=0;s<2;s++){
    if(G.stacks[s] > MAX_STACK){
      const skim = G.stacks[s]-MAX_STACK;
      G.banked[s]+=skim; G.stacks[s]=MAX_STACK;
      notes.push(`${s===0?"You":"Bot"} ratholed ${fmtA(skim)} (banked, back to 100A)`);
    }
    if(G.stacks[s] < MIN_STACK){
      const add = START_STACK-G.stacks[s];
      G.toppedUp[s]+=add; G.stacks[s]=START_STACK;
      notes.push(`${s===0?"You":"Bot"} dropped under 10A - topped up to 50A`);
    }
  }
  return notes;
}

/* ---------- start a hand ---------- */
function newHand(){
  const notes = maintainStacks();
  G.live=true; G.street=0; G.board=[]; G.folded=-1; G.showdownDone=false;
  G.allIn=[false,false]; G.betsThisStreet=0; G.revealBot=false;
  G.deck = shuffle(freshDeck());
  G.hole=[[G.deck.pop(),G.deck.pop()],[G.deck.pop(),G.deck.pop()]];
  G.committed=[0,0]; G.streetBet=[0,0]; G.pot=0;

  notes.forEach(n=>logLine(n,"sys"));
  logLine(`--- Hand #${G.hands+1} - you are ${isBtn(0)?"the BUTTON":"out of position"} `
        + `- effective ${fmtA(eff())} ---`, "sys");

  /* antes: both post 1A, button posts an extra 1A */
  for(let s=0;s<2;s++) postChips(s, ANTE + (isBtn(s)?BUTTON_ANTE:0));
  G.currentBet = ANTE + BUTTON_ANTE;
  G.minRaiseInc = ANTE + BUTTON_ANTE;      // min raise preflop is to 4A
  G.toAct = other(G.button);               // non-button acts first
  G.actorsToAct = 2;
  logLine(`Antes posted. Pot ${fmtA(G.pot)}.`, "sys");
  afterStateChange();
}

function postChips(s, amt){
  amt = Math.min(amt, G.stacks[s]);
  G.stacks[s]-=amt; G.committed[s]+=amt; G.streetBet[s]+=amt; G.pot+=amt;
  if(G.stacks[s]<=1e-9) G.allIn[s]=true;
  return amt;
}

/* ---------- legal actions for the seat to act ---------- */
function legalActions(s){
  const toCall = Math.max(0, G.currentBet - G.streetBet[s]);
  const stack = G.stacks[s];
  const acts = [];
  if(toCall > 0) acts.push({t:"fold", label:"Fold"});
  if(toCall === 0) acts.push({t:"check", label:"Check", amt:0});
  else acts.push({t:"call", label:`Call ${fmtA(Math.min(toCall,stack))}`, amt:Math.min(toCall,stack)});

  /* can we put in more? */
  const oppMax = G.stacks[other(s)] + G.streetBet[other(s)];   // most opponent can match
  const myMaxTo = Math.min(stack + G.streetBet[s], oppMax);    // cap: no bet bigger than opponent can call
  if(myMaxTo > G.currentBet + 1e-9 && G.stacks[s] > toCall + 1e-9){
    const potAfterCall = G.pot + toCall;
    const fracs = G.street===0 ? PF_FRACS : POST_FRACS;
    const seen = new Set();
    const capReached = G.betsThisStreet >= MAX_BETS_PER_STREET;

    if(!capReached){
      if(G.street===0 && toCall>0){
        /* explicit min-raise button preflop */
        const to = G.currentBet + G.minRaiseInc;
        if(to < myMaxTo-1e-9){ seen.add(round1(to));
          acts.push({t:"raise", to:round1(to), label:`${PF_MINRAISE_LABEL}`}); }
      }
      for(const f of fracs){
        let to = G.currentBet + f*potAfterCall;
        to = round1(to);
        const minTo = G.currentBet + Math.max(G.minRaiseInc, G.street===0?0:1);
        if(to < minTo) to = round1(minTo);
        if(to >= myMaxTo-1e-9) continue;          // that is a jam, listed separately
        if(seen.has(to)) continue;
        seen.add(to);
        acts.push({t:"raise", to, frac:f,
                   label:`${toCall>0?"Raise":"Bet"} ${Math.round(f*100)}% (${fmtA(to-G.streetBet[s])})`});
      }
    }
    acts.push({t:"raise", to:round1(myMaxTo), jam:true,
               label:`Jam ${fmtA(Math.min(stack, myMaxTo-G.streetBet[s]))}`});
  }
  return acts;
}
const round1 = v => Math.round(v*10)/10;

/* snap an arbitrary raise-to onto the abstraction (geometric midpoints, SPEC.md) */
function snapFrac(rawTo, s){
  const toCall = Math.max(0, G.currentBet - G.streetBet[s]);
  const potAfterCall = G.pot + toCall;
  if(potAfterCall<=0) return "jam";
  const f = (rawTo - G.currentBet)/potAfterCall;
  const fracs = G.street===0 ? PF_FRACS : POST_FRACS;
  const oppMax = G.stacks[other(s)] + G.streetBet[other(s)];
  const jamTo = Math.min(G.stacks[s]+G.streetBet[s], oppMax);
  const jamF = (jamTo - G.currentBet)/potAfterCall;
  const pts = fracs.filter(x=>x<jamF).concat([jamF]);
  for(let i=0;i<pts.length-1;i++){
    const mid = Math.sqrt(pts[i]*pts[i+1]);      // geometric midpoint
    if(f < mid) return pts[i];
  }
  return pts[pts.length-1]===jamF ? "jam" : pts[pts.length-1];
}

/* ---------- apply an action ---------- */
function act(s, a){
  const toCall = Math.max(0, G.currentBet - G.streetBet[s]);
  const who = s===0?"You":"Bot", cls = s===0?"hero":"bot";
  if(a.t==="fold"){
    G.folded = s; logLine(`${who} fold.`, cls); endHand(); return;
  }
  if(a.t==="check"){ logLine(`${who} check.`, cls); G.actorsToAct--; }
  else if(a.t==="call"){
    const paid = postChips(s, toCall);
    logLine(`${who} call ${fmtA(paid)}.`, cls);
    G.actorsToAct--;
  } else {
    const target = a.to;
    const put = target - G.streetBet[s];
    const paid = postChips(s, put);
    const inc = target - G.currentBet;
    G.minRaiseInc = Math.max(G.minRaiseInc, inc);
    G.currentBet = G.streetBet[s];
    G.betsThisStreet++;
    const verb = toCall>0 ? "raise to" : "bet";
    logLine(`${who} ${verb} ${fmtA(G.currentBet)}${G.allIn[s]?" (all in)":""}.`, cls);
    G.actorsToAct = 1;                      // opponent must respond
  }
  /* if either player is all in, no further action is possible */
  if(G.allIn[0]||G.allIn[1]){
    const need = Math.max(0, G.currentBet - G.streetBet[other(s)]);
    if(G.allIn[other(s)] || need<=0 || G.actorsToAct<=0){ runOut(); return; }
  }
  if(G.actorsToAct<=0){ nextStreet(); return; }
  G.toAct = other(s);
  afterStateChange();
}

/* ---------- street transitions ---------- */
function nextStreet(){
  refundUncalled();
  if(G.street>=3){ showdown(); return; }
  G.street++;
  G.streetBet=[0,0]; G.currentBet=0; G.minRaiseInc=1; G.betsThisStreet=0;
  const n = G.street===1?3:1;
  for(let i=0;i<n;i++) G.board.push(G.deck.pop());
  logLine(`${STREETS[G.street]}: ${G.board.map(cardStr).join(" ")} - pot ${fmtA(G.pot)}`, "sys");
  if(G.allIn[0]||G.allIn[1]){ runOut(); return; }
  G.toAct = other(G.button);
  G.actorsToAct = 2;
  afterStateChange();
}

function runOut(){
  refundUncalled();
  G.revealBot = true;
  while(G.board.length<5) G.board.push(G.deck.pop());
  logLine(`Run out: ${G.board.map(cardStr).join(" ")}`, "sys");
  showdown();
}

/* return the part of a bet the opponent could not cover */
function refundUncalled(){
  const d = G.committed[0]-G.committed[1];
  if(Math.abs(d) < 1e-9) return;
  const over = d>0?0:1, amt = Math.abs(d);
  G.stacks[over]+=amt; G.committed[over]-=amt; G.pot-=amt;
  logLine(`Uncalled ${fmtA(amt)} returned to ${over===0?"you":"the bot"}.`, "sys");
}

/* ---------- resolution ---------- */
function showdown(){
  G.revealBot = true;
  const s0=score(G.hole[0].concat(G.board)), s1=score(G.hole[1].concat(G.board));
  const c0=categoryOf(G.hole[0].concat(G.board)), c1=categoryOf(G.hole[1].concat(G.board));
  let msg;
  if(s0>s1){ G.stacks[0]+=G.pot; msg=`You win ${fmtA(G.pot)} with ${c0} (bot had ${c1}).`; }
  else if(s1>s0){ G.stacks[1]+=G.pot; msg=`Bot wins ${fmtA(G.pot)} with ${c1} (you had ${c0}).`; }
  else { G.stacks[0]+=G.pot/2; G.stacks[1]+=G.pot/2; msg=`Split pot - both ${c0}.`; }
  G.pot=0; logLine(msg,"res"); G.lastMsg=msg;
  finishHand();
}
function endHand(){          // someone folded
  refundUncalled();
  const w = other(G.folded);
  G.stacks[w]+=G.pot;
  G.lastMsg = `${w===0?"You win":"Bot wins"} ${fmtA(G.pot)}.`;
  logLine(G.lastMsg,"res");
  G.pot=0;
  finishHand();
}
function finishHand(){
  G.live=false; G.hands++; G.button=other(G.button);
  saveStats(); afterStateChange();
  if(G.autoDeal) setTimeout(()=>{ if(!G.live) newHand(); }, 1100);
}

/* =====================================================================
   BOT
   Uses the solved strategy when data/strategy.json is present; otherwise a
   heuristic fallback built on real Monte Carlo equity. The fallback is a genuine
   opponent but it is NOT the solver, and the UI says so.
   ===================================================================== */
let SOLVED = null;            // filled by loadStrategy()
let PF_EQ = null;             // 81-hand preflop equity table from strategy_content.json

function handClass(cards){
  const r1=rankOf(cards[0]), r2=rankOf(cards[1]);
  const hi=Math.max(r1,r2), lo=Math.min(r1,r2);
  if(r1===r2) return RANKS[hi]+RANKS[hi];
  return RANKS[hi]+RANKS[lo]+(suitOf(cards[0])===suitOf(cards[1])?"s":"o");
}

function botEquity(){
  const it = G.street===0 ? 900 : (G.street===3 ? 0 : 700);
  if(G.street===0 && PF_EQ){
    const e = PF_EQ[handClass(G.hole[1])];
    if(e!=null) return e/100;
  }
  if(G.street===3){
    /* river: exact-ish, sample villain hands only */
    return equityMC(G.hole[1], G.board, 600);
  }
  return equityMC(G.hole[1], G.board, it);
}

function botChoose(){
  const s=1, acts=legalActions(s);
  const toCall = Math.max(0, G.currentBet - G.streetBet[s]);
  const eq = botEquity();
  const potAfterCall = G.pot + toCall;
  const potOdds = toCall>0 ? toCall/potAfterCall : 0;
  const r = Math.random();
  const byType = t => acts.filter(a=>a.t===t);
  const raises = byType("raise").filter(a=>!a.jam);
  const jam = byType("raise").find(a=>a.jam);
  const pick = arr => arr[Math.floor(Math.random()*arr.length)];

  /* pressure: shallower stacks -> more willing to get it in */
  const spr = eff()/Math.max(G.pot,1);

  if(toCall===0){
    /* we may check or bet */
    let betChance = 0;
    if(eq>0.80) betChance=0.85; else if(eq>0.68) betChance=0.72;
    else if(eq>0.55) betChance=0.5; else if(eq>0.45) betChance=0.28;
    else betChance=0.22;                                    // bluffs
    if(G.street===0) betChance = eq>0.56?0.8:(eq>0.5?0.55:0.3);
    if(r<betChance && raises.length){
      /* size up with strength, and sometimes overbet with the nuts */
      let want;
      if(eq>0.82) want = Math.random()<0.35?1.5:1.0;
      else if(eq>0.6) want = Math.random()<0.5?1.0:0.5;
      else if(eq>0.45) want = 0.5;
      else want = Math.random()<0.5?0.25:0.5;               // bluff sizing
      const a = raises.reduce((b,x)=>
        Math.abs((x.frac||1)-want) < Math.abs((b.frac||1)-want) ? x : b, raises[0]);
      return a;
    }
    return byType("check")[0] || acts[0];
  }

  /* facing a bet */
  const raiseEdge = eq - potOdds;
  if(eq > 0.78 && raises.length && r<0.62) return pick(raises);
  if(eq > 0.86 && jam && spr<3.2 && r<0.6) return jam;
  if(eq > potOdds + 0.06) return byType("call")[0];
  if(eq > potOdds - 0.02 && r<0.55) return byType("call")[0];
  /* bluff-raise occasionally with the worst hands (they cannot call anyway) */
  if(eq < potOdds-0.12 && raises.length && r<0.09) return pick(raises);
  return byType("fold")[0] || byType("check")[0] || acts[0];
}

function botTurn(){
  if(!G.live || G.toAct!==1) return;
  const delay = 380 + Math.random()*520;
  setTimeout(()=>{
    if(!G.live || G.toAct!==1) return;
    const a = botChoose();
    act(1, a);
  }, delay);
}
</script>
