/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * API Hub Tool module.
 *
 * This module provides tools for generating REST API tools from Google Cloud
 * API Hub resources. The APIHubToolset fetches OpenAPI specifications from
 * API Hub and creates corresponding tools that can be used by ADK agents.
 *
 * @example
 * ```typescript
 * import {APIHubToolset} from '@google/adk';
 *
 * // Create a toolset from API Hub resource
 * const toolset = new APIHubToolset({
 *   apihubResourceName: 'projects/my-project/locations/us-central1/apis/my-api',
 * });
 *
 * // Use with an agent
 * const agent = new LlmAgent({
 *   tools: [toolset],
 * });
 * ```
 */

export {
  APIHubToolset,
  APIHubToolsetOptions,
} from './apihub_toolset.js';

export {
  APIHubClient,
  APIHubClientOptions,
  BaseAPIHubClient,
} from './clients/apihub_client.js';
