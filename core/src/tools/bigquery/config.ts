/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Write mode for BigQuery operations.
 *
 * Controls what types of queries the execute_sql tool can perform.
 */
export enum WriteMode {
  /**
   * Read-only mode. Only SELECT queries are allowed.
   * Any write operations will be rejected.
   */
  BLOCKED = 'BLOCKED',

  /**
   * Protected mode. Allows creating temporary tables and models
   * within BigQuery sessions. Write operations are limited to
   * session-scoped temporary resources.
   */
  PROTECTED = 'PROTECTED',

  /**
   * Full access mode. All BigQuery operations are allowed,
   * including writes to permanent tables.
   */
  ALLOWED = 'ALLOWED',
}

/**
 * Configuration options for BigQuery tools.
 */
export interface BigQueryToolConfig {
  /**
   * Controls what types of write operations are permitted.
   * @default WriteMode.BLOCKED
   */
  writeMode?: WriteMode;

  /**
   * Maximum bytes billed for each query.
   * Must be at least 10,485,760 (10 MB) if specified.
   * Setting this helps prevent expensive queries from running.
   */
  maximumBytesBilled?: number;

  /**
   * Maximum number of rows to return from query results.
   * @default 50
   */
  maxQueryResultRows?: number;

  /**
   * Application name added to user agent and job labels.
   * Cannot contain spaces.
   */
  applicationName?: string;

  /**
   * Project ID to use for compute operations (query execution).
   * If not specified, the project from credentials will be used.
   */
  computeProjectId?: string;

  /**
   * BigQuery location for query execution.
   * If not specified, BigQuery will auto-determine based on the dataset.
   */
  location?: string;

  /**
   * Labels to apply to all BigQuery jobs.
   * Keys cannot be empty strings.
   */
  jobLabels?: Record<string, string>;
}

/**
 * Minimum value for maximumBytesBilled (10 MB).
 */
export const MINIMUM_BYTES_BILLED = 10485760;

/**
 * Validates BigQueryToolConfig and returns a normalized config with defaults.
 *
 * @param config The configuration to validate
 * @returns Validated and normalized configuration
 * @throws Error if configuration is invalid
 */
export function validateBigQueryToolConfig(
  config?: BigQueryToolConfig,
): Required<
  Pick<BigQueryToolConfig, 'writeMode' | 'maxQueryResultRows'>
> &
  BigQueryToolConfig {
  const normalized = {
    writeMode: config?.writeMode ?? WriteMode.BLOCKED,
    maxQueryResultRows: config?.maxQueryResultRows ?? 50,
    maximumBytesBilled: config?.maximumBytesBilled,
    applicationName: config?.applicationName,
    computeProjectId: config?.computeProjectId,
    location: config?.location,
    jobLabels: config?.jobLabels,
  };

  // Validate maximumBytesBilled
  if (
    normalized.maximumBytesBilled !== undefined &&
    normalized.maximumBytesBilled < MINIMUM_BYTES_BILLED
  ) {
    throw new Error(
      `maximumBytesBilled must be at least ${MINIMUM_BYTES_BILLED} bytes (10 MB), ` +
        `got ${normalized.maximumBytesBilled}`,
    );
  }

  // Validate applicationName (no spaces)
  if (normalized.applicationName && normalized.applicationName.includes(' ')) {
    throw new Error(
      `applicationName cannot contain spaces, got "${normalized.applicationName}"`,
    );
  }

  // Validate jobLabels (keys cannot be empty)
  if (normalized.jobLabels) {
    for (const key of Object.keys(normalized.jobLabels)) {
      if (key === '') {
        throw new Error('jobLabels keys cannot be empty strings');
      }
    }
  }

  return normalized;
}
