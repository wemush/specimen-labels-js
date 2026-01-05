/**
 * @wemush/wols - Official WOLS TypeScript Library
 *
 * WeMush Open Labeling Standard (WOLS) v1.1.0 implementation
 * for biological specimen labeling and traceability.
 *
 * @packageDocumentation
 * @module @wemush/wols
 * @version 1.1.0
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

  // Result types
  ParseResult,
  ValidationResult,
  ValidationError,
  ValidationWarning,
  ValidationOptions,

  // Compact URL types
  SpecimenRef,

  // QR types
  QRCodeOptions,

  // Encryption types
  EncryptionOptions,
  DecryptionOptions,
  EncryptedSpecimen,
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
// Errors
// =============================================================================
export {
  WolsErrorCode,
  WolsError,
  WolsParseError,
  WolsValidationError,
  WolsEncryptionError,
} from './errors.js';

// =============================================================================
// Core Functions - Specimen
// =============================================================================
export { createSpecimen, serializeSpecimen } from './specimen.js';

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
  SPECIES_CODES,
  getSpeciesFromCode,
  getCodeFromSpecies,
  registerSpeciesCode,
} from './compact-url.js';

// =============================================================================
// Core Functions - Encryption
// =============================================================================
export { encryptSpecimen, isEncrypted, decryptSpecimen } from './crypto/index.js';

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
