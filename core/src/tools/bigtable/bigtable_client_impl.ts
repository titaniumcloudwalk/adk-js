/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BigtableClient,
  InstanceReference,
  InstanceMetadata,
  TableReference,
  TableMetadata,
  QueryResult,
  getBigtableUserAgent,
} from './client.js';
import {BigtableCredentialsConfig} from './credentials.js';
import {BigtableToolSettings} from './settings.js';

/**
 * Creates a Bigtable client using the @google-cloud/bigtable SDK.
 *
 * This function is lazily loaded to allow the SDK to be optionally installed.
 *
 * @param credentialsConfig Credentials configuration
 * @param toolSettings Tool settings
 * @returns BigtableClient implementation
 */
export async function createBigtableClient(
  credentialsConfig?: BigtableCredentialsConfig,
  toolSettings?: BigtableToolSettings,
): Promise<BigtableClient> {
  // Dynamically import the Bigtable SDK using a string variable to
  // prevent TypeScript from checking the import at compile time.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let BigtableClass: any;
  try {
    const moduleName = '@google-cloud/bigtable';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bigtableModule = await (Function('moduleName', 'return import(moduleName)')(moduleName) as Promise<any>);
    BigtableClass = bigtableModule.Bigtable;
  } catch {
    throw new Error(
      'The @google-cloud/bigtable package is required to use BigtableToolset. ' +
      'Please install it with: npm install @google-cloud/bigtable',
    );
  }

  const userAgent = getBigtableUserAgent();

  // Create Bigtable instance with project ID and user agent
  const bigtable = new BigtableClass({
    projectId: credentialsConfig?.projectId,
    userAgent,
  });

  const projectId = credentialsConfig?.projectId ?? await getProjectId();

  return new BigtableClientImpl(bigtable, projectId, toolSettings);
}

/**
 * Gets the project ID from environment or ADC.
 */
async function getProjectId(): Promise<string> {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GCLOUD_PROJECT ||
    process.env.GCP_PROJECT ||
    process.env.PROJECT_ID;

  if (projectId) {
    return projectId;
  }

  // Try to get from google-auth-library
  try {
    const {GoogleAuth} = await import('google-auth-library');
    const auth = new GoogleAuth();
    const id = await auth.getProjectId();
    if (id) {
      return id;
    }
  } catch {
    // Ignore auth errors and throw generic error below
  }

  throw new Error(
    'Could not determine project ID. Please set GOOGLE_CLOUD_PROJECT environment variable ' +
    'or provide projectId in credentials configuration.',
  );
}

/**
 * Implementation of BigtableClient using the @google-cloud/bigtable SDK.
 */
class BigtableClientImpl implements BigtableClient {
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private readonly bigtable: any,
    public readonly projectId: string,
    private readonly toolSettings?: BigtableToolSettings,
  ) {}

  async listInstances(): Promise<InstanceReference[]> {
    const [instances] = await this.bigtable.getInstances();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return instances.map((instance: any) => ({
      instanceId: instance.id,
      projectId: this.projectId,
    }));
  }

  async getInstance(instanceId: string): Promise<InstanceMetadata> {
    const instance = this.bigtable.instance(instanceId);
    const [metadata] = await instance.getMetadata();

    return {
      projectId: this.projectId,
      instanceId,
      displayName: metadata.displayName,
      state: metadata.state ? String(metadata.state) : undefined,
      type: metadata.type ? String(metadata.type) : undefined,
      labels: metadata.labels as Record<string, string> | undefined,
    };
  }

  async listTables(instanceId: string): Promise<TableReference[]> {
    const instance = this.bigtable.instance(instanceId);
    const [tables] = await instance.getTables();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return tables.map((table: any) => ({
      tableId: table.id,
      instanceId,
      projectId: this.projectId,
    }));
  }

  async getTable(instanceId: string, tableId: string): Promise<TableMetadata> {
    const instance = this.bigtable.instance(instanceId);
    const table = instance.table(tableId);
    const [metadata] = await table.getMetadata();

    // Extract column family names from the metadata
    const columnFamilies = Object.keys(metadata.columnFamilies || {});

    return {
      projectId: this.projectId,
      instanceId,
      tableId,
      columnFamilies,
    };
  }

  async executeQuery(
    instanceId: string,
    query: string,
    maxResults?: number,
  ): Promise<QueryResult> {
    const instance = this.bigtable.instance(instanceId);
    const limit = maxResults ?? this.toolSettings?.maxQueryResultRows ?? 50;

    // Use executeSql for GoogleSQL queries
    // Note: This requires Bigtable SQL support which is available via the data client
    const [results] = await instance.executeSql({
      query,
    });

    const rows: Record<string, unknown>[] = [];
    let resultIsLikelyTruncated = false;

    // Process results up to the limit
    for (const row of results) {
      if (rows.length >= limit) {
        resultIsLikelyTruncated = true;
        break;
      }
      // Convert row to a plain object, handling Buffer values
      const rowObj: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row as Record<string, unknown>)) {
        if (Buffer.isBuffer(value)) {
          rowObj[key] = value.toString('utf-8');
        } else if (typeof value === 'bigint') {
          rowObj[key] = value.toString();
        } else {
          rowObj[key] = value;
        }
      }
      rows.push(rowObj);
    }

    return {
      rows,
      resultIsLikelyTruncated,
    };
  }
}
