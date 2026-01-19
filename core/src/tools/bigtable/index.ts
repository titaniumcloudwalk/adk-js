/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Bigtable toolset for Google Cloud Bigtable operations.
 *
 * @module bigtable
 */

export {BigtableToolset} from './bigtable_toolset.js';
export type {BigtableToolsetOptions} from './bigtable_toolset.js';

export {
  DEFAULT_BIGTABLE_ADMIN_SCOPE,
  DEFAULT_BIGTABLE_DATA_SCOPE,
  getBigtableScopes,
} from './credentials.js';
export type {BigtableCredentialsConfig} from './credentials.js';

export {validateBigtableToolSettings} from './settings.js';
export type {BigtableToolSettings} from './settings.js';

export {getBigtableUserAgent} from './client.js';
export type {
  BigtableClient,
  InstanceReference,
  InstanceMetadata,
  TableReference,
  TableMetadata,
  QueryResult,
} from './client.js';
