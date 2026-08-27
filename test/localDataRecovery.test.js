import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  cleanupAtomicTempFiles,
  quarantineLocalPath,
} from '../src/main/services/localDataRecovery.js';

test('aparta archivos corruptos sin destruir su contenido', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyt-recovery-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'queue.bin');
  fs.writeFileSync(source, 'evidence');
  const recovered = quarantineLocalPath(source, 123);
  assert.equal(recovered, `${source}.recovery-123`);
  assert.equal(fs.existsSync(source), false);
  assert.equal(fs.readFileSync(recovered, 'utf8'), 'evidence');
});

test('no crea recuperaciones para rutas inexistentes', () => {
  assert.equal(quarantineLocalPath('missing-file', 123), null);
});

test('elimina solo temporales atomicos pertenecientes al archivo objetivo', (context) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lyt-temp-cleanup-'));
  context.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const target = path.join(directory, 'queue.json');
  const stale = `${target}.123.tmp`;
  const unrelated = path.join(directory, 'other.json.123.tmp');
  const recovery = `${target}.recovery-123`;
  fs.writeFileSync(stale, 'partial');
  fs.writeFileSync(unrelated, 'keep');
  fs.writeFileSync(recovery, 'keep');

  assert.equal(cleanupAtomicTempFiles(target), 1);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(unrelated), true);
  assert.equal(fs.existsSync(recovery), true);
});
