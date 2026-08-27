import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { quarantineConfigFile, readConfigFile, writeConfigFile } from '../src/main/services/configFileRepository.js';

test('configuration is written atomically and read back', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logyourtime-config-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'last-config.json');
  writeConfigFile(filePath, { screenshots: { enabled: true } });
  assert.deepEqual(readConfigFile(filePath), { screenshots: { enabled: true } });
  assert.equal(fs.readdirSync(directory).some((name) => name.endsWith('.tmp')), false);
});

test('invalid configuration can be quarantined', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logyourtime-config-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'last-config.json');
  fs.writeFileSync(filePath, '{invalid', 'utf8');
  assert.throws(() => readConfigFile(filePath), SyntaxError);
  assert.equal(quarantineConfigFile(filePath, 123), `${filePath}.corrupt-123`);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(fs.existsSync(`${filePath}.corrupt-123`), true);
});
