//! Card abstraction.
//!
//! Postflop hands are grouped into buckets. The grouping is HAND-CRAFTED and
//! POTENTIAL-AWARE rather than learned by k-means, for two reasons:
//!   1. Draws are represented explicitly, so a flush draw and a middle pair with the same
//!      raw equity never collapse into the same bucket - which is the exact failure the
//!      "potential-aware" requirement in SPEC.md exists to prevent.
//!   2. Every bucket has a NAME. That is what makes the Strategy tab possible: the solver
//!      can say "top pair, no draw, on a two-tone board" instead of "cluster 47".
//!
//! bucket = category(9) x strength(4) x flush-draw(2) x straight-draw(3) = 216
//! texture = suit pattern(3) x paired(2) = 6
//! Preflop is NOT bucketed: all 81 starting-hand classes are kept exactly.

use crate::cards::*;

pub const N_BUCKET: usize = 216;
pub const N_TEXTURE: usize = 6;
pub const N_POSTFLOP_STATE: usize = N_BUCKET * N_TEXTURE;
pub const N_PREFLOP_STATE: usize = 81;

/// Preflop hand class index, 0..80. Lossless: before a board exists the suits are
/// interchangeable, so 630 combos really are only 81 distinct situations.
/// Layout: pairs 0..8, then for each (hi,lo) pair of ranks, suited then offsuit.
pub fn preflop_class(hole: &[u8; 2]) -> usize {
    let (r1, r2) = (rank_of(hole[0]), rank_of(hole[1]));
    let suited = suit_of(hole[0]) == suit_of(hole[1]);
    let (hi, lo) = if r1 >= r2 { (r1, r2) } else { (r2, r1) };
    if hi == lo { return hi; }
    // index of the unordered rank pair (hi>lo) in a fixed order
    let mut k = 0usize;
    for a in 1..NRANK { for b in 0..a {
        if a == hi && b == lo { return 9 + 2 * k + if suited { 0 } else { 1 }; }
        k += 1;
    }}
    unreachable!()
}

pub fn preflop_class_name(idx: usize) -> String {
    if idx < 9 {
        let c = RANK_CH[idx] as char;
        return format!("{}{}", c, c);
    }
    let j = idx - 9;
    let (pair_idx, suited) = (j / 2, j % 2 == 0);
    let mut k = 0usize;
    for a in 1..NRANK { for b in 0..a {
        if k == pair_idx {
            return format!("{}{}{}", RANK_CH[a] as char, RANK_CH[b] as char,
                           if suited { 's' } else { 'o' });
        }
        k += 1;
    }}
    unreachable!()
}

/// Board texture: how wet the board is in the two ways that matter here.
/// 0..2 = no 3-flush / three of a suit / four+ of a suit, x2 for unpaired / paired.
pub fn texture(board: &[u8]) -> usize {
    let mut sc = [0u8; 4];
    let mut rc = [0u8; NRANK];
    for &c in board { sc[suit_of(c)] += 1; rc[rank_of(c)] += 1; }
    let maxs = *sc.iter().max().unwrap();
    let suitcat = if maxs >= 4 { 2 } else if maxs == 3 { 1 } else { 0 };
    let paired = if rc.iter().any(|&n| n >= 2) { 1 } else { 0 };
    suitcat * 2 + paired
}

pub fn texture_name(t: usize) -> &'static str {
    match t {
        0 => "rainbow-ish, unpaired",
        1 => "rainbow-ish, paired",
        2 => "three of a suit, unpaired",
        3 => "three of a suit, paired",
        4 => "four+ of a suit, unpaired",
        5 => "four+ of a suit, paired",
        _ => "?",
    }
}

/// How many distinct ranks would complete a straight for this holding.
/// 0 = none, 1 = gutshot (one rank), 2 = open-ended or better (two+ ranks).
fn straight_draw(all_mask: u32) -> usize {
    let mut outs = 0u32;
    for (m, _) in STRAIGHTS.iter() {
        let have = (all_mask & m).count_ones();
        if have == 4 {
            let missing = m & !all_mask;
            outs |= missing;
        }
    }
    match outs.count_ones() { 0 => 0, 1 => 1, _ => 2 }
}

/// 1 if exactly four cards of one suit are present (a real flush DRAW, 5 outs in short
/// deck), 0 otherwise. Five of a suit is a made flush and is handled by the category.
fn flush_draw(board: &[u8], hole: &[u8; 2]) -> usize {
    let mut sc = [0u8; 4];
    for &c in board { sc[suit_of(c)] += 1; }
    for &c in hole.iter() { sc[suit_of(c)] += 1; }
    if sc.iter().any(|&n| n == 4) { 1 } else { 0 }
}

/// 0..3, meaning depends on the category. This is what separates "top pair" from
/// "third pair" without needing a separate cluster for every kicker.
fn strength_bin(hole: &[u8; 2], board: &[u8], cat: u32) -> usize {
    let board_score = score(board);
    let mut brc = [0u8; NRANK];
    for &c in board { brc[rank_of(c)] += 1; }
    let bmax = board.iter().map(|&c| rank_of(c)).max().unwrap();
    let bmin = board.iter().map(|&c| rank_of(c)).min().unwrap();

    match cat {
        HIGH => {
            let over = hole.iter().filter(|&&c| rank_of(c) > bmax).count();
            over.min(2)
        }
        PAIR => {
            // which rank is paired?
            let mut rc = brc;
            for &c in hole.iter() { rc[rank_of(c)] += 1; }
            let mut pr = 0usize;
            for r in (0..NRANK).rev() { if rc[r] == 2 { pr = r; break; } }
            if brc[pr] >= 2 { return 0; }            // the BOARD is paired, we hold air
            if pr > bmax { 3 }                        // overpair
            else if pr == bmax { 2 }                  // top pair
            else if pr > bmin { 1 }                   // middle pair
            else { 0 }                                // bottom or under pair
        }
        _ => {
            let mine = score(&[board, &hole[..]].concat());
            if mine == board_score { return 0; }      // playing the board
            if cat >= STRAIGHT { 3 }                  // straight or better, using our cards
            else if rank_of(hole[0]) == rank_of(hole[1]) && cat == TRIPS { 3 } // a set
            else { 2 }
        }
    }
}

/// Full postflop card state: texture * N_BUCKET + bucket.
pub fn postflop_state(hole: &[u8; 2], board: &[u8]) -> usize {
    let mut all = [0u8; 7];
    let n = board.len();
    all[..n].copy_from_slice(board);
    all[n] = hole[0];
    all[n + 1] = hole[1];
    let cards = &all[..n + 2];

    let cat = category(cards);
    let strength = strength_bin(hole, board, cat);

    // no draws exist once the last card is out
    let (fd, sd) = if n >= 5 || cat >= FLUSH {
        (0, 0)
    } else {
        let mut mask = 0u32;
        for &c in cards { mask |= 1 << rank_of(c); }
        (flush_draw(board, hole), straight_draw(mask))
    };

    let bucket = cat as usize * 24 + strength * 6 + fd * 3 + sd;
    texture(board) * N_BUCKET + bucket
}

pub fn bucket_name(bucket: usize) -> String {
    let cat = bucket / 24;
    let rem = bucket % 24;
    let strength = rem / 6;
    let fd = (rem % 6) / 3;
    let sd = rem % 3;
    let base = match cat as u32 {
        HIGH => match strength { 0 => "no pair, no overcard", 1 => "no pair, one overcard",
                                 _ => "no pair, two overcards" }.to_string(),
        PAIR => match strength { 0 => "bottom/under pair", 1 => "middle pair",
                                 2 => "top pair", _ => "overpair" }.to_string(),
        _ => {
            let n = CAT_NAME[cat].to_string();
            if strength == 0 { format!("{} (playing the board)", n) } else { n }
        }
    };
    let mut s = base;
    if fd == 1 { s.push_str(" + flush draw"); }
    match sd { 1 => s.push_str(" + gutshot"), 2 => s.push_str(" + open-ender"), _ => {} }
    s
}
