/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Generates a v4 UUID (random UUID).
 * Uses crypto.randomUUID() when available, falls back to a custom implementation.
 *
 * @returns A v4 UUID string.
 */
export function v4(): string {
  // Use native crypto.randomUUID() if available (Node.js 14.17+, modern browsers)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback implementation for older environments
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r =
      (typeof crypto !== 'undefined' && crypto.getRandomValues
        ? crypto.getRandomValues(new Uint8Array(1))[0]
        : Math.random() * 256) & 15;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
