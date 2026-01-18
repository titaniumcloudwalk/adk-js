/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Error thrown when attempting to create a resource that already exists.
 */
export class AlreadyExistsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlreadyExistsError';
    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AlreadyExistsError);
    }
  }
}
