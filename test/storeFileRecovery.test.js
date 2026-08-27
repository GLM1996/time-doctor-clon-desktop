import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { quarantineInvalidJsonStore } from '../src/main/services/storeFileRecovery.js';

test('valid object stores are preserved', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logyourtime-store-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'store.json');
  fs.writeFileSync(filePath, '{"token":"safe:value"}', 'utf8');
  assert.equal(quarantineInvalidJsonStore(filePath), null);
  assert.equal(fs.existsSync(filePath), true);
});

test('corrupt stores are quarantined before ElectronStore reads them', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logyourtime-store-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'store.json');
  fs.writeFileSync(filePath, 'N\u00004invalid', 'utf8');
  assert.equal(quarantineInvalidJsonStore(filePath, 456), `${filePath}.corrupt-456`);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(fs.existsSync(`${filePath}.corrupt-456`), true);
});
