//! External-sampling Monte Carlo CFR with regret matching PLUS.
//!
//! One iteration: deal a whole hand (both hole cards and all five board cards), then walk
//! the betting tree. At the traverser's nodes every action is explored; at the opponent's
//! nodes one action is sampled. Because the board is dealt up front, showdowns and all-in
//! run-outs are both just "score the full five-card board", and no chance nodes are needed
//! in the tree at all.

use crate::abstraction::*;
use crate::cards::*;
use crate::tree::{Act, Kind, Tree};

pub struct Solve {
    pub regret: Vec<f32>,
    pub strat: Vec<f32>,
    pub visits: Vec<f32>,
}

impl Solve {
    pub fn new(n: usize) -> Solve {
        Solve { regret: vec![0.0; n], strat: vec![0.0; n], visits: vec![0.0; n] }
    }
}

/// Card state index for `player` at `street`, given the sampled deal.
#[inline]
fn state_of(street: u8, player: usize, holes: &[[u8; 2]; 2], board: &[u8; 5]) -> usize {
    match street {
        0 => preflop_class(&holes[player]),
        1 => postflop_state(&holes[player], &board[..3]),
        2 => postflop_state(&holes[player], &board[..4]),
        _ => postflop_state(&holes[player], &board[..5]),
    }
}

/// Regret matching+: strategy proportional to positive regret, uniform if none.
#[inline]
fn strategy(regret: &[f32], out: &mut [f32]) {
    let mut sum = 0.0f32;
    for i in 0..regret.len() {
        let r = if regret[i] > 0.0 { regret[i] } else { 0.0 };
        out[i] = r;
        sum += r;
    }
    if sum > 1e-9 {
        let inv = 1.0 / sum;
        for i in 0..regret.len() { out[i] *= inv; }
    } else {
        let u = 1.0 / regret.len() as f32;
        for i in 0..regret.len() { out[i] = u; }
    }
}

fn terminal_util(tree: &Tree, node: usize, traverser: usize,
                 holes: &[[u8; 2]; 2], board: &[u8; 5]) -> f32 {
    let n = &tree.nodes[node];
    match n.kind {
        Kind::FoldWin(w) => {
            if w as usize == traverser { n.committed[1 - traverser] as f32 }
            else { -(n.committed[traverser] as f32) }
        }
        Kind::Showdown => {
            let mut a = [0u8; 7];
            a[..5].copy_from_slice(board);
            a[5] = holes[0][0]; a[6] = holes[0][1];
            let s0 = score(&a);
            a[5] = holes[1][0]; a[6] = holes[1][1];
            let s1 = score(&a);
            if s0 == s1 { return 0.0; }
            let winner = if s0 > s1 { 0 } else { 1 };
            if winner == traverser { n.committed[1 - traverser] as f32 }
            else { -(n.committed[traverser] as f32) }
        }
        Kind::Decision => unreachable!(),
    }
}

pub fn traverse(tree: &Tree, sv: &mut Solve, node: usize, traverser: usize,
                holes: &[[u8; 2]; 2], board: &[u8; 5], rng: &mut Rng) -> f32 {
    if tree.nodes[node].kind != Kind::Decision {
        return terminal_util(tree, node, traverser, holes, board);
    }
    let (player, street, off, nact) = {
        let n = &tree.nodes[node];
        (n.player as usize, n.street, n.off, n.acts.len())
    };
    let st = state_of(street, player, holes, board);
    let base = off + st * nact;

    let mut sigma = [0.0f32; 12];
    strategy(&sv.regret[base..base + nact], &mut sigma[..nact]);

    if player == traverser {
        let mut child = [0.0f32; 12];
        let mut util = 0.0f32;
        for a in 0..nact {
            let kid = tree.nodes[node].kids[a] as usize;
            child[a] = traverse(tree, sv, kid, traverser, holes, board, rng);
            util += sigma[a] * child[a];
        }
        for a in 0..nact {
            let r = sv.regret[base + a] + (child[a] - util);
            sv.regret[base + a] = if r > 0.0 { r } else { 0.0 };   // CFR+
        }
        sv.visits[base] += 1.0;
        util
    } else {
        // average strategy accumulates at the non-traverser's nodes
        for a in 0..nact { sv.strat[base + a] += sigma[a]; }
        sv.visits[base] += 1.0;
        let r = rng.f32();
        let mut acc = 0.0f32;
        let mut pick = nact - 1;
        for a in 0..nact {
            acc += sigma[a];
            if r < acc { pick = a; break; }
        }
        let kid = tree.nodes[node].kids[pick] as usize;
        traverse(tree, sv, kid, traverser, holes, board, rng)
    }
}

pub fn run(tree: &Tree, iters: u64, seed: u64,
           progress: &mut dyn FnMut(u64)) -> Solve {
    let mut sv = Solve::new(tree.n_slots);
    let mut rng = Rng::new(seed);
    let root = tree.root as usize;
    let step = (iters / 20).max(1);
    for i in 0..iters {
        let (h0, h1, board) = deal(&mut rng);
        let holes = [h0, h1];
        for traverser in 0..2 {
            traverse(tree, &mut sv, root, traverser, &holes, &board, &mut rng);
        }
        if (i + 1) % step == 0 { progress(i + 1); }
    }
    sv
}

/// Average strategy at one node/state, normalised. Falls back to the current
/// regret-matched strategy if the state was never reached by the sampler.
pub fn avg_strategy(tree: &Tree, sv: &Solve, node: usize, state: usize) -> Vec<f32> {
    let n = &tree.nodes[node];
    let nact = n.acts.len();
    let base = n.off + state * nact;
    let mut out = vec![0.0f32; nact];
    let mut sum = 0.0f32;
    for a in 0..nact { out[a] = sv.strat[base + a]; sum += out[a]; }
    if sum > 1e-9 {
        for a in 0..nact { out[a] /= sum; }
    } else {
        let mut tmp = vec![0.0f32; nact];
        strategy(&sv.regret[base..base + nact], &mut tmp);
        out = tmp;
    }
    out
}
