//! 36-card short deck: cards and hand evaluation.
//!
//! Ranking (locked in SPEC.md, Triton standard):
//!   Straight Flush > Quads > FLUSH > Full House > Straight > Trips > 2P > Pair > High
//! Ace plays low: A-6-7-8-9 is a straight.
//!
//! Card = rank*4 + suit.  rank 0..8 = 6,7,8,9,T,J,Q,K,A.  suit 0..3 = c,d,h,s.
//! This is a direct port of tools/evaluator.py, which is verified against an exhaustive
//! census of all 376,992 five-card hands. `verify()` re-runs that census here.

pub const NCARD: usize = 36;
pub const NRANK: usize = 9;

pub const HIGH: u32 = 0;
pub const PAIR: u32 = 1;
pub const TWOPAIR: u32 = 2;
pub const TRIPS: u32 = 3;
pub const STRAIGHT: u32 = 4;
pub const BOAT: u32 = 5;
pub const FLUSH: u32 = 6;
pub const QUADS: u32 = 7;
pub const SF: u32 = 8;

pub const CAT_NAME: [&str; 9] = [
    "high card", "one pair", "two pair", "three of a kind", "straight",
    "full house", "flush", "four of a kind", "straight flush",
];

pub const RANK_CH: [u8; 9] = [b'6', b'7', b'8', b'9', b'T', b'J', b'Q', b'K', b'A'];
pub const SUIT_CH: [u8; 4] = [b'c', b'd', b'h', b's'];

#[inline(always)]
pub fn rank_of(c: u8) -> usize { (c >> 2) as usize }
#[inline(always)]
pub fn suit_of(c: u8) -> usize { (c & 3) as usize }

pub fn card_str(c: u8) -> String {
    format!("{}{}", RANK_CH[rank_of(c)] as char, SUIT_CH[suit_of(c)] as char)
}

/// (mask, high-card index). Wheel A-6-7-8-9 is 9-high, so index 3. Best first.
pub const STRAIGHTS: [(u32, u32); 6] = [
    (0b111110000, 8), // T J Q K A
    (0b011111000, 7), // 9 T J Q K
    (0b001111100, 6), // 8 9 T J Q
    (0b000111110, 5), // 7 8 9 T J
    (0b000011111, 4), // 6 7 8 9 T
    (0b100001111, 3), // A 6 7 8 9   (the wheel)
];

#[inline]
pub fn straight_high(mask: u32) -> i32 {
    for (m, hi) in STRAIGHTS.iter() {
        if mask & m == *m { return *hi as i32; }
    }
    -1
}

/// Higher is better. Accepts 5..7 cards.
pub fn score(cards: &[u8]) -> u32 {
    let mut rc = [0u8; NRANK];
    let mut sm = [0u32; 4];
    let mut sc = [0u8; 4];
    let mut mask = 0u32;
    for &c in cards {
        let r = rank_of(c);
        let s = suit_of(c);
        rc[r] += 1;
        sm[s] |= 1 << r;
        sc[s] += 1;
        mask |= 1 << r;
    }

    // flush / straight flush
    let mut fs = usize::MAX;
    for s in 0..4 { if sc[s] >= 5 { fs = s; break; } }
    if fs != usize::MAX {
        let fm = sm[fs];
        let sfh = straight_high(fm);
        if sfh >= 0 { return (SF << 20) | sfh as u32; }
        let mut v = 0u32;
        let mut n = 0;
        for r in (0..NRANK).rev() {
            if fm >> r & 1 == 1 { v = (v << 4) | r as u32; n += 1; if n == 5 { break; } }
        }
        return (FLUSH << 20) | v;
    }

    let mut quad = -1i32;
    let (mut t1, mut t2, mut p1, mut p2) = (-1i32, -1i32, -1i32, -1i32);
    for r in (0..NRANK).rev() {
        match rc[r] {
            4 => if quad < 0 { quad = r as i32 },
            3 => if t1 < 0 { t1 = r as i32 } else if t2 < 0 { t2 = r as i32 },
            2 => if p1 < 0 { p1 = r as i32 } else if p2 < 0 { p2 = r as i32 },
            _ => {}
        }
    }

    if quad >= 0 {
        let mut k = 0u32;
        for r in (0..NRANK).rev() { if rc[r] > 0 && r as i32 != quad { k = r as u32; break; } }
        return (QUADS << 20) | ((quad as u32) << 4) | k;
    }
    if t1 >= 0 && (p1 >= 0 || t2 >= 0) {
        let p = if p1 > t2 { p1 } else { t2 };
        return (BOAT << 20) | ((t1 as u32) << 4) | p as u32;
    }
    let sh = straight_high(mask);
    if sh >= 0 { return (STRAIGHT << 20) | sh as u32; }
    if t1 >= 0 {
        let mut k = [0u32; 2];
        let mut n = 0;
        for r in (0..NRANK).rev() {
            if rc[r] > 0 && r as i32 != t1 { k[n] = r as u32; n += 1; if n == 2 { break; } }
        }
        return (TRIPS << 20) | ((t1 as u32) << 8) | (k[0] << 4) | k[1];
    }
    if p1 >= 0 && p2 >= 0 {
        let mut k = 0u32;
        for r in (0..NRANK).rev() {
            if rc[r] > 0 && r as i32 != p1 && r as i32 != p2 { k = r as u32; break; }
        }
        return (TWOPAIR << 20) | ((p1 as u32) << 8) | ((p2 as u32) << 4) | k;
    }
    if p1 >= 0 {
        let mut v = 0u32;
        let mut n = 0;
        for r in (0..NRANK).rev() {
            if rc[r] > 0 && r as i32 != p1 { v = (v << 4) | r as u32; n += 1; if n == 3 { break; } }
        }
        return (PAIR << 20) | ((p1 as u32) << 12) | v;
    }
    let mut v = 0u32;
    let mut n = 0;
    for r in (0..NRANK).rev() {
        if rc[r] > 0 { v = (v << 4) | r as u32; n += 1; if n == 5 { break; } }
    }
    (HIGH << 20) | v
}

#[inline(always)]
pub fn category(cards: &[u8]) -> u32 { score(cards) >> 20 }

/// Exhaustive census of all C(36,5) = 376,992 hands, checked against the counts proved
/// in tools/shortdeck_math.py. Run at startup; if this fails, nothing else is trustworthy.
pub fn verify() -> Result<(), String> {
    let expect: [(u32, u64); 9] = [
        (SF, 24), (QUADS, 288), (FLUSH, 480), (BOAT, 1728), (STRAIGHT, 6120),
        (TRIPS, 16128), (TWOPAIR, 36288), (PAIR, 193536), (HIGH, 122400),
    ];
    let mut got = [0u64; 9];
    let mut total = 0u64;
    let mut h = [0u8; 5];
    for a in 0..NCARD { for b in (a + 1)..NCARD { for c in (b + 1)..NCARD {
        for d in (c + 1)..NCARD { for e in (d + 1)..NCARD {
            h[0] = a as u8; h[1] = b as u8; h[2] = c as u8; h[3] = d as u8; h[4] = e as u8;
            got[category(&h) as usize] += 1;
            total += 1;
        }}}}}
    if total != 376_992 { return Err(format!("enumerated {} hands, expected 376992", total)); }
    for (cat, want) in expect.iter() {
        if got[*cat as usize] != *want {
            return Err(format!("{}: got {}, expected {}",
                               CAT_NAME[*cat as usize], got[*cat as usize], want));
        }
    }
    // the two rules that define short deck
    let flush = [0u8, 4, 12, 20, 28];                    // 6c 7c 9c J c K c -> a flush
    let boat  = [8u8, 9, 10, 0, 1];                      // 8 8 8 6 6 -> a full house
    if score(&flush) <= score(&boat) { return Err("flush must beat a full house".into()); }
    let straight = [0u8, 5, 10, 15, 16];                 // 6 7 8 9 T
    let trips    = [8u8, 9, 10, 0, 5];                   // 8 8 8 x y
    if score(&straight) <= score(&trips) { return Err("straight must beat trips".into()); }
    Ok(())
}

/// xorshift RNG - deterministic per seed, no dependencies.
pub struct Rng(pub u64);
impl Rng {
    pub fn new(seed: u64) -> Self { Rng(seed | 1) }
    #[inline(always)]
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x << 13; x ^= x >> 7; x ^= x << 17;
        self.0 = x; x
    }
    #[inline(always)]
    pub fn below(&mut self, n: usize) -> usize { (self.next_u64() % n as u64) as usize }
    #[inline(always)]
    pub fn f32(&mut self) -> f32 { (self.next_u64() >> 40) as f32 / (1u32 << 24) as f32 }
}

/// Deal 4 hole cards + 5 board cards without replacement.
pub fn deal(rng: &mut Rng) -> ([u8; 2], [u8; 2], [u8; 5]) {
    let mut deck = [0u8; NCARD];
    for i in 0..NCARD { deck[i] = i as u8; }
    for i in 0..9 {
        let j = i + rng.below(NCARD - i);
        deck.swap(i, j);
    }
    ([deck[0], deck[1]], [deck[2], deck[3]],
     [deck[4], deck[5], deck[6], deck[7], deck[8]])
}
