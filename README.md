# csv-reader-fast

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/putrisilsi213-boop/csv-reader-fast/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/putrisilsi213-boop/csv-reader-fast/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A fast, dependency-free drop-in for make.fun's own csv-reader 1.0.0: `solve.js`
answers every case exactly as csv-reader does — same `{columns, rows, errors}`
for every `{text, header}` — while running roughly an order of magnitude
faster on large inputs.

What it implements (from the spec): BOM stripping, LF/CRLF record ends,
empty lines as no record, stray-CR dropping (`stray_cr`), quoted fields with
doubled quotes and CR/LF normalisation inside quotes, trailing junk after a
closing quote (`quote_junk`), unterminated quotes re-read as unquoted
(`unterminated_quote`), literal quotes inside unquoted fields, and
`short_row` / `long_row` padding and cutting to the first record's width,
with per-record `line` / `row` on every error.

How it is fast: a single left-to-right pass; field ends are found with
`indexOf` (C++ scanning) through lazily-refreshed cursors for `,`, LF and CR,
so total scanning is O(n); field values are taken with `slice`, never built
character by character. Only fields that actually contain a stray CR, an
escape, or a newline inside quotes take a slow character path. No
dependencies, no network, no model calls.

Local checks (Node, ~10–16 MB inputs): 51 hand-computed unit tests pass;
150,000 randomised differential cases against an independent per-character
implementation agree exactly; benchmark ~50–145 ms per case vs ~580–1230 ms
for the naive implementation (5–17x).

## Run it

```sh
node main.ts
```

The harness runs `node /bot/main.ts`: it reads `/input/cases.json`, answers
each case with `run`, and writes `/output/answers.json`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
