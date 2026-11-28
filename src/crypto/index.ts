/**
 * WOLS Crypto Module
 *
 * AES-256-GCM encryption and decryption for specimens in the WOLS v1.3.0
 * encrypted format (`wemush://v1/encrypted/{id}?e=&iv=&kdf=...`).
 *
 * @module crypto
 */

export {
  encryptSpecimen,
  encryptFields,
  isEncrypted,
  isEncryptedSpecimen,
  isEncryptedField,
  toEncryptedUrl,
} from './encrypt.js';
export {
  decryptSpecimen,
  decryptPlaintext,
  decryptField,
  decryptFields,
  parseEncryptedUrl,
  type FieldBinding,
} from './decrypt.js';
export { base64UrlEncode, base64UrlDecode, derivePassphraseKey } from './shared.js';
export {
  signSpecimen,
  signEncryptedUrl,
  signCompactUrl,
  verifySpecimen,
  unwrapWolsUrl,
  getSigningPublicKey,
  createTrustStore,
  trustStoreFromKeySet,
  SIGNING_DOMAIN,
} from './signature.js';
export { canonicalizeJson } from './jcs.js';
