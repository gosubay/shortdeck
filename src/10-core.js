<script>
/* =====================================================================
   CORE: 36-card deck, hand evaluator, equity.
   Ranking (locked in SPEC.md, Triton standard):
     Straight Flush > Quads > FLUSH > Full House > Straight > Trips > 2P > P > High
   Ace plays low: A-6-7-8-9 is a straight.
   Card int = rank*4 + suit.  rank 0..8 = 6,7,8,9,T,J,Q,K,A.  suit 0..3 = c,d,h,s.
   This is a direct port of tools/evaluator.py and is verified against it.
   ===================================================================== */
const RANKS = "6789TJQKA";
const SUITS = "cdhs";
const SUIT_GLYPH = ["♣","♦","♥","♠"];   // club diamond heart spade
const SUIT_CLASS = ["grn","blu","red","blk"];               // four-colour deck
const NRANK = 9, NCARD = 36;

const SF=8, QUADS=7, FLUSH=6, BOAT=5, STRAIGHT=4, TRIPS=3, TWOPAIR=2, PAIR=1, HIGH=0;
const CAT_NAME = ["high card","one pair","two pair","three of a kind","straight",
                  "full house","flush","four of a kind","straight flush"];

/* straight masks, best first; value = index of the high card (wheel A6789 -> 3) */
const STRAIGHT_MASKS = (function(){
  const out=[];
  for(let lo=0; lo<5; lo++){ let m=0; for(let i=0;i<5;i++) m|=1<<(lo+i); out.push([m,lo+4]); }
  out.push([(1<<8)|0b1111, 3]);
  out.sort((a,b)=>b[1]-a[1]);
  return out;
})();

const rankOf = c => c>>2, suitOf = c => c&3;
const cardStr = c => RANKS[c>>2] + SUITS[c&3];
function parseCard(s){ return RANKS.indexOf(s[0].toUpperCase())*4 + SUITS.indexOf(s[1].toLowerCase()); }
function parseCards(s){ s=s.replace(/\s/g,""); const o=[]; for(let i=0;i<s.length;i+=2) o.push(parseCard(s.substr(i,2))); return o; }

function straightHigh(mask){
  for(const [m,hi] of STRAIGHT_MASKS) if((mask&m)===m) return hi;
  return -1;
}

/* score: higher is better. 5 to 7 cards. */
function score(cards){
  const rc=[0,0,0,0,0,0,0,0,0], sm=[0,0,0,0], sc=[0,0,0,0];
  let mask=0;
  for(let i=0;i<cards.length;i++){
    const c=cards[i], r=c>>2, s=c&3;
    rc[r]++; sm[s]|=1<<r; sc[s]++; mask|=1<<r;
  }
  let fs=-1;
  for(let s=0;s<4;s++) if(sc[s]>=5){ fs=s; break; }
  if(fs>=0){
    const fm=sm[fs], sfh=straightHigh(fm);
    if(sfh>=0) return (SF<<20)|sfh;
    let v=0,n=0;
    for(let r=NRANK-1;r>=0;r--) if((fm>>r)&1){ v=(v<<4)|r; if(++n===5) break; }
    return (FLUSH<<20)|v;
  }
  let quad=-1, t1=-1, t2=-1, p1=-1, p2=-1;
  for(let r=NRANK-1;r>=0;r--){
    if(rc[r]===4 && quad<0) quad=r;
    else if(rc[r]===3){ if(t1<0) t1=r; else if(t2<0) t2=r; }
    else if(rc[r]===2){ if(p1<0) p1=r; else if(p2<0) p2=r; }
  }
  if(quad>=0){
    let k=-1; for(let r=NRANK-1;r>=0;r--) if(rc[r]&&r!==quad){k=r;break;}
    return (QUADS<<20)|(quad<<4)|k;
  }
  if(t1>=0 && (p1>=0 || t2>=0)){
    const p = Math.max(p1, t2);
    return (BOAT<<20)|(t1<<4)|p;
  }
  const sh = straightHigh(mask);
  if(sh>=0) return (STRAIGHT<<20)|sh;
  if(t1>=0){
    const k=[]; for(let r=NRANK-1;r>=0&&k.length<2;r--) if(rc[r]&&r!==t1) k.push(r);
    return (TRIPS<<20)|(t1<<8)|(k[0]<<4)|k[1];
  }
  if(p1>=0 && p2>=0){
    let k=0; for(let r=NRANK-1;r>=0;r--) if(rc[r]&&r!==p1&&r!==p2){k=r;break;}
    return (TWOPAIR<<20)|(p1<<8)|(p2<<4)|k;
  }
  if(p1>=0){
    const k=[]; for(let r=NRANK-1;r>=0&&k.length<3;r--) if(rc[r]&&r!==p1) k.push(r);
    let v=0; for(const x of k) v=(v<<4)|x;
    return (PAIR<<20)|(p1<<12)|v;
  }
  const k=[]; for(let r=NRANK-1;r>=0&&k.length<5;r--) if(rc[r]) k.push(r);
  let v=0; for(const x of k) v=(v<<4)|x;
  return (HIGH<<20)|v;
}
const categoryOf = cards => CAT_NAME[score(cards)>>20];

/* ---------- deck helpers ---------- */
function freshDeck(){ const d=[]; for(let i=0;i<NCARD;i++) d.push(i); return d; }
function shuffle(a, rng){
  for(let i=a.length-1;i>0;i--){ const j=Math.floor((rng?rng():Math.random())*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}

/* ---------- equity by Monte Carlo (used by the fallback bot) ---------- */
function equityMC(hero, board, iters){
  iters = iters || 400;
  const dead = new Uint8Array(NCARD);
  for(const c of hero) dead[c]=1;
  for(const c of board) dead[c]=1;
  const live=[]; for(let i=0;i<NCARD;i++) if(!dead[i]) live.push(i);
  const need = 5 - board.length;
  let win=0, tie=0;
  const pool = live.slice();
  for(let it=0; it<iters; it++){
    /* partial Fisher-Yates: draw 2 villain cards + the remaining board */
    const n = 2 + need;
    for(let i=0;i<n;i++){
      const j = i + Math.floor(Math.random()*(pool.length-i));
      const t=pool[i]; pool[i]=pool[j]; pool[j]=t;
    }
    const vil=[pool[0],pool[1]];
    const b = board.concat(pool.slice(2,2+need));
    const s1=score(hero.concat(b)), s2=score(vil.concat(b));
    if(s1>s2) win++; else if(s1===s2) tie++;
  }
  return (win + tie/2)/iters;
}

/* ---------- self test: exhaustive, matches tools/test_evaluator.py ---------- */
function selfTest(){
  const fails=[];
  const chk=(d,c)=>{ if(!c) fails.push(d); };
  chk("flush > full house", score(parseCards("Ac9c8c6cTc")) > score(parseCards("AcAdAh6c6d")));
  chk("straight > trips",   score(parseCards("Ac6d7h8s9c")) > score(parseCards("AcAdAh6c7d")));
  chk("quads > flush",      score(parseCards("AcAdAhAs6c")) > score(parseCards("Ac9c8c6cTc")));
  chk("SF > quads",         score(parseCards("6c7c8c9cTc")) > score(parseCards("AcAdAhAs6c")));
  chk("boat > straight",    score(parseCards("AcAdAh6c6d")) > score(parseCards("Ac6d7h8s9c")));
  chk("wheel is a straight", categoryOf(parseCards("Ac6d7h8s9c"))==="straight");
  chk("steel wheel is SF",   categoryOf(parseCards("Ac6c7c8c9c"))==="straight flush");
  chk("6789T beats wheel",  score(parseCards("6c7d8h9sTc")) > score(parseCards("Ac6d7h8s9c")));
  chk("TJQKA top straight", score(parseCards("TcJdQhKsAc")) > score(parseCards("9cTdJhQsKc")));
  /* exhaustive 5-card category census */
  const want={"straight flush":24,"four of a kind":288,"flush":480,"full house":1728,
              "straight":6120,"three of a kind":16128,"two pair":36288,"one pair":193536,
              "high card":122400};
  const got={}; for(const k in want) got[k]=0;
  const h=[0,0,0,0,0];
  let total=0;
  for(h[0]=0;h[0]<36;h[0]++)for(h[1]=h[0]+1;h[1]<36;h[1]++)for(h[2]=h[1]+1;h[2]<36;h[2]++)
  for(h[3]=h[2]+1;h[3]<36;h[3]++)for(h[4]=h[3]+1;h[4]<36;h[4]++){ got[categoryOf(h)]++; total++; }
  chk("total 5-card hands = 376992", total===376992);
  for(const k in want) chk(`${k}: got ${got[k]} want ${want[k]}`, got[k]===want[k]);
  if(fails.length){ console.error("SELF TEST FAILED:", fails); return {ok:false, fails, got}; }
  console.log("Evaluator self-test PASSED (exhaustive 376,992-hand census).", got);
  return {ok:true, got};
}
window.selfTest = selfTest;
</script>
