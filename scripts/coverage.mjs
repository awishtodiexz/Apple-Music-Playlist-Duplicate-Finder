import { readdir, rm, mkdir, copyFile, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';

const LINE_THRESHOLD = 90;
const BRANCH_THRESHOLD = 85;
const FILE_LINE_THRESHOLD = 90;

// Fresh state. `.cache/lcov` is keyed by the bundles we actually run below, so
// stale reports from removed test files cannot leak into the merged numbers.
for (const dir of ['.cache/tests', '.cache/covrun', '.cache/c8', 'coverage']) {
  await rm(dir, { recursive: true, force: true });
}

const files = (await readdir('tests')).filter(name => name.endsWith('.test.ts')).sort();
if (!files.length) throw new Error('No unit tests found');

await build({
  entryPoints: files.map(name => `tests/${name}`),
  outdir: '.cache/tests',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: 'inline',
});

await mkdir('.cache/covrun', { recursive: true });
const bundles = (await readdir('.cache/tests')).filter(name => name.endsWith('.js')).sort();
for (const name of bundles) {
  await copyFile(`.cache/tests/${name}`, `.cache/covrun/${name}`);
}

let failed = false;
const reports = [];
for (const name of bundles) {
  const bundle = `.cache/covrun/${name}`;
  const key = name.replace(/\.js$/, '');
  const result = spawnSync(process.execPath, [
    'node_modules/c8/bin/c8.js',
    '--clean=false',
    // The bundle is a generated *.test.js file that c8 default-excludes before
    // remapping. Include it and let c8 apply the excludes to the source-mapped
    // paths instead, so only real src/ files end up in the lcov report.
    '--exclude-after-remap',
    `--temp-directory=.cache/c8/${key}`,
    `--reports-dir=.cache/lcov/${key}`,
    '--reporter=lcov',
    process.execPath,
    bundle,
  ], { encoding: 'utf8' });

  if (result.error || result.status !== 0) {
    failed = true;
    console.log(`FAIL ${key} (exit ${result.status ?? 'spawn error'})`);
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
  } else {
    console.log(`ok   ${key}`);
  }
  reports.push(`.cache/lcov/${key}/lcov.info`);
}

// Union per-run lcov records: a line/branch is covered if any run executed it.
const lines = new Map(); // "file|line" -> count > 0 seen
const branches = new Map(); // "file|line|branch" -> taken > 0 seen
const fileNames = new Set();

function noteLine(file, line, count) {
  const key = `${file}|${line}`;
  lines.set(key, (lines.get(key) ?? false) || Number(count) > 0);
}

// c8 numbers BRDA `block`s sequentially per report, so the same source branch
// gets a different `block` in each tree-shaken bundle. Key on (line, branch),
// which is stable across runs; `block` is parsed for the record but not keyed.
// Limitation: two distinct branches on one line with the same index can collapse.
// This codebase keeps one statement per line, and the aggregate matches c8's own.
function noteBranch(file, line, branch, taken) {
  const key = `${file}|${line}|${branch}`;
  const hit = taken !== '-' && Number(taken) > 0;
  branches.set(key, (branches.get(key) ?? false) || hit);
}

for (const report of reports) {
  let text;
  try {
    text = await readFile(report, 'utf8');
  } catch {
    continue;
  }
  let file = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('SF:')) {
      const candidate = line.slice(3);
      // popup.ts is driven by the Playwright suites, not the unit suite.
      file = /^src[\\/]/.test(candidate) && !/[\\/]popup\.ts$/.test(candidate)
        ? candidate.replace(/\\/g, '/') : null;
      if (file) fileNames.add(file);
    } else if (line === 'end_of_record') {
      file = null;
    } else if (file && line.startsWith('DA:')) {
      const [num, count] = line.slice(3).split(',');
      noteLine(file, num, count);
    } else if (file && line.startsWith('BRDA:')) {
      const [num, , branch, taken] = line.slice(5).split(',');
      noteBranch(file, num, branch, taken);
    }
  }
}

function pct(covered, total) {
  return total ? (covered / total) * 100 : 0;
}

function countHits(map, file) {
  let total = 0;
  let covered = 0;
  const prefix = `${file}|`;
  for (const [key, hit] of map) {
    if (!key.startsWith(prefix)) continue;
    total += 1;
    if (hit) covered += 1;
  }
  return { covered, total };
}

const byFile = [...fileNames].sort().map(file => ({
  file,
  line: countHits(lines, file),
  branch: countHits(branches, file),
}));

// Every pure source module must be exercised by a unit test. Derive the set from
// disk so a new module cannot silently vanish from the gate; popup.ts is driven by
// the Playwright suites and is excluded above. A future purely type-only module
// emits no JS and no lcov record; exclude it explicitly rather than exempting every
// missing file.
const allSources = (await readdir('src'))
  .filter(name => name.endsWith('.ts') && name !== 'popup.ts')
  .map(name => `src/${name}`)
  .sort();
const missingSources = allSources.filter(file => !fileNames.has(file));
if (missingSources.length) {
  console.error(`\nCoverage gate failed: no coverage record for ${missingSources.join(', ')}.`);
  process.exitCode = 1;
}
const belowFileFloor = byFile.filter(row => row.line.total > 0 &&
  pct(row.line.covered, row.line.total) < FILE_LINE_THRESHOLD);
if (belowFileFloor.length) {
  console.error(`\nCoverage gate failed: per-file lines below ${FILE_LINE_THRESHOLD}% for ` +
    belowFileFloor.map(row => `${row.file} (${pct(row.line.covered, row.line.total).toFixed(2)}%)`).join(', ') + '.');
  process.exitCode = 1;
}

const totalLines = { covered: [...lines.values()].filter(Boolean).length, total: lines.size };
const totalBranches = { covered: [...branches.values()].filter(Boolean).length, total: branches.size };
const linePct = pct(totalLines.covered, totalLines.total);
const branchPct = pct(totalBranches.covered, totalBranches.total);

const pad = (value, width) => String(value).padEnd(width);
const fmt = stat => `${pct(stat.covered, stat.total).toFixed(2)}% (${stat.covered}/${stat.total})`;
console.log('\nCoverage (src only)');
console.log(`${pad('File', 28)} ${pad('Lines', 20)} Branches`);
for (const row of byFile) {
  console.log(`${pad(row.file, 28)} ${pad(fmt(row.line), 20)} ${fmt(row.branch)}`);
}
console.log(`${pad('TOTAL', 28)} ${pad(fmt(totalLines), 20)} ${fmt(totalBranches)}`);

if (failed) {
  console.error('\nCoverage failed: at least one test process exited non-zero.');
  process.exitCode = 1;
}
if (linePct < LINE_THRESHOLD || branchPct < BRANCH_THRESHOLD) {
  console.error(
    `\nCoverage gate failed: lines ${linePct.toFixed(2)}% < ${LINE_THRESHOLD}% ` +
    `or branches ${branchPct.toFixed(2)}% < ${BRANCH_THRESHOLD}%.`,
  );
  process.exitCode = 1;
}
