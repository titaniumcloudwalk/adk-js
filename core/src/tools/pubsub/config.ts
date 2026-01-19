/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Configuration for Pub/Sub tool behavior.
 *
 * @experimental This feature is experimental and may change in future versions.
 */
export interface PubSubToolConfig {
  /**
   * Google Cloud project ID for Pub/Sub operations.
   * If not specified, will be inferred from credentials or environment.
   */
  projectId?: string;
}

/**
 * Validates and normalizes PubSub tool configuration.
 *
 * @param config User-provided configuration
 * @returns Validated configuration with defaults applied
 */
export function validatePubSubToolConfig(
  config?: PubSubToolConfig,
): PubSubToolConfig {
  return {
    projectId: config?.projectId,
  };
}
