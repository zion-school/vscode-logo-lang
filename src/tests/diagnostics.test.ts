import { analyzeSource } from '../diagnostics';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
}

(async () => {
  console.log('🧪 diagnostics tests starting...');

  // Missing END
  const src1 = 'TO myproc\n  RT 10\n';
  const d1 = analyzeSource(src1);
  assert(d1.some(d => /Missing END/i.test(d.message)), 'Expected Missing END error');

  // END without TO
  const src2 = 'RT 10\nEND\n';
  const d2 = analyzeSource(src2);
  assert(d2.some(d => /END without matching TO/i.test(d.message)), 'Expected END without matching TO error');

  // Duplicate TO
  const src3 = 'TO foo\nEND\nTO foo\nEND\n';
  const d3 = analyzeSource(src3);
  assert(d3.some(d => /already defined/i.test(d.message) && d.severity === 'warning'), 'Expected duplicate procedure warning');

  // Unclosed bracket
  const src4 = 'PRINT [ 1 2\n';
  const d4 = analyzeSource(src4);
  assert(d4.some(d => /Unclosed '\['/i.test(d.message) || /Unmatched '\]'/i.test(d.message)), 'Expected unclosed bracket error');

  // Warn about unsupported command (PRINT)
  const src4b = 'PRINT 1\n';
  const d4b = analyzeSource(src4b);
  assert(d4b.some(d => /Unsupported command 'PRINT'/i.test(d.message) && d.severity === 'warning'), 'Expected unsupported command PRINT warning');

  // Unterminated string
  const src5 = 'PRINT "hello\n';
  const d5 = analyzeSource(src5);
  assert(d5.some(d => /Unterminated string/i.test(d.message)), 'Expected unterminated string error');

  // Missing parameter for FD
  const src6 = 'FD\n';
  const d6 = analyzeSource(src6);
  assert(d6.some(d => /FD.*expects.*argument/i.test(d.message) || /Missing.*parameter/i.test(d.message)), 'Expected missing parameter error for FD');



  // Missing parameter for RT
  const src9 = 'RT\n';
  const d9 = analyzeSource(src9);
  assert(d9.some(d => /RT.*expects.*argument/i.test(d.message) || /Missing.*parameter/i.test(d.message)), 'Expected missing parameter error for RT');

  // Missing parameter for LT
  const src12 = 'LT\n';
  const d12 = analyzeSource(src12);
  assert(d12.some(d => /LT.*expects.*argument/i.test(d.message) || /Missing.*parameter/i.test(d.message)), 'Expected missing parameter error for LT');

  // Missing parameter for REPEAT
  const src13 = 'REPEAT\n';
  const d13 = analyzeSource(src13);
  assert(d13.some(d => /REPEAT.*expects.*argument/i.test(d.message) || /Missing.*parameter/i.test(d.message)), 'Expected missing parameter error for REPEAT');

  // Missing parameter for SETPENCOLOR
  const src14 = 'SETPENCOLOR\n';
  const d14 = analyzeSource(src14);
  assert(d14.some(d => /SETPENCOLOR.*expects.*argument/i.test(d.message) || /Missing.*parameter/i.test(d.message)), 'Expected missing parameter error for SETPENCOLOR');


 // Valid: Simple REPEAT with single line
  const src16 = 'REPEAT 5 [ FD 50 RT 144 ]\n';
  const d16 = analyzeSource(src16);
  assert(d16.length === 0 || d16.every(d => d.severity !== 'error'), 'Expected no errors for valid single-line REPEAT');

  // Valid: REPEAT with multi-line block
  const src17 = 'REPEAT 5 [\n FD 50\n RT 144\n]\n';
  const d17 = analyzeSource(src17);
  assert(d17.length === 0 || d17.every(d => d.severity !== 'error'), 'Expected no errors for valid multi-line REPEAT');

  // Valid: Nested commands in REPEAT
  const src18 = 'REPEAT 3 [\n FD 50\n RT 60\n FD 50\n RT 60\n]\n';
  const d18 = analyzeSource(src18);
  assert(d18.length === 0 || d18.every(d => d.severity !== 'error'), 'Expected no errors for valid nested REPEAT commands');

  // Valid: Complex pattern with multiple commands
  const src19 = 'REPEAT 36 [\n  FD 5 LT 90\n  FD 5 RT 90\n  FD 5 RT 90\n  FD 5 LT 100\n]\n';
  const d19 = analyzeSource(src19);
  assert(d19.length === 0 || d19.every(d => d.severity !== 'error'), 'Expected no errors for valid complex REPEAT pattern');

  // Valid: Procedure with parameters and variables using assignment
  const src20 = `TO CIRCLE :RADIUS
  :STEPS = 36
  :ANGLE = 360 / :STEPS
  :SIDE = 2 * 3.14159 * :RADIUS / :STEPS
  REPEAT :STEPS [
    FD :SIDE
    RT :ANGLE
  ]
END
`;
  const d20 = analyzeSource(src20);
  assert(d20.length === 0 || d20.every(d => d.severity !== 'error'), 'Expected no errors for valid procedure with variable assignments');

  // Valid: Variable references with colon prefix
  const src21 = 'TO TEST :X\n  FD :X\n  RT :X\nEND\n';
  const d21 = analyzeSource(src21);
  assert(d21.length === 0 || d21.every(d => d.severity !== 'error'), 'Expected no errors for valid variable references');

  // Valid: Arithmetic expressions in variable assignment
  const src22 = 'TO TEST :N\n  :RESULT = :N * 2 + 10\n  FD :RESULT\nEND\n';
  const d22 = analyzeSource(src22);
  assert(d22.length === 0 || d22.every(d => d.severity !== 'error'), 'Expected no errors for valid arithmetic expressions');

  // Valid: Using variables in REPEAT count
  const src23 = 'TO SQUARE :SIZE\n  REPEAT 4 [ FD :SIZE RT 90 ]\nEND\n';
  const d23 = analyzeSource(src23);
  assert(d23.length === 0 || d23.every(d => d.severity !== 'error'), 'Expected no errors for valid variable in REPEAT count');

  // Invalid: REPEAT without block
  const src24 = 'REPEAT 5\n';
  const d24 = analyzeSource(src24);
  assert(d24.some(d => /REPEAT.*expects.*block/i.test(d.message) || /Missing.*\[/i.test(d.message)), 'Expected missing block error for REPEAT');

  // Invalid: REPEAT with unclosed block
  const src25 = 'REPEAT 5 [ FD 50\n';
  const d25 = analyzeSource(src25);
  assert(d25.some(d => /Unclosed '\['/i.test(d.message) || /Unmatched/i.test(d.message)), 'Expected unclosed bracket error for REPEAT block');

  // Invalid: REPEAT with no count
  const src26 = 'REPEAT [ FD 50 RT 90 ]\n';
  const d26 = analyzeSource(src26);
  assert(d26.some(d => /REPEAT.*expects.*argument/i.test(d.message) || /Missing.*parameter/i.test(d.message)), 'Expected missing count error for REPEAT');

  console.log('✅ diagnostics tests passed');
  process.exit(0);
})();