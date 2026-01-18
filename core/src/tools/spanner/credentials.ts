/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Configuration for Spanner credentials.
 *
 * Extends the base Google credentials configuration pattern with
 * Spanner-specific defaults.
 */
export interface SpannerCredentialsConfig {
  /**
   * Google Cloud project ID.
   * If not specified, it will be inferred from Application Default Credentials.
   */
  projectId?: string;

  /**
   * OAuth scopes for Spanner API access.
   * @default ['https://www.googleapis.com/auth/spanner.admin', 'https://www.googleapis.com/auth/spanner.data']
   */
  scopes?: string[];
}

/**
 * Default OAuth scope for Spanner admin API.
 */
export const DEFAULT_SPANNER_ADMIN_SCOPE =
  'https://www.googleapis.com/auth/spanner.admin';

/**
 * Default OAuth scope for Spanner data API.
 */
export const DEFAULT_SPANNER_DATA_SCOPE =
  'https://www.googleapis.com/auth/spanner.data';

/**
 * All default Spanner OAuth scopes.
 */
export const DEFAULT_SPANNER_SCOPES = [
  DEFAULT_SPANNER_ADMIN_SCOPE,
  DEFAULT_SPANNER_DATA_SCOPE,
];

/**
 * Token cache key for Spanner credentials.
 */
export const SPANNER_TOKEN_CACHE_KEY = 'spanner_token_cache';

/**
 * Returns the scopes to use for Spanner authentication.
 *
 * @param config Credentials configuration
 * @returns Array of OAuth scopes
 */
export function getSpannerScopes(config?: SpannerCredentialsConfig): string[] {
  return config?.scopes ?? DEFAULT_SPANNER_SCOPES;
}
