// csv-reader-fast — a fast, dependency-free drop-in for csv-reader 1.0.0.
//
// Original implementation, written from scratch from the competition spec
// (make.fun "csv-reader-speed-01-run-20261121"). No code was copied from any
// existing CSV library; the semantics below are implemented directly from
// the spec text.
//
// Semantics implemented (input {text, header} -> {columns, rows, errors}):
// - A U+FEFF at the very start of the text is dropped.
// - A record ends at LF or CRLF; a line left with no characters is no record.
// - Outside quotes, a CR not followed by LF is dropped (error stray_cr).
// - A field that opens with a quote runs to the next quote that is not
//   doubled; "" inside it is one quote and each CRLF or lone CR inside it
//   is read as LF. What follows its closing quote, up to the next comma or
//   line break, is appended as it stands (error quote_junk, when the field
//   ends, and only when that trailing text is non-empty). A quote that never
//   closes is a literal character and the text after it is read again as
//   unquoted (error unterminated_quote).
// - A quote inside an unquoted field is a literal character.
// - Fields stay strings, never trimmed or converted.
// - columns is the first record when header is true, else null; rows holds
//   the records after it (every record when header is false), each padded
//   with empty strings (short_row, with fields: its field count) or cut
//   (long_row, with extra: the cut fields) to the first record's width.
// - Each error is {code, line, row}, in the order met; short_row / long_row
//   are emitted when their record ends. line is the 1-based line its record
//   starts on, counting every LF, CRLF and lone CR inside quotes; row is
//   its record's index in rows, null for the header.
//
// Speed strategy: one left-to-right pass. Field ends are found with
// indexOf (C++ memchr) through lazily-refreshed cursors for ',', LF and CR,
// so the total scanning is O(n) and no per-character loop runs over clean
// fields. Field values are taken with slice (no per-character concat).
// Only fields that actually contain a stray CR, an escape, or a newline
// inside quotes take a slow character path.

const COMMA = 44;
const QUOTE = 34;
const LF = 10;
const CR = 13;
const BOM = 0xfeff;

// Scan an unquoted field (or the junk after a closing quote) starting at
// `start`, dropping stray CRs (each reported) until a comma, a line break,
// or end of text. Returns [value, nextIndex, kind] with kind 0 = comma,
// 1 = line break, 2 = end of text.
function slowField(text, start, n, errLine, errRow, errors) {
  let seg = start;
  const parts = [];
  let p = start;
  let kind;
  for (;;) {
    if (p >= n) { kind = 2; break; }
    const c = text.charCodeAt(p);
    if (c === COMMA) { kind = 0; break; }
    if (c === LF) { kind = 1; break; }
    if (c === CR) {
      if (p + 1 < n && text.charCodeAt(p + 1) === LF) { kind = 1; break; }
      errors.push({ code: 'stray_cr', line: errLine, row: errRow });
      parts.push(text.slice(seg, p));
      seg = p + 1;
      p++;
      continue;
    }
    p++;
  }
  parts.push(text.slice(seg, p));
  const value = parts.length === 1 ? parts[0] : parts.join('');
  let ni;
  if (kind === 0) ni = p + 1;
  else if (kind === 1) ni = p + (text.charCodeAt(p) === CR ? 2 : 1);
  else ni = n;
  return [value, ni, kind];
}

// Process a quoted field's content span [a, b): "" -> ", CR / CRLF -> LF.
// Returns [value, lines], where lines counts the line breaks inside the
// span (each LF, CRLF or lone CR counts once).
function quotedSpan(text, a, b) {
  const parts = [];
  let seg = a;
  let lines = 0;
  for (let p = a; p < b; p++) {
    const c = text.charCodeAt(p);
    if (c === QUOTE) {
      parts.push(text.slice(seg, p), '"');
      p++; // skip the second quote of the pair
      seg = p + 1;
    } else if (c === CR) {
      parts.push(text.slice(seg, p), '\n');
      lines++;
      if (text.charCodeAt(p + 1) === LF) p++; // CRLF counts once
      seg = p + 1;
    } else if (c === LF) {
      lines++;
    }
  }
  parts.push(text.slice(seg, b));
  return [parts.join(''), lines];
}

export function run(input) {
  const text = input.text;
  const header = !!input.header;
  const n = text.length;
  let i = 0;
  if (text.charCodeAt(0) === BOM) i = 1;

  const errors = [];
  const records = [];
  let line = 1;
  let width = -1;

  // Lazily-refreshed cursors: next ',' / LF / CR at or after the current
  // position, or -1 when there is none left (sticky: once -1 it stays -1,
  // because a later start cannot find one either). Every refresh scans
  // forward from a position past the previous hit, so total scanning is O(n).
  let cPos = text.indexOf(',', i);
  let nlPos = text.indexOf('\n', i);
  let crPos = text.indexOf('\r', i);

  // Row index of the record currently being parsed: null while it is the
  // header record, else its index in rows.
  const rowOf = () => (header ? (records.length === 0 ? null : records.length - 1) : records.length);

  outer: while (i < n) {
    // ---- record start: skip empty lines; a stray CR here belongs to the
    // record that is about to start (its start line is the current line).
    let recStartLine = line;
    for (;;) {
      if (i >= n) break outer;
      const c = text.charCodeAt(i);
      if (c === LF) { i++; line++; recStartLine = line; continue; }
      if (c === CR) {
        if (i + 1 < n && text.charCodeAt(i + 1) === LF) { i += 2; line++; recStartLine = line; continue; }
        errors.push({ code: 'stray_cr', line: recStartLine, row: rowOf() });
        i++;
        continue;
      }
      break;
    }

    const fields = [];
    let done = false;
    while (!done) {
      if (cPos !== -1 && cPos < i) cPos = text.indexOf(',', i);
      if (nlPos !== -1 && nlPos < i) nlPos = text.indexOf('\n', i);
      if (crPos !== -1 && crPos < i) crPos = text.indexOf('\r', i);

      if (i >= n) { fields.push(''); done = true; break; } // trailing comma at EOF

      let value;
      let kind; // 0 = comma, 1 = line break, 2 = end of text

      if (text.charCodeAt(i) === QUOTE) {
        // ---- field opens with a quote: find the closing quote ----
        const firstQ = text.indexOf('"', i + 1);
        let k = firstQ;
        let close = -1;
        while (k !== -1) {
          if (text.charCodeAt(k + 1) === QUOTE) k = text.indexOf('"', k + 2);
          else { close = k; break; }
        }
        if (close !== -1) {
          const hasEscapes = firstQ !== close;
          const hasNl = nlPos !== -1 && nlPos < close;
          const hasCr = crPos !== -1 && crPos < close;
          let content;
          if (!hasEscapes && !hasNl && !hasCr) {
            content = text.slice(i + 1, close);
          } else {
            const r = quotedSpan(text, i + 1, close);
            content = r[0];
            line += r[1];
          }
          // ---- junk after the closing quote, up to comma / line break / EOF ----
          const j = close + 1;
          if (cPos !== -1 && cPos < j) cPos = text.indexOf(',', j);
          if (nlPos !== -1 && nlPos < j) nlPos = text.indexOf('\n', j);
          if (crPos !== -1 && crPos < j) crPos = text.indexOf('\r', j);
          let junk;
          if (cPos !== -1 && (nlPos === -1 || cPos < nlPos)) {
            if (crPos !== -1 && crPos < cPos) {
              const r = slowField(text, j, n, recStartLine, rowOf(), errors);
              junk = r[0]; i = r[1]; kind = r[2];
            } else { junk = text.slice(j, cPos); i = cPos + 1; kind = 0; }
          } else if (nlPos !== -1) {
            let end = nlPos;
            if (end > j && text.charCodeAt(end - 1) === CR) end--;
            if (crPos !== -1 && crPos < end) {
              const r = slowField(text, j, n, recStartLine, rowOf(), errors);
              junk = r[0]; i = r[1]; kind = r[2];
            } else { junk = text.slice(j, end); i = nlPos + 1; kind = 1; }
          } else {
            if (crPos !== -1) {
              const r = slowField(text, j, n, recStartLine, rowOf(), errors);
              junk = r[0]; i = r[1]; kind = r[2];
            } else { junk = text.slice(j, n); i = n; kind = 2; }
          }
          if (junk.length > 0) {
            content = content + junk;
            errors.push({ code: 'quote_junk', line: recStartLine, row: rowOf() });
          }
          value = content;
        } else {
          // ---- quote never closes: literal, re-read as unquoted ----
          errors.push({ code: 'unterminated_quote', line: recStartLine, row: rowOf() });
        }
      }

      if (value === undefined) {
        // ---- unquoted field from i (a quote here is a literal) ----
        if (cPos !== -1 && (nlPos === -1 || cPos < nlPos)) {
          if (crPos !== -1 && crPos < cPos) {
            const r = slowField(text, i, n, recStartLine, rowOf(), errors);
            value = r[0]; i = r[1]; kind = r[2];
          } else { value = text.slice(i, cPos); i = cPos + 1; kind = 0; }
        } else if (nlPos !== -1) {
          let end = nlPos;
          if (end > i && text.charCodeAt(end - 1) === CR) end--;
          if (crPos !== -1 && crPos < end) {
            const r = slowField(text, i, n, recStartLine, rowOf(), errors);
            value = r[0]; i = r[1]; kind = r[2];
          } else { value = text.slice(i, end); i = nlPos + 1; kind = 1; }
        } else {
          if (crPos !== -1) {
            const r = slowField(text, i, n, recStartLine, rowOf(), errors);
            value = r[0]; i = r[1]; kind = r[2];
          } else { value = text.slice(i, n); i = n; kind = 2; }
        }
      }

      fields.push(value);
      if (kind === 1) { line++; done = true; }
      else if (kind === 2) { done = true; }
    }

    // ---- record finished: pad / cut to the first record's width ----
    if (records.length === 0) {
      width = fields.length;
    } else if (fields.length < width) {
      errors.push({ code: 'short_row', line: recStartLine, row: rowOf(), fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      const extra = fields.slice(width);
      fields.length = width;
      errors.push({ code: 'long_row', line: recStartLine, row: rowOf(), extra });
    }
    records.push(fields);
  }

  const columns = header && records.length > 0 ? records[0] : null;
  const rows = header ? records.slice(1) : records;
  return { columns, rows, errors };
}

export default run;
