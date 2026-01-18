/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {logger} from '../utils/logger.js';

/**
 * Warning message displayed for A2A experimental features.
 */
const A2A_EXPERIMENTAL_WARNING = `
[WARNING] You are using ADK's A2A implementation which is experimental.
While the A2A protocol and SDK are stable, ADK's A2A support is still evolving.
The API may change in future releases. Please provide feedback at:
https://github.com/google/adk-js/issues
`;

/** Track if warning has been shown to avoid repeated warnings */
let warningShown = false;

/**
 * Logs a warning message for A2A experimental features.
 * The warning is only logged once per session.
 */
export function logA2aExperimentalWarning(): void {
  if (!warningShown) {
    logger.warn(A2A_EXPERIMENTAL_WARNING);
    warningShown = true;
  }
}

/**
 * Decorator for marking A2A classes/methods as experimental.
 * Logs a warning when the decorated class or method is used.
 *
 * @example
 * ```typescript
 * @a2aExperimental
 * class MyA2AConverter {
 *   // ...
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function a2aExperimental<T extends new (...args: any[]) => any>(
  target: T
): T {
  return class extends target {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      logA2aExperimentalWarning();
      super(...args);
    }
  } as T;
}

/**
 * Method decorator for marking A2A methods as experimental.
 * Logs a warning when the decorated method is called.
 */
export function a2aExperimentalMethod(
  _target: unknown,
  _propertyKey: string,
  descriptor: PropertyDescriptor
): PropertyDescriptor {
  const originalMethod = descriptor.value;
  descriptor.value = function (...args: unknown[]) {
    logA2aExperimentalWarning();
    return originalMethod.apply(this, args);
  };
  return descriptor;
}

/**
 * Resets the warning state (for testing purposes).
 */
export function resetA2aWarning(): void {
  warningShown = false;
}
