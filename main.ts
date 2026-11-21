// main.ts — the program the harness runs.
// Reads every case from /input/cases.json, answers each with run() from
// solve.js, and writes /output/answers.json (one answer per case, in order).
// Written with no TypeScript-only syntax so it runs under Node's type
// stripping exactly as written.
import { setFlagsFromString } from 'node:v8';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

setFlagsFromString('--no-incremental-marking');

const { run } = await import('./solve.js');

const cases = JSON.parse(readFileSync('/input/cases.json', 'utf8'));
const answers = cases.map((c) => run(c.input));
mkdirSync('/output', { recursive: true });
writeFileSync('/output/answers.json', JSON.stringify(answers));
