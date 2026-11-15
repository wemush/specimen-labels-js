/**
 * @wemush/wols - Official WOLS TypeScript Library
 *
 * WeMush Open Labeling Standard (WOLS) v1.3.0 implementation
 * for biological specimen labeling and traceability.
 *
 * @packageDocumentation
 * @module @wemush/wols
 * @version 1.3.0
 */

// =============================================================================
// Constants
// =============================================================================
export { WOLS_VERSION, WOLS_CONTEXT } from './types.js';

// =============================================================================
// Types and Interfaces
// =============================================================================
export type {
  // Branded types
  Brand,
  SpecimenId,

  // Core types
  SpecimenType,
  GrowthStage,
  Strain,
  Specimen,
  SpecimenInput,
  SpecimenMeta,
  CreateSpecimenOptions,

  // Result types
  ParseResult,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ValidationOptions,

  // ID Validation (v1.2.0)
  IdValidationMode,
  IdValidator,

  // Compact URL types
  SpecimenRef,

  // QR types
  QRCodeOptions,

  // Encryption types
  EncryptionOptions,
  DecryptionOptions,
  EncryptedSpecimen,
  EncryptedField,
  EncryptionKdf,
  RawEncryptionKey,
  DecryptionFailureReason,
  DecryptResult,
  FieldEncryptedSpecimen,
  FieldEncryptionOptions,
} from './types.js';

// =============================================================================
// Type utilities
// =============================================================================
export {
  asSpecimenId,
  isSpecimenType,
  isGrowthStage,
  isStrain,
  SPECIMEN_TYPES,
  GROWTH_STAGES,
} from './types.js';

// =============================================================================
// Type Alias System (v1.2.0)
// =============================================================================
export {
  registerTypeAlias,
  resolveTypeAlias,
  getTypeAliases,
  resolveTypeAndStage,
  PRIMORDIA_TYPE_ALIAS,
} from './types.js';

// =============================================================================
// Type Mapping System (v1.2.0)
// =============================================================================
export {
  WOLS_TO_PLATFORM_MAP,
  mapToWolsType,
  mapFromWolsType,
  registerPlatformType,
} from './types.js';

// =============================================================================
// Generation Format System (v1.2.0)
// =============================================================================
export { normalizeGeneration, isValidGeneration } from './types.js';
export type { GenerationFormat } from './types.js';

// =============================================================================
// Errors
// =============================================================================
export {
  WolsErrorCode,
  WolsError,
  WolsParseError,
  WolsValidationError,
  WolsEncryptionError,
  WolsDecryptionError,
} from './errors.js';

// =============================================================================
// Core Functions - Specimen
// =============================================================================
export { createSpecimen, serializeSpecimen, PRIMORDIA_AS_TYPE_WARNING } from './specimen.js';

// =============================================================================
// Core Functions - Validation
// =============================================================================
export { validateSpecimen } from './validator.js';

// =============================================================================
// Core Functions - Parser
// =============================================================================
export { parseSpecimen } from './parser.js';

// =============================================================================
// Core Functions - Compact URL
// =============================================================================
export {
  toCompactUrl,
  parseCompactUrl,
  parseCompactUrlOrThrow,
  parseCompactUrlOrNull,
  SPECIES_CODES,
  getSpeciesFromCode,
  getCodeFromSpecies,
  registerSpeciesCode,
} from './compact-url.js';

// =============================================================================
// Core Functions - Encryption
// =============================================================================
export {
  encryptSpecimen,
  encryptFields,
  isEncrypted,
  isEncryptedSpecimen,
  isEncryptedField,
  toEncryptedUrl,
  decryptSpecimen,
  decryptPlaintext,
  decryptField,
  decryptFields,
  parseEncryptedUrl,
  base64UrlEncode,
  base64UrlDecode,
  derivePassphraseKey,
} from './crypto/index.js';

// =============================================================================
// Core Functions - QR Code Generation
// =============================================================================
export {
  toQRCode,
  toQRCodeDataURL,
  toQRCodeSVG,
  isQRAvailable,
  isQRAvailableSync,
} from './qr/index.js';

// =============================================================================
// Environment Detection (v1.2.0)
// =============================================================================
export {
  isServer,
  isBrowser,
  isWebWorker,
  isDeno,
  isBun,
  getRuntimeEnvironment,
  supportsWebCrypto,
  supportsNodeCrypto,
  isCryptoSupported,
  supportsTextEncoding,
  supportsURLAPIs,
} from './utils/environment.js';
export type { RuntimeEnvironment } from './utils/environment.js';

// =============================================================================
// Migration Utilities (v1.2.0)
// =============================================================================
export {
  compareVersions,
  isOutdated,
  isNewer,
  getCurrentVersion,
  registerMigration,
  canMigrate,
  migrate,
  getMigrations,
  clearMigrations,
} from './utils/migration.js';
export type { VersionComparison, MigrationHandler } from './utils/migration.js';
