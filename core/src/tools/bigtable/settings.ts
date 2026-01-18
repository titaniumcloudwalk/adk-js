/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Configuration for Bigtable tool behavior.
 */
export interface BigtableToolSettings {
  /**
   * Maximum number of rows to return from SQL queries.
   * @default 50
   */
  maxQueryResultRows?: number;
}

/**
 * Default settings for Bigtable tools.
 */
export const DEFAULT_BIGTABLE_TOOL_SETTINGS: Required<BigtableToolSettings> = {
  maxQueryResultRows: 50,
};

/**
 * Validates and applies defaults to Bigtable tool settings.
 *
 * @param settings User-provided settings
 * @returns Settings with defaults applied
 */
export function validateBigtableToolSettings(
  settings?: BigtableToolSettings,
): Required<BigtableToolSettings> {
  return {
    maxQueryResultRows:
      settings?.maxQueryResultRows ?? DEFAULT_BIGTABLE_TOOL_SETTINGS.maxQueryResultRows,
  };
}
