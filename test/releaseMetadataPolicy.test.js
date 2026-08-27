import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyInstallerMetadata } from '../scripts/releaseMetadataPolicy.mjs';

const metadata = `version: 1.2.3
files:
  - url: LogYourTime-Setup-1.2.3.exe
    sha512: abc123==
    size: 42
path: LogYourTime-Setup-1.2.3.exe
sha512: abc123==
`;

test('acepta metadatos que coinciden exactamente con el instalador', () => {
  assert.deepEqual(verifyInstallerMetadata({
    metadata, version: '1.2.3', installerName: 'LogYourTime-Setup-1.2.3.exe',
    actualSize: 42, actualSha512: 'abc123==',
  }), { valid: true, errors: [] });
});

test('rechaza version, tamano o hash desincronizados', () => {
  const result = verifyInstallerMetadata({
    metadata, version: '1.2.30', installerName: 'LogYourTime-Setup-1.2.30.exe',
    actualSize: 41, actualSha512: 'different',
  });
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors, ['version', 'installer', 'size', 'sha512']);
});
