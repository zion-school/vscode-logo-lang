import * as fs from 'fs';
import * as path from 'path';
import { analyzeSource } from '../diagnostics';

function gatherLogoFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      results.push(...gatherLogoFiles(full));
    } else if (e.isFile() && e.name.endsWith('.logo')) {
      results.push(full);
    }
  }
  return results;
}

(async () => {
  console.log('🧪 Running diagnostics on examples...');
  const examplesDir = path.resolve(__dirname, '../../examples');
  const files = gatherLogoFiles(examplesDir);

  let totalErrors = 0;
  let totalWarnings = 0;

  for (const filePath of files) {
    const src = fs.readFileSync(filePath, 'utf8');
    const diags = analyzeSource(src);
    const errs = diags.filter(d => d.severity === 'error');
    const warns = diags.filter(d => d.severity === 'warning');

    if (errs.length === 0 && warns.length === 0) {
      console.log('✅', path.relative(process.cwd(), filePath), '— clean');
    } else {
      console.log('⚠️', path.relative(process.cwd(), filePath), `— ${errs.length} error(s), ${warns.length} warning(s)`);
      for (const e of errs) {
        console.log(`  [E] Line ${e.line + 1}:${e.startChar + 1} ${e.message}`);
      }
      for (const w of warns) {
        console.log(`  [W] Line ${w.line + 1}:${w.startChar + 1} ${w.message}`);
      }
    }

    totalErrors += errs.length;
    totalWarnings += warns.length;
  }

  console.log('\nSummary:');
  console.log(`  Total examples scanned: ${files.length}`);
  console.log(`  Total errors: ${totalErrors}`);
  console.log(`  Total warnings: ${totalWarnings}`);

  if (totalErrors > 0) {
    console.error('❌ Diagnostics found errors in examples — please fix them');
    process.exit(1);
  }

  console.log('🎉 All example files have no diagnostics errors');
  process.exit(0);
})();