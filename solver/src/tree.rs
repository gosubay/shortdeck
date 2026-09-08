//! Betting tree.
//!
//! THE KEY TRICK: subtrees are memoised on the betting STATE (street, what each player
//! has put in, whose turn, raises so far, who was last aggressive) rather than on the
//! full action history. Two different routes to the same pot and stacks share one
//! subtree. Without this the tree is exponential in the number of streets and a
//! four-street solve is impossible; with it the tree is a few thousand nodes.
//!
//! The cost is a real but standard abstraction: the solver cannot tell "bet-bet-call"
//! from "check-raise-call" when both leave the same pot and stacks. Pot and stack depth
//! are the dominant features of a spot, and the last aggressor is kept, so most of the
//! information survives.
//!
//! Money is in TENTHS of an ante everywhere in this file.

use std::collections::HashMap;
use crate::abstraction::{N_POSTFLOP_STATE, N_PREFLOP_STATE};

pub const ANTE: i32 = 10;            // 1.0A
pub const START_POT: i32 = 30;       // both ante 1A, button adds 1A
pub const MAX_RAISES: u8 = 3;        // then jam only; 4 bets per street total
pub const QUANT: i32 = 5;            // round bet targets to 0.5A

/// Bet menus. The opening bet keeps all of the sizes in SPEC.md; later raises are
/// trimmed, because a full menu at every raise depth makes the tree explode and nobody
/// is learning much from the third re-raise sizing.
pub const PF_OPEN: [f32; 2] = [0.5, 1.0];          // plus an explicit min-raise and a jam
pub const POST_OPEN: [f32; 4] = [0.25, 0.5, 1.0, 1.5];
pub const RERAISE: [f32; 2] = [0.5, 1.0];

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Act {
    Fold,
    Check,
    Call,
    /// raise/bet TO this street total; `tag` is the pot fraction (-1 = min-raise, -2 = jam)
    Raise { to: i32, tag: f32 },
}

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Decision,
    FoldWin(u8),      // this player wins because the other folded
    Showdown,
}

pub struct Node {
    pub kind: Kind,
    pub street: u8,
    pub player: u8,
    pub acts: Vec<Act>,
    pub kids: Vec<u32>,
    pub committed: [i32; 2],
    pub off: usize,        // offset into the flat regret / strategy arrays
    pub n_states: usize,
    /// The betting state this node represents, so the browser can find the same node by
    /// reconstructing the key from its own game state:
    /// [street, to_act, committed0, committed1, street_bet0, street_bet1, raises,
    ///  last_agg, to_close, min_inc]
    /// All ten matter: two states agreeing on the first eight can still differ in how many
    /// players still owe an action, or in the minimum legal raise. Those are different
    /// spots with different node ids, so the browser needs all ten to find the right one.
    pub st: [i32; 10],
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct BState {
    street: u8,
    to_act: u8,
    committed: [i32; 2],
    street_bet: [i32; 2],
    raises: u8,
    to_close: u8,          // players who still have to act this street
    min_inc: i32,
    last_agg: i8,
}

fn key_of(s: &BState) -> [i32; 10] {
    [s.street as i32, s.to_act as i32, s.committed[0], s.committed[1],
     s.street_bet[0], s.street_bet[1], s.raises as i32, s.last_agg as i32,
     s.to_close as i32, s.min_inc]
}

pub struct Tree {
    pub nodes: Vec<Node>,
    pub root: u32,
    pub stack: i32,               // starting stack in tenths (effective)
    pub n_slots: usize,           // total f32 slots for regrets (= for strategy)
    memo: HashMap<BState, u32>,
}

pub fn states_for_street(street: u8) -> usize {
    if street == 0 { N_PREFLOP_STATE } else { N_POSTFLOP_STATE }
}

impl Tree {
    pub fn build(depth_antes: i32) -> Tree {
        let stack = depth_antes * 10;
        let mut t = Tree { nodes: Vec::new(), root: 0, stack, n_slots: 0,
                           memo: HashMap::new() };
        // preflop: non-button (seat 1) posts 1A, button (seat 0) posts 2A.
        // Seat 0 is the BUTTON and acts LAST, so seat 1 acts first.
        let root = BState {
            street: 0, to_act: 1,
            committed: [2 * ANTE, ANTE],
            street_bet: [2 * ANTE, ANTE],
            raises: 0, to_close: 2,
            min_inc: 2 * ANTE,       // min raise preflop is to 4A
            last_agg: 0,
        };
        t.root = t.build_node(root);
        // assign storage offsets
        let mut off = 0usize;
        for n in t.nodes.iter_mut() {
            if n.kind == Kind::Decision {
                n.off = off;
                n.n_states = states_for_street(n.street);
                off += n.n_states * n.acts.len();
            }
        }
        t.n_slots = off;
        t
    }

    #[inline]
    fn stack_left(&self, s: &BState, p: usize) -> i32 { self.stack - s.committed[p] }

    fn build_node(&mut self, s: BState) -> u32 {
        if let Some(&i) = self.memo.get(&s) { return i; }

        // street complete?
        if s.to_close == 0 {
            let allin = self.stack_left(&s, 0) <= 0 || self.stack_left(&s, 1) <= 0;
            let idx = if s.street == 3 || allin {
                self.push(Node { kind: Kind::Showdown, street: s.street, player: 0,
                                 acts: vec![], kids: vec![], committed: s.committed,
                                 off: 0, n_states: 0, st: key_of(&s) })
            } else {
                let ns = BState {
                    street: s.street + 1,
                    to_act: 1,                 // non-button acts first postflop too
                    committed: s.committed,
                    street_bet: [0, 0],
                    raises: 0, to_close: 2,
                    min_inc: ANTE,
                    last_agg: -1,
                };
                self.build_node(ns)
            };
            self.memo.insert(s, idx);
            return idx;
        }

        let me = s.to_act as usize;
        let opp = 1 - me;
        let cur = s.street_bet[0].max(s.street_bet[1]);
        let to_call = cur - s.street_bet[me];
        let pot = s.committed[0] + s.committed[1];
        let my_stack = self.stack_left(&s, me);
        let opp_stack = self.stack_left(&s, opp);

        let mut acts: Vec<Act> = Vec::new();
        if to_call > 0 { acts.push(Act::Fold); }
        if to_call == 0 { acts.push(Act::Check); } else { acts.push(Act::Call); }

        // can we put more in?
        let max_to = (my_stack + s.street_bet[me]).min(opp_stack + s.street_bet[opp]);
        if s.raises < MAX_RAISES && my_stack > to_call && max_to > cur {
            let pot_after_call = pot + to_call;
            let mut seen: Vec<i32> = Vec::new();
            let min_to = cur + s.min_inc;

            if s.raises == 0 {
                if s.street == 0 && to_call > 0 {
                    // explicit min-raise (to 4A) preflop
                    let to = min_to;
                    if to < max_to { seen.push(to); acts.push(Act::Raise { to, tag: -1.0 }); }
                }
                let fr: &[f32] = if s.street == 0 { &PF_OPEN } else { &POST_OPEN };
                for &f in fr {
                    let mut to = cur + (f * pot_after_call as f32) as i32;
                    to = ((to + QUANT / 2) / QUANT) * QUANT;
                    if to < min_to { to = min_to; }
                    if to >= max_to || seen.contains(&to) { continue; }
                    seen.push(to);
                    acts.push(Act::Raise { to, tag: f });
                }
            } else {
                for &f in RERAISE.iter() {
                    let mut to = cur + (f * pot_after_call as f32) as i32;
                    to = ((to + QUANT / 2) / QUANT) * QUANT;
                    if to < min_to { to = min_to; }
                    if to >= max_to || seen.contains(&to) { continue; }
                    seen.push(to);
                    acts.push(Act::Raise { to, tag: f });
                }
            }
            acts.push(Act::Raise { to: max_to, tag: -2.0 });     // jam
        }

        let idx = self.push(Node { kind: Kind::Decision, street: s.street, player: s.to_act,
                                   acts: acts.clone(), kids: vec![], committed: s.committed,
                                   off: 0, n_states: 0, st: key_of(&s) });
        self.memo.insert(s, idx);

        let mut kids = Vec::with_capacity(acts.len());
        for a in acts.iter() {
            let ns = match *a {
                Act::Fold => {
                    let w = opp as u8;
                    let t = self.push(Node { kind: Kind::FoldWin(w), street: s.street,
                                             player: 0, acts: vec![], kids: vec![],
                                             committed: s.committed, off: 0, n_states: 0,
                                             st: key_of(&s) });
                    t
                }
                Act::Check => {
                    let mut n = s; n.to_close -= 1; n.to_act = opp as u8;
                    self.build_node(n)
                }
                Act::Call => {
                    let pay = to_call.min(my_stack);
                    let mut n = s;
                    n.committed[me] += pay;
                    n.street_bet[me] += pay;
                    n.to_close -= 1;
                    n.to_act = opp as u8;
                    self.build_node(n)
                }
                Act::Raise { to, .. } => {
                    let pay = to - s.street_bet[me];
                    let mut n = s;
                    n.committed[me] += pay;
                    n.street_bet[me] = to;
                    n.min_inc = (to - cur).max(s.min_inc);
                    n.raises += 1;
                    n.to_close = 1;            // opponent must answer
                    n.to_act = opp as u8;
                    n.last_agg = me as i8;
                    self.build_node(n)
                }
            };
            kids.push(ns);
        }
        self.nodes[idx as usize].kids = kids;
        idx
    }

    fn push(&mut self, n: Node) -> u32 {
        self.nodes.push(n);
        (self.nodes.len() - 1) as u32
    }

    pub fn stats(&self) -> (usize, usize, usize, [usize; 4]) {
        let mut dec = 0; let mut term = 0;
        let mut per_street = [0usize; 4];
        for n in &self.nodes {
            match n.kind {
                Kind::Decision => { dec += 1; per_street[n.street as usize] += 1; }
                _ => term += 1,
            }
        }
        (self.nodes.len(), dec, term, per_street)
    }
}
