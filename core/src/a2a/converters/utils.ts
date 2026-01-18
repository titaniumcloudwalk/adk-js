/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Utility functions for A2A conversion operations.
 */

/** Prefix for ADK-specific metadata keys in A2A events/parts */
export const ADK_METADATA_KEY_PREFIX = 'adk_';

/** Prefix for ADK context IDs */
export const ADK_CONTEXT_ID_PREFIX = 'ADK';

/** Separator used in ADK context IDs */
export const ADK_CONTEXT_ID_SEPARATOR = '/';

/**
 * Gets the A2A event metadata key with the ADK prefix.
 *
 * @param key - The metadata key to prefix.
 * @returns The prefixed metadata key.
 * @throws Error if key is empty or undefined.
 */
export function getAdkMetadataKey(key: string): string {
  if (!key) {
    throw new Error('Metadata key cannot be empty or undefined');
  }
  return `${ADK_METADATA_KEY_PREFIX}${key}`;
}

/**
 * Converts app name, user id and session id to an A2A context id.
 *
 * @param appName - The app name.
 * @param userId - The user id.
 * @param sessionId - The session id.
 * @returns The A2A context id.
 * @throws Error if any of the input parameters are empty or undefined.
 */
export function toA2aContextId(
  appName: string,
  userId: string,
  sessionId: string
): string {
  if (!appName || !userId || !sessionId) {
    throw new Error(
      'All parameters (appName, userId, sessionId) must be non-empty'
    );
  }
  return [ADK_CONTEXT_ID_PREFIX, appName, userId, sessionId].join(
    ADK_CONTEXT_ID_SEPARATOR
  );
}

/**
 * Result of parsing an A2A context ID.
 */
export interface ParsedContextId {
  appName: string | undefined;
  userId: string | undefined;
  sessionId: string | undefined;
}

/**
 * Converts an A2A context id to app name, user id and session id.
 * If contextId is undefined or not in the expected format, returns all undefined values.
 *
 * @param contextId - The A2A context id.
 * @returns The parsed context with appName, userId, and sessionId.
 */
export function fromA2aContextId(
  contextId: string | undefined | null
): ParsedContextId {
  if (!contextId) {
    return {appName: undefined, userId: undefined, sessionId: undefined};
  }

  try {
    const parts = contextId.split(ADK_CONTEXT_ID_SEPARATOR);
    if (parts.length !== 4) {
      return {appName: undefined, userId: undefined, sessionId: undefined};
    }

    const [prefix, appName, userId, sessionId] = parts;
    if (
      prefix === ADK_CONTEXT_ID_PREFIX &&
      appName &&
      userId &&
      sessionId
    ) {
      return {appName, userId, sessionId};
    }
  } catch {
    // Handle any split errors gracefully
  }

  return {appName: undefined, userId: undefined, sessionId: undefined};
}
