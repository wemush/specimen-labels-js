#!/usr/bin/env node
/**
 * Mark dist/cjs as CommonJS.
 *
 * The package root sets "type": "module", so without this file Node treats
 * dist/cjs/*.js (and the .d.ts files next to them) as ES modules and
 * require('@wemush/wols') fails. Run after `tsc -p tsconfig.cjs.json`.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cjsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cjs');
mkdirSync(cjsDir, { recursive: true });
writeFileSync(join(cjsDir, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);
console.log('Wrote dist/cjs/package.json ({"type":"commonjs"})');
