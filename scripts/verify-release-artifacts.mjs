import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyInstallerMetadata } from './releaseMetadataPolicy.mjs';

const releaseDir = path.resolve('release');
const version = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
const required = [
  'latest.yml',
  `LogYourTime-Setup-${version}.exe`,
  `LogYourTime-Setup-${version}.exe.blockmap`,
];
const missing = required.filter((name) => !fs.existsSync(path.join(releaseDir, name)));

if (missing.length) {
  console.error(`Release incompleto. Faltan: ${missing.join(', ')}`);
  process.exit(1);
}

const metadata = fs.readFileSync(path.join(releaseDir, 'latest.yml'), 'utf8');
const installerName = `LogYourTime-Setup-${version}.exe`;
const installerBuffer = fs.readFileSync(path.join(releaseDir, installerName));
const metadataResult = verifyInstallerMetadata({
  metadata,
  version,
  installerName,
  actualSize: installerBuffer.length,
  actualSha512: crypto.createHash('sha512').update(installerBuffer).digest('base64'),
});
if (!metadataResult.valid) {
  console.error('latest.yml no corresponde con la versión o el instalador actual.');
  process.exit(1);
}

for (const name of required) {
  const size = fs.statSync(path.join(releaseDir, name)).size;
  if (size === 0) {
    console.error(`El artefacto ${name} está vacío.`);
    process.exit(1);
  }
}

console.log(`Release ${version} verificado: ${required.join(', ')}`);
