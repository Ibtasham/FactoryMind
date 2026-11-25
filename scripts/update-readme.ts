import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const README_PATH = path.join(ROOT, 'README.md');
const START_MARKER = '<!-- FACTORYMIND:AUTO-STATUS:START -->';
const END_MARKER = '<!-- FACTORYMIND:AUTO-STATUS:END -->';

function listMatchingFiles(dir: string, predicate: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      results.push(...listMatchingFiles(full, predicate));
    } else if (predicate(entry)) {
      results.push(full);
    }
  }
  return results;
}

function countTestCases(testFiles: string[]): number {
  let total = 0;
  for (const file of testFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const matches = src.match(/^\s*test\s*\(/gm);
    total += matches ? matches.length : 0;
  }
  return total;
}

function tryGit(args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString('utf8')
      .trim();
  } catch {
    return null;
  }
}

function main() {
  if (!fs.existsSync(README_PATH)) {
    throw new Error('README.md not found in workspace root.');
  }

  const engineFiles = listMatchingFiles(path.join(ROOT, 'src/engine'), (f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const pageFiles = listMatchingFiles(path.join(ROOT, 'src/pages'), (f) => f.endsWith('.tsx'));
  const allTests = [
    ...listMatchingFiles(path.join(ROOT, 'src'), (f) => f.endsWith('.test.ts') || f.endsWith('.test.tsx')),
    ...(fs.existsSync(path.join(ROOT, 'server.test.ts')) ? [path.join(ROOT, 'server.test.ts')] : []),
  ];
  const testCount = countTestCases(allTests);

  const sha = tryGit(['rev-parse', '--short', 'HEAD']) || 'workspace';
  const branch = tryGit(['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  const isoDate = new Date().toISOString().slice(0, 10);

  const section = [
    START_MARKER,
    `<!-- Updated by scripts/update-readme.ts on push -->`,
    '',
    '| Item | Status |',
    '| :--- | :--- |',
    `| Live Deployment | [ibtasham.github.io/FactoryMind](https://ibtasham.github.io/FactoryMind/) |`,
    `| Engineering Engines | ${engineFiles.length} TypeScript solver modules (\`src/engine/\`) |`,
    `| Workbench Modules | ${pageFiles.length} interactive views (\`src/pages/\`) |`,
    `| Automated Verification | ${testCount} unit & integration tests across ${allTests.length} suites |`,
    `| Latest Sync | \`${branch}\` @ \`${sha}\` (${isoDate}) |`,
    '',
    END_MARKER,
  ].join('\n');

  const current = fs.readFileSync(README_PATH, 'utf8');
  const startIdx = current.indexOf(START_MARKER);
  const endIdx = current.indexOf(END_MARKER);

  let updated: string;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    updated =
      current.slice(0, startIdx) +
      section +
      current.slice(endIdx + END_MARKER.length);
  } else {
    updated = `${current.trimEnd()}\n\n${section}\n`;
  }

  if (updated !== current) {
    fs.writeFileSync(README_PATH, updated, 'utf8');
    console.log(`Updated README.md (${engineFiles.length} engines, ${pageFiles.length} pages, ${testCount} tests).`);
  } else {
    console.log('README.md is already up to date.');
  }
}

main();
