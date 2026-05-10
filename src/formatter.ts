// Document formatter for Logo source files.
//
// Two-pass design:
//
//  Pass 1 — normalizeMultilineBrackets:
//    For every `[`…`]` pair that spans multiple lines, ensure the `[` is at
//    the end of its line and the matching `]` is at the start of its line.
//    Single-line pairs (e.g. `REPEAT 360 [ FD 1 RT 1 ]`, `IF :X < 1 [ STOP ]`)
//    are left untouched. This is what turns `REPEAT 5 [ FD 50 RT 72\n  FD …`
//    into a clean multi-line block.
//
//  Pass 2 — reindent:
//    Trim trailing whitespace, drop leading/duplicate blanks, and re-indent
//    each line by (bracketDepth + procedureDepth). `TO`/`END` contributes
//    one level of procedure depth.
//
// Brackets inside `;` line comments are ignored.

const INDENT_UNIT = '  ';

interface BracketPair {
  openLine: number;
  openCol: number;
  closeLine: number;
  closeCol: number;
}

function findBracketPairs(lines: string[]): BracketPair[] {
  const stack: Array<{ line: number; col: number }> = [];
  const pairs: BracketPair[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      if (ch === ';') break; // rest of line is a comment
      if (ch === '[') {
        stack.push({ line: li, col: ci });
      } else if (ch === ']') {
        const open = stack.pop();
        if (open) {
          pairs.push({
            openLine: open.line,
            openCol: open.col,
            closeLine: li,
            closeCol: ci,
          });
        }
      }
    }
  }
  return pairs;
}

function normalizeMultilineBrackets(text: string): string {
  const lines = text.split(/\r?\n/);
  const pairs = findBracketPairs(lines);

  // For each line, the set of columns where we want to inject a newline.
  const splits = new Map<number, Set<number>>();
  const addSplit = (line: number, col: number) => {
    if (!splits.has(line)) splits.set(line, new Set());
    splits.get(line)!.add(col);
  };

  for (const p of pairs) {
    if (p.openLine === p.closeLine) continue; // single-line pair: leave it alone

    // If `[` has trailing content on its line, push that content down.
    const afterOpen = lines[p.openLine].slice(p.openCol + 1);
    if (afterOpen.trim().length > 0) {
      addSplit(p.openLine, p.openCol + 1);
    }

    // If `]` has content preceding it on its line, push `]` down.
    const beforeClose = lines[p.closeLine].slice(0, p.closeCol);
    if (beforeClose.trim().length > 0) {
      addSplit(p.closeLine, p.closeCol);
    }
  }

  if (splits.size === 0) return text;

  const out: string[] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const splitSet = splits.get(li);
    if (!splitSet) {
      out.push(line);
      continue;
    }
    const cols = Array.from(splitSet).sort((a, b) => a - b);
    let prev = 0;
    for (const col of cols) {
      out.push(line.slice(prev, col));
      prev = col;
    }
    out.push(line.slice(prev));
  }
  return out.join('\n');
}

function countCodeBrackets(line: string, ch: '[' | ']'): number {
  let n = 0;
  for (const c of line) {
    if (c === ';') break;
    if (c === ch) n++;
  }
  return n;
}

function isProcedureStart(line: string): boolean {
  return /^\s*TO\b/i.test(line);
}

function isProcedureEnd(line: string): boolean {
  return /^\s*END\b\s*$/i.test(line);
}

function startsWithCloseBracket(line: string): boolean {
  return /^\s*\]/.test(line);
}

function reindent(text: string): string {
  const rawLines = text.split(/\r?\n/);
  const out: string[] = [];

  let bracketDepth = 0;
  let procDepth = 0;
  let lastWasBlank = true; // drops leading blank lines

  for (const raw of rawLines) {
    const stripped = raw.replace(/\s+$/, '').trim();

    if (stripped === '') {
      if (!lastWasBlank) out.push('');
      lastWasBlank = true;
      continue;
    }

    if (isProcedureEnd(stripped) && procDepth > 0) procDepth--;

    const leadingClose = startsWithCloseBracket(stripped);
    const printDepth = bracketDepth + procDepth - (leadingClose ? 1 : 0);
    out.push(INDENT_UNIT.repeat(Math.max(0, printDepth)) + stripped);
    lastWasBlank = false;

    const opens = countCodeBrackets(stripped, '[');
    const closes = countCodeBrackets(stripped, ']');
    bracketDepth = Math.max(0, bracketDepth + opens - closes);

    if (isProcedureStart(stripped)) procDepth++;
  }

  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n') + '\n';
}

export function formatLogoDocument(text: string): string {
  return reindent(normalizeMultilineBrackets(text));
}
