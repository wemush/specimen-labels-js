/**
 * @wemush/wols - Official WOLS TypeScript Library
 *
 * WeMush Open Labeling Standard (WOLS) v1.4.0 implementation
 * for biological specimen labeling and traceability.
 *
 * @packageDocumentation
 * @module @wemush/wols
 * @version 1.4.0
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
  ParseOptions,

  // Result types
  ParseResult,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ValidationOptions,

  // ID Validation (v1.2.0)
  IdValidationMode,
  IdValidator,

  // WOLS 1.5.0 data model
  Quantity,
  Taxon,
  TaxonIdentifier,
  TaxonIdentifierScheme,
  TaxonRank,
  HybridParent,
  SpecimenForm,
  Condition,
  Container,
  ContainerFormat,
  ParentLink,
  ParentRelation,
  // Records Bundle (v1.5.0)
  Bundle,
  SpecimenRecord,
  StrainRecord,
  Recipe,
  Observation,
  Harvest,
  Environment,
  EnvironmentRange,
  QuantityRange,
  Range,
  Location,
  CircularEconomy,
  // Compact URL types
  SpecimenRef,
  CompactUrlFailureReason,

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

  // Signature types (v1.4.0)
  SignatureStatus,
  TrustStore,
  TrustStoreEntry,
  KeySetEntry,
  KeySetOptions,
  VerificationResult,
  SigningOptions,
  SignatureForm,
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
  SPECIMEN_FORMS,
  CONDITIONS,
  CONTAINER_FORMATS,
  PARENT_RELATIONS,
  TAXON_IDENTIFIER_SCHEMES,
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
  WolsSignatureError,
  WolsCompactUrlError,
} from './errors.js';

// =============================================================================
// Core Functions - Specimen
// =============================================================================
export { createSpecimen, serializeSpecimen, PRIMORDIA_AS_TYPE_WARNING } from './specimen.js';
export { NUMERIC_GENERATION_WARNING } from './utils/generation.js';

// =============================================================================
// Core Functions - Validation
// =============================================================================
export { validateSpecimen } from './validator.js';
export { validateBundle } from './bundle.js';

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
  LEGACY_SPECIES_CODES,
  STAGE_CODES,
  COMPACT_URL_PARAMETERS,
  LEGACY_SPECIES_CODE_WARNING,
  MALFORMED_TRANSFER_DEPTH_WARNING,
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
  type FieldBinding,
  base64UrlEncode,
  base64UrlDecode,
  derivePassphraseKey,
} from './crypto/index.js';

// =============================================================================
// Signatures (v1.4.0; compact URLs v1.5.0)
// =============================================================================
export {
  signSpecimen,
  signEncryptedUrl,
  signCompactUrl,
  verifySpecimen,
  unwrapWolsUrl,
  getSigningPublicKey,
  createTrustStore,
  trustStoreFromKeySet,
  canonicalizeJson,
  SIGNING_DOMAIN,
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
