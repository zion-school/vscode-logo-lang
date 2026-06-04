import { LogoRuntime } from '../logoDebugger';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (!condition) {
    console.error('FAIL:', msg);
    failed++;
  } else {
    passed++;
  }
}

async function run(source: string): Promise<LogoRuntime> {
  const rt = new LogoRuntime();
  rt.loadProgram(source);
  await rt.execute();
  return rt;
}

// ═══════════════════════════════════════════════════════════════════════
//  Tests for evalExpression: a space-before / adjacent-after '+'/'-' is a
//  unary prefix on the next argument, not a binary operator.
// ═══════════════════════════════════════════════════════════════════════

(async () => {
  console.log('🧪 negativeArgs tests starting...\n');

  // Procedure-local MAKE is wiped when the proc returns, so the tests below
  // surface received args via SETPOS so they survive in the turtle state.

  // ─── 1. Two-arg procedure, both args negative literals ──────────────
  console.log('--- 1. PROC -30 -45 → two separate args ---');
  {
    const src = [
      'TO RECORD :A :B',
      '  SETPOS [:A :B]',
      'END',
      'RECORD -30 -45',
    ].join('\n');
    const rt = await run(src);
    const t = rt.getTurtleState();
    assert(t.x === -30, `1a: A expected -30, got ${t.x}`);
    assert(t.y === -45, `1b: B expected -45, got ${t.y}`);
  }

  // ─── 2. Spaces both sides → still binary minus ──────────────────────
  console.log('--- 2. PROC :SIZE - 1 :SIGN → binary minus + var arg ---');
  {
    const src = [
      'TO RECORD :A :B',
      '  SETPOS [:A :B]',
      'END',
      'MAKE "SIZE 10',
      'MAKE "SIGN 7',
      'RECORD :SIZE - 1 :SIGN',
    ].join('\n');
    const rt = await run(src);
    const t = rt.getTurtleState();
    assert(t.x === 9, `2a: A expected 9 (10-1), got ${t.x}`);
    assert(t.y === 7, `2b: B expected 7, got ${t.y}`);
  }

  // ─── 3. SETPOS with two negative coordinate literals ────────────────
  console.log('--- 3. SETPOS [-50 -100] ---');
  {
    const rt = await run('SETPOS [-50 -100]');
    const t = rt.getTurtleState();
    assert(t.x === -50, `3a: x expected -50, got ${t.x}`);
    assert(t.y === -100, `3b: y expected -100, got ${t.y}`);
  }

  // ─── 4. SETPOS with mixed expression / variable ─────────────────────
  console.log('--- 4. SETPOS [:X*3+2 :Y] ---');
  {
    const src = [
      'MAKE "X 4',
      'MAKE "Y 7',
      'SETPOS [:X*3+2 :Y]',
    ].join('\n');
    const rt = await run(src);
    const t = rt.getTurtleState();
    assert(t.x === 14, `4a: x expected 14 (4*3+2), got ${t.x}`);
    assert(t.y === 7, `4b: y expected 7, got ${t.y}`);
  }

  // ─── 5. ARC with negative radius ────────────────────────────────────
  console.log('--- 5. ARC 30 -45 does not throw ---');
  {
    let threw = false;
    try { await run('ARC 30 -45'); } catch { threw = true; }
    assert(!threw, '5a: ARC 30 -45 should parse as two args without throwing');
  }

  // ─── 6. Greedy minus must not cross a newline ───────────────────────
  console.log('--- 6. FD must not eat -10 on the next line ---');
  {
    // Without the unary-prefix fix, "FD 50\n-10" used to be parsed as FD (50-10)=40.
    // The orphan `-10` then throws as an unknown statement; that's expected and
    // doesn't affect the assertion below — FD has already advanced the turtle.
    const src = ['FD 50', '-10'].join('\n');
    const rt = new LogoRuntime();
    rt.loadProgram(src);
    try { await rt.execute(); } catch { /* orphan `-` token throws — expected */ }
    const t = rt.getTurtleState();
    assert(Math.abs(t.y - 50) < 1e-9, `6a: y expected 50 (not 40), got ${t.y}`);
  }

  console.log(`\n════════════════════════════════════════════`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`════════════════════════════════════════════`);
  if (failed === 0) console.log('🎉 All negativeArgs tests passed');
  else process.exit(1);
})();
