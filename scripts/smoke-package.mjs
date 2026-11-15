#!/usr/bin/env node
/**
 * Smoke-test the packed package the way consumers get it.
 *
 * Packs the package with `npm pack` (so the "files" list and "exports" map
 * are exercised), installs the tarball into a throwaway directory, and loads
 * every public entry point with both `import` (ESM) and `require` (CJS).
 * Run after `npm run build`.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(tmpdir(), 'wols-smoke-'));
const entries = ['@wemush/wols', '@wemush/wols/crypto', '@wemush/wols/qr'];

try {
  const [{ filename }] = JSON.parse(
    execFileSync('npm', ['pack', '--json', '--pack-destination', work], {
      cwd: root,
      encoding: 'utf8',
    })
  );
  const pkgDir = join(work, 'node_modules', '@wemush', 'wols');
  mkdirSync(pkgDir, { recursive: true });
  execFileSync('tar', ['-xzf', join(work, filename), '-C', pkgDir, '--strip-components=1']);

  const check = (load, name) =>
    `{ const m = ${load}(${JSON.stringify(name)}); ` +
    `if (!Object.keys(m).length) throw new Error(${JSON.stringify(`${name} exported nothing`)}); }`;
  writeFileSync(
    join(work, 'esm.mjs'),
    `${entries.map(n => check('await import', n)).join('\n')}\n` +
      `const w = await import('@wemush/wols');\nconsole.log('ESM import ok', w.WOLS_VERSION);\n`
  );
  writeFileSync(
    join(work, 'cjs.cjs'),
    `${entries.map(n => check('require', n)).join('\n')}\n` +
      `const w = require('@wemush/wols');\nconsole.log('CJS require ok', w.WOLS_VERSION);\n`
  );

  for (const file of ['esm.mjs', 'cjs.cjs']) {
    process.stdout.write(execFileSync(process.execPath, [file], { cwd: work, encoding: 'utf8' }));
  }
  console.log(`Package smoke test passed for ${entries.join(', ')} (import and require).`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
