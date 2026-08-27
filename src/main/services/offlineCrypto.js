import crypto from 'node:crypto';

const MAGIC = Buffer.from('LYTQ1');
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function isEncryptedBuffer(value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
  return buffer.length >= MAGIC.length && buffer.subarray(0, MAGIC.length).equals(MAGIC);
}

export function encryptOfflineBuffer(value, key) {
  const plaintext = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('La clave offline debe tener 32 bytes');
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([MAGIC, iv, tag, ciphertext]);
}

export function decryptOfflineBuffer(value, key) {
  const encrypted = Buffer.isBuffer(value) ? value : Buffer.from(value);
  if (!isEncryptedBuffer(encrypted)) {
    throw new Error('El archivo no usa el formato cifrado de LogYourTime');
  }
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('La clave offline debe tener 32 bytes');
  }

  const ivStart = MAGIC.length;
  const tagStart = ivStart + IV_LENGTH;
  const ciphertextStart = tagStart + TAG_LENGTH;
  if (encrypted.length < ciphertextStart) {
    throw new Error('Archivo offline cifrado incompleto');
  }

  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    encrypted.subarray(ivStart, tagStart),
  );
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(encrypted.subarray(tagStart, ciphertextStart));
  return Buffer.concat([
    decipher.update(encrypted.subarray(ciphertextStart)),
    decipher.final(),
  ]);
}
