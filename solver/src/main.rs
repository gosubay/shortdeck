//! Short deck heads-up CFR solver.
//!
//!   cargo run --release                    -- full run, all 9 depths
//!   cargo run --release -- --iters 200000  -- quick smoke test
//!   cargo run --release -- --depths 50     -- one depth only
//!
//! Writes ../data/strategy.json. Parallel across stack depths (they are completely
//! independent), one thread each, so no locking anywhere.

mod cards;
mod abstraction;
mod tree;
mod cfr;

use std::fmt::Write as _;
use std::io::Write as _;
use std::time::Instant;
use abstraction::*;
use tree::{Act, Kind, Tree};

const DEPTHS: [i32; 9] = [10, 15, 20, 30, 40, 50, 65, 80, 100];

struct Args { iters: u64, depths: Vec<i32>, out: String, min_freq: f64, dump: u64 }

/// Writes sample hand/board -> card-state mappings so the browser's port of the
/// abstraction can be checked against this one card for card. If these two ever disagree,
/// the bot is reading the wrong row of the strategy and playing nonsense.
fn dump_states(n: u64) {
    let mut rng = cards::Rng::new(0xABCDEF01);
    let mut s = String::from("[\n");
    for i in 0..n {
        let (h0, _h1, b) = cards::deal(&mut rng);
        if i > 0 { s.push_str(",\n"); }
        let _ = write!(s,
            "{{\"hole\":\"{}{}\",\"board\":\"{}{}{}{}{}\",\"pf\":{},\"flop\":{},\"turn\":{},\"river\":{}}}",
            cards::card_str(h0[0]), cards::card_str(h0[1]),
            cards::card_str(b[0]), cards::card_str(b[1]), cards::card_str(b[2]),
            cards::card_str(b[3]), cards::card_str(b[4]),
            preflop_class(&h0),
            postflop_state(&h0, &b[..3]),
            postflop_state(&h0, &b[..4]),
            postflop_state(&h0, &b[..5]));
    }
    s.push_str("\n]\n");
    std::fs::create_dir_all("../data").ok();
    std::fs::write("../data/abstraction_check.json", &s).expect("write dump");
    println!("wrote ../data/abstraction_check.json ({} samples)", n);
}

fn parse_args() -> Args {
    let mut a = Args { iters: 4_000_000, depths: DEPTHS.to_vec(),
                       out: "../data/strategy.json".to_string(), min_freq: 2e-6, dump: 0 };
    let v: Vec<String> = std::env::args().skip(1).collect();
    let mut i = 0;
    while i < v.len() {
        match v[i].as_str() {
            "--iters" => { i += 1; a.iters = v[i].parse().expect("--iters N"); }
            "--depths" => { i += 1;
                a.depths = v[i].split(',').map(|x| x.trim().parse().expect("depth")).collect(); }
            "--out" => { i += 1; a.out = v[i].clone(); }
            "--min-freq" => { i += 1; a.min_freq = v[i].parse().unwrap(); }
            "--dump-states" => { i += 1; a.dump = v[i].parse().unwrap(); }
            other => { eprintln!("unknown argument: {}", other); std::process::exit(2); }
        }
        i += 1;
    }
    a
}

fn act_json(a: &Act) -> String {
    match a {
        Act::Fold => "[\"f\",0,0]".to_string(),
        Act::Check => "[\"x\",0,0]".to_string(),
        Act::Call => "[\"c\",0,0]".to_string(),
        Act::Raise { to, tag } => format!("[\"r\",{},{}]", to, tag),
    }
}

fn main() {
    let t_all = Instant::now();
    println!("Short deck HU solver");
    print!("verifying the hand evaluator (exhaustive 376,992-hand census)... ");
    std::io::stdout().flush().ok();
    match cards::verify() {
        Ok(()) => println!("OK"),
        Err(e) => { println!("FAILED\n  {}", e); std::process::exit(1); }
    }

    let args = parse_args();
    if args.dump > 0 { dump_states(args.dump); return; }
    println!("depths: {:?}", args.depths);
    println!("iterations per depth: {}", args.iters);

    // --- report tree sizes before committing to a long run ---
    let mut total_slots = 0usize;
    for d in &args.depths {
        let t = Tree::build(*d);
        let (n, dec, term, per) = t.stats();
        total_slots += t.n_slots;
        println!("  {:>3}A: {:>6} nodes ({} decision, {} terminal)  per-street {:?}  \
                  {:>10} strategy slots  {:>6.1} MB",
                 d, n, dec, term, per, t.n_slots,
                 (t.n_slots * 4 * 3) as f64 / 1e6);
    }
    println!("total memory for regrets+strategy+visits: {:.2} GB",
             (total_slots * 4 * 3) as f64 / 1e9);

    // --- solve every depth in parallel ---
    let results: Vec<(i32, Tree, cfr::Solve)> = std::thread::scope(|sc| {
        let mut handles = Vec::new();
        for (k, d) in args.depths.iter().enumerate() {
            let d = *d;
            let iters = args.iters;
            handles.push(sc.spawn(move || {
                let t0 = Instant::now();
                let tree = Tree::build(d);
                let mut last = 0u64;
                let sv = cfr::run(&tree, iters, 0x5EED_0000 + k as u64 * 7919, &mut |n| {
                    if n - last >= iters / 10 {
                        last = n;
                        println!("   [{:>3}A] {:>3}%  {:.0}s", d, n * 100 / iters,
                                 t0.elapsed().as_secs_f32());
                        std::io::stdout().flush().ok();
                    }
                });
                println!("   [{:>3}A] done in {:.0}s", d, t0.elapsed().as_secs_f32());
                (d, tree, sv)
            }));
        }
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });

    // --- export ---
    // The tree structure goes to JSON (small). The strategy itself goes to a companion
    // BINARY file: one byte per action probability. As JSON the same data runs well past
    // 100 MB at high iteration counts, which no browser should be asked to download.
    println!("exporting...");
    let min_visits = (args.iters as f64 * args.min_freq).max(4.0) as f32;
    println!("keeping states reached at least {:.0} times (1 in {:.0} hands)",
             min_visits, 1.0 / args.min_freq);

    let mut bin: Vec<u8> = Vec::with_capacity(64 << 20);
    bin.extend_from_slice(b"SDS1");
    bin.extend_from_slice(&(results.len() as u32).to_le_bytes());

    let mut out = String::with_capacity(16 << 20);
    out.push_str("{\n");
    let _ = write!(out, "\"generated\":\"{}\",\n", today());
    let _ = write!(out, "\"iterations\":{},\n", args.iters);
    let _ = write!(out, "\"engine\":\"external-sampling MCCFR with regret matching+\",\n");
    let _ = write!(out, "\"strategyFile\":\"strategy.bin\",\n");
    let _ = write!(out, "\"nBucket\":{},\"nTexture\":{},\n", N_BUCKET, N_TEXTURE);
    let _ = write!(out, "\"note\":\"Abstracted equilibrium, not exact GTO. Postflop hands are bucketed and betting subtrees are merged by pot and stacks.\",\n");

    out.push_str("\"bucketNames\":[");
    for b in 0..N_BUCKET {
        if b > 0 { out.push(','); }
        let _ = write!(out, "\"{}\"", bucket_name(b).replace('"', "'"));
    }
    out.push_str("],\n\"textureNames\":[");
    for t in 0..N_TEXTURE {
        if t > 0 { out.push(','); }
        let _ = write!(out, "\"{}\"", texture_name(t));
    }
    out.push_str("],\n\"preflopClasses\":[");
    for i in 0..N_PREFLOP_STATE {
        if i > 0 { out.push(','); }
        let _ = write!(out, "\"{}\"", preflop_class_name(i));
    }
    out.push_str("],\n\"depths\":[\n");

    let mut kept = 0u64;
    for (di, (d, tree, sv)) in results.iter().enumerate() {
        if di > 0 { out.push_str(",\n"); }
        let _ = write!(out, "{{\"depth\":{},\"root\":{},\n\"nodes\":[", d, tree.root);
        for (i, n) in tree.nodes.iter().enumerate() {
            if i > 0 { out.push(','); }
            let k = match n.kind { Kind::Decision => "D",
                                   Kind::Showdown => "S",
                                   Kind::FoldWin(w) => if w == 0 { "F0" } else { "F1" } };
            let _ = write!(out, "{{\"k\":\"{}\",\"s\":{},\"p\":{},\"st\":[{},{},{},{},{},{},{},{},{},{}],\"c\":[{},{}]",
                k, n.street, n.player,
                n.st[0], n.st[1], n.st[2], n.st[3], n.st[4], n.st[5], n.st[6], n.st[7],
                n.st[8], n.st[9],
                n.committed[0], n.committed[1]);
            if n.kind == Kind::Decision {
                out.push_str(",\"a\":[");
                for (j, a) in n.acts.iter().enumerate() {
                    if j > 0 { out.push(','); }
                    out.push_str(&act_json(a));
                }
                out.push_str("],\"kids\":[");
                for (j, kd) in n.kids.iter().enumerate() {
                    if j > 0 { out.push(','); }
                    let _ = write!(out, "{}", kd);
                }
                out.push(']');
            }
            out.push('}');
        }
        out.push_str("]}");

        // ---- binary block for this depth ----
        bin.extend_from_slice(&(*d as i32).to_le_bytes());
        for (i, n) in tree.nodes.iter().enumerate() {
            if n.kind != Kind::Decision { continue; }
            let nact = n.acts.len();
            let mut rows: Vec<(u16, Vec<u8>)> = Vec::new();
            for st in 0..n.n_states {
                let base = n.off + st * nact;
                if sv.visits[base] < min_visits { continue; }
                let s = cfr::avg_strategy(tree, sv, i, st);
                let mut bytes = Vec::with_capacity(nact);
                for a in 0..nact { bytes.push((s[a] * 255.0).round().clamp(0.0, 255.0) as u8); }
                rows.push((st as u16, bytes));
                kept += 1;
            }
            if rows.is_empty() { continue; }
            bin.extend_from_slice(&(i as u32).to_le_bytes());
            bin.extend_from_slice(&(rows.len() as u32).to_le_bytes());
            for (st, bytes) in rows {
                bin.extend_from_slice(&st.to_le_bytes());
                bin.extend_from_slice(&bytes);
            }
        }
        bin.extend_from_slice(&0xFFFF_FFFFu32.to_le_bytes());   // end of depth block
    }
    out.push_str("\n]}\n");

    if let Some(p) = std::path::Path::new(&args.out).parent() {
        std::fs::create_dir_all(p).ok();
    }
    std::fs::write(&args.out, &out).expect("write strategy.json");
    let binpath = std::path::Path::new(&args.out).with_file_name("strategy.bin");
    std::fs::write(&binpath, &bin).expect("write strategy.bin");
    println!("wrote {}  ({:.1} MB tree)", args.out, out.len() as f64 / 1e6);
    println!("wrote {}  ({:.1} MB strategy, {} rows)",
             binpath.display(), bin.len() as f64 / 1e6, kept);
    println!("total wall time {:.0}s", t_all.elapsed().as_secs_f32());
}

fn today() -> String {
    // no chrono dependency; seconds since epoch -> Y-M-D
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    let days = secs / 86400;
    let (mut y, mut d) = (1970i64, days);
    loop {
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        let n = if leap { 366 } else { 365 };
        if d < n { break; }
        d -= n; y += 1;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let ml = [31, if leap {29} else {28}, 31,30,31,30,31,31,30,31,30,31];
    let mut m = 0usize;
    while d >= ml[m] { d -= ml[m]; m += 1; }
    format!("{:04}-{:02}-{:02}", y, m + 1, d + 1)
}
