import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

interface Finding {
  file: string;
  line: number;
  rule: string;
  snippet: string;
}

const ROOT = process.cwd();
const SRC_DIR = join(ROOT, 'src');

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTsFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const RULES: Array<{ name: string; pattern: RegExp; excludeTests?: boolean }> = [
  { name: 'no-window-alert', pattern: /\bwindow\.alert\s*\(/ },
  { name: 'no-window-confirm', pattern: /\bwindow\.confirm\s*\(/ },
  { name: 'no-window-prompt', pattern: /\bwindow\.prompt\s*\(/ },
  { name: 'no-window-open', pattern: /\bwindow\.open\s*\(/ },
  { name: 'no-eval', pattern: /\beval\s*\(/ },
  { name: 'no-new-function', pattern: /\bnew\s+Function\s*\(/ },
  { name: 'no-console-log', pattern: /\bconsole\.log\s*\(/, excludeTests: true },
];

const files = walkTsFiles(SRC_DIR);
const findings: Finding[] = [];

for (const file of files) {
  const rel = relative(ROOT, file);
  const isTest = /\.test\.(ts|tsx)$/.test(file);
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);

  lines.forEach((lineText, idx) => {
    const trimmed = lineText.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
    for (const rule of RULES) {
      if (rule.excludeTests && isTest) continue;
      if (rule.pattern.test(lineText)) {
        findings.push({
          file: rel,
          line: idx + 1,
          rule: rule.name,
          snippet: trimmed.slice(0, 120),
        });
      }
    }
  });
}

if (findings.length > 0) {
  console.error(`Static check failed with ${findings.length} violation(s):`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line} [${f.rule}] ${f.snippet}`);
  }
  process.exit(1);
}

console.log(`Static check passed across ${files.length} TypeScript source files.`);
