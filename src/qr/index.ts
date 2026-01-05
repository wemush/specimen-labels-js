/**
 * QR Code Submodule
 *
 * This module provides QR code generation functionality for WOLS specimens.
 *
 * @packageDocumentation
 * @module @wemush/wols/qr
 */

export {
  toQRCode,
  toQRCodeDataURL,
  toQRCodeSVG,
  isQRAvailable,
  isQRAvailableSync,
} from './generate.js';
