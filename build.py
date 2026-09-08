"""Concatenates src/* into the single deployed index.html.

The site is one file on purpose: gosubay.github.io/shortdeck loads index.html and
nothing else except the data/*.json it fetches. src/ exists only so the pieces stay
editable. Run:  python build.py
"""
import os, sys, io

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")

ORDER = [
    "01-head.html",
    "02-play.html",
    "03-solver.html",
    "04-strategy.html",
    "05-rules.html",
    "@</main>",          # literal, closes the <main> opened in 02-play
    "10-core.js",
    "11-game.js",
    "12-ui.js",
]

BANNER = ("<!-- BUILT FILE - do not edit by hand.\n"
          "     Edit src/*.html and src/*.js then run:  python build.py\n"
          "     Spec: SPEC.md   Solver: solver/   Data: data/ -->\n")

def main():
    parts = []
    for name in ORDER:
        if name.startswith("@"):
            parts.append(name[1:] + "\n")
            continue
        p = os.path.join(SRC, name)
        if not os.path.exists(p):
            print(f"MISSING: {p}"); sys.exit(1)
        with io.open(p, encoding="utf-8") as f:
            parts.append(f.read())

    html = "".join(parts)
    # banner goes after the doctype line so the doctype stays first
    lines = html.split("\n")
    html = lines[0] + "\n" + BANNER + "\n".join(lines[1:])

    out = os.path.join(ROOT, "index.html")
    with io.open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write(html)

    # sanity checks
    problems = []
    for tag in ("<html", "</html>", "<body>", "</body>", "<main", "</main>"):
        if html.count(tag) != 1:
            problems.append(f"{tag} appears {html.count(tag)} times, expected 1")
    if html.count("<section class=\"panel") != 4:
        problems.append("expected exactly 4 tab panels")
    if html.count("<script>") != html.count("</script>"):
        problems.append("unbalanced <script> tags")
    if problems:
        print("BUILD WARNINGS:")
        for p in problems: print("  -", p)

    kb = len(html.encode("utf-8"))/1024
    print(f"built index.html  {kb:.1f} KB  ({len(lines):,} lines)")
    if problems: sys.exit(1)

if __name__ == "__main__":
    main()
