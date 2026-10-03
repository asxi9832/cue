#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Rampant LLC
// Check a cartridge folder against the cue/1 spec. Usage: node scripts/validate.mjs <cartridge-folder> [...]
import { resolve } from 'node:path';
import { validateCartridge } from './lib/cartridge.mjs';

const dirs = process.argv.slice(2);
if (!dirs.length) { console.error('Usage: node scripts/validate.mjs <cartridge-folder> [...]'); process.exit(2); }
let failed = false;
for (const d of dirs) {
  const { manifest, ids = [], notes, errors, warnings } = validateCartridge(resolve(d));
  console.log(`\n${manifest?.title || d}`);
  if (ids.length) console.log(`  ${ids.length} slides, ${Object.keys(notes?.slides || {}).length} with notes`);
  warnings.forEach(w => console.log(`  ! ${w}`));
  errors.forEach(e => console.log(`  x ${e}`));
  if (errors.length) failed = true; else console.log('  OK');
}
process.exit(failed ? 1 : 0);
