/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Configuration for BigQuery credentials.
 *
 * Extends the base Google credentials configuration pattern with
 * BigQuery-specific defaults.
 */
export interface BigQueryCredentialsConfig {
  /**
   * Google Cloud project ID.
   * If not specified, it will be inferred from Application Default Credentials.
   */
  projectId?: string;

  /**
   * OAuth scopes for BigQuery API access.
   * @default ['https://www.googleapis.com/auth/bigquery']
   */
  scopes?: string[];
}

/**
 * Default OAuth scope for BigQuery API.
 */
export const DEFAULT_BIGQUERY_SCOPE =
  'https://www.googleapis.com/auth/bigquery';

/**
 * Returns the scopes to use for BigQuery authentication.
 *
 * @param config Credentials configuration
 * @returns Array of OAuth scopes
 */
export function getBigQueryScopes(config?: BigQueryCredentialsConfig): string[] {
  return config?.scopes ?? [DEFAULT_BIGQUERY_SCOPE];
}
