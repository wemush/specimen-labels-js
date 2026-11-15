/**
 * WOLS Crypto Module
 *
 * AES-256-GCM encryption and decryption for specimens in the WOLS v1.3.0
 * encrypted format (`wemush://v1/encrypted/{id}?e=&iv=&kdf=...`).
 *
 * @module crypto
 */

export { encryptSpecimen, isEncrypted, toEncryptedUrl } from './encrypt.js';
export {
  decryptSpecimen,
  decryptPlaintext,
  decryptField,
  decryptFields,
  parseEncryptedUrl,
} from './decrypt.js';
export { base64UrlEncode, base64UrlDecode, derivePassphraseKey } from './shared.js';
