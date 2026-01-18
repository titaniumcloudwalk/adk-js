/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Configuration for Bigtable credentials.
 *
 * Extends the base Google credentials configuration pattern with
 * Bigtable-specific defaults.
 */
export interface BigtableCredentialsConfig {
  /**
   * Google Cloud project ID.
   * If not specified, it will be inferred from Application Default Credentials.
   */
  projectId?: string;

  /**
   * OAuth scopes for Bigtable API access.
   * @default ['https://www.googleapis.com/auth/bigtable.admin', 'https://www.googleapis.com/auth/bigtable.data']
   */
  scopes?: string[];
}

/**
 * Default OAuth scope for Bigtable Admin API.
 */
export const DEFAULT_BIGTABLE_ADMIN_SCOPE =
  'https://www.googleapis.com/auth/bigtable.admin';

/**
 * Default OAuth scope for Bigtable Data API.
 */
export const DEFAULT_BIGTABLE_DATA_SCOPE =
  'https://www.googleapis.com/auth/bigtable.data';

/**
 * Returns the scopes to use for Bigtable authentication.
 *
 * @param config Credentials configuration
 * @returns Array of OAuth scopes
 */
export function getBigtableScopes(config?: BigtableCredentialsConfig): string[] {
  return config?.scopes ?? [DEFAULT_BIGTABLE_ADMIN_SCOPE, DEFAULT_BIGTABLE_DATA_SCOPE];
}
