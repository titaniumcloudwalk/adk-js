/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Configuration for Pub/Sub credentials.
 *
 * Extends the base Google credentials configuration pattern with
 * Pub/Sub-specific defaults.
 */
export interface PubSubCredentialsConfig {
  /**
   * Google Cloud project ID.
   * If not specified, it will be inferred from Application Default Credentials.
   */
  projectId?: string;

  /**
   * OAuth scopes for Pub/Sub API access.
   * @default ['https://www.googleapis.com/auth/pubsub']
   */
  scopes?: string[];
}

/**
 * Default OAuth scope for Pub/Sub API.
 */
export const DEFAULT_PUBSUB_SCOPE = 'https://www.googleapis.com/auth/pubsub';

/**
 * Returns the scopes to use for Pub/Sub authentication.
 *
 * @param config Credentials configuration
 * @returns Array of OAuth scopes
 */
export function getPubSubScopes(config?: PubSubCredentialsConfig): string[] {
  return config?.scopes ?? [DEFAULT_PUBSUB_SCOPE];
}
