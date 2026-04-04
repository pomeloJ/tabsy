/**
 * Tabsy Backup Encryption Module
 *
 * Browser-side AES-256-GCM encryption with PBKDF2 key derivation.
 * Uses Web Crypto API — no server involvement.
 *
 * Encrypted file format (.tabsy):
 *   TABSY (5 bytes magic) + version (1 byte) + salt (16 bytes) + iv (12 bytes) + ciphertext+tag
 */

const MAGIC = new Uint8Array([0x54, 0x41, 0x42, 0x53, 0x59]); // "TABSY"
const FORMAT_VERSION = 0x01;
const PBKDF2_ITERATIONS = 600000;
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const HEADER_LENGTH = 5 + 1 + SALT_LENGTH + IV_LENGTH; // 34 bytes

async function deriveKey(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a JSON string with a password.
 * @param {string} jsonString - The JSON data to encrypt
 * @param {string} password - User-provided password
 * @returns {Promise<Uint8Array>} - Encrypted .tabsy binary
 */
export async function encryptBackup(jsonString, password) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const key = await deriveKey(password, salt);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(jsonString)
  );

  const result = new Uint8Array(HEADER_LENGTH + encrypted.byteLength);
  result.set(MAGIC, 0);
  result[5] = FORMAT_VERSION;
  result.set(salt, 6);
  result.set(iv, 22);
  result.set(new Uint8Array(encrypted), HEADER_LENGTH);
  return result;
}

/**
 * Decrypt a .tabsy file with a password.
 * @param {ArrayBuffer} buffer - The encrypted file contents
 * @param {string} password - User-provided password
 * @returns {Promise<string>} - Decrypted JSON string
 * @throws {Error} - If password is wrong or file is corrupted
 */
export async function decryptBackup(buffer, password) {
  const data = new Uint8Array(buffer);

  if (data.length < HEADER_LENGTH + 16) {
    throw new Error('File too small to be a valid encrypted backup');
  }

  // Verify magic bytes
  for (let i = 0; i < MAGIC.length; i++) {
    if (data[i] !== MAGIC[i]) {
      throw new Error('Not a valid .tabsy encrypted file');
    }
  }

  const version = data[5];
  if (version !== FORMAT_VERSION) {
    throw new Error(`Unsupported encryption format version: ${version}`);
  }

  const salt = data.slice(6, 22);
  const iv = data.slice(22, HEADER_LENGTH);
  const ciphertext = data.slice(HEADER_LENGTH);

  const key = await deriveKey(password, salt);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Check if a file buffer is an encrypted .tabsy file.
 * @param {ArrayBuffer} buffer
 * @returns {boolean}
 */
export function isEncryptedBackup(buffer) {
  if (buffer.byteLength < HEADER_LENGTH) return false;
  const data = new Uint8Array(buffer);
  for (let i = 0; i < MAGIC.length; i++) {
    if (data[i] !== MAGIC[i]) return false;
  }
  return true;
}

/**
 * Download data as a file.
 * @param {Uint8Array|string} data
 * @param {string} filename
 * @param {string} mimeType
 */
export function downloadFile(data, filename, mimeType = 'application/octet-stream') {
  const blob = new Blob([data], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
