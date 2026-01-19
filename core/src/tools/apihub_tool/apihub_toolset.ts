/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as yaml from 'js-yaml';
import {OpenAPIV3} from 'openapi-types';

import {ReadonlyContext} from '../../agents/readonly_context.js';
import {AuthCredential} from '../../auth/auth_credential.js';
import {AuthScheme} from '../../auth/auth_schemes.js';
import {BaseToolset, ToolPredicate} from '../base_toolset.js';
import {OpenAPIToolset} from '../openapi/openapi_toolset.js';
import {toSnakeCase} from '../openapi/common.js';
import {RestApiTool} from '../openapi/rest_api_tool.js';

import {APIHubClient, BaseAPIHubClient} from './clients/apihub_client.js';

/**
 * Options for creating an APIHubToolset.
 */
export interface APIHubToolsetOptions {
  /**
   * The resource name from API Hub. It must include API name, and can
   * optionally include API version and spec name.
   *
   * - If apihubResourceName includes a spec resource name, the content of that
   *   spec will be used for generating the tools.
   * - If apihubResourceName includes only an api or a version name, the
   *   first spec of the first version of that API will be used.
   *
   * @example
   * - "projects/xxx/locations/us-central1/apis/apiname"
   * - "projects/xxx/locations/us-central1/apis/apiname/versions/v1"
   * - "projects/xxx/locations/us-central1/apis/apiname/versions/v1/specs/openapi"
   * - "https://console.cloud.google.com/apigee/api-hub/apis/apiname?project=xxx"
   */
  apihubResourceName: string;

  /**
   * Google Access token. Generate with gcloud cli `gcloud auth print-access-token`.
   * Useful for local testing.
   */
  accessToken?: string;

  /**
   * The service account configuration as a JSON string.
   * Required if not using default service credential.
   * Used for fetching API Specs from API Hub.
   */
  serviceAccountJson?: string;

  /**
   * Name of the toolset. Optional.
   * If not provided, will be derived from the API spec title.
   */
  name?: string;

  /**
   * Description of the toolset. Optional.
   * If not provided, will be derived from the API spec description.
   */
  description?: string;

  /**
   * If true, the spec will be loaded lazily when needed.
   * Otherwise, the spec will be loaded immediately and the tools will be
   * generated during initialization.
   * @default false
   */
  lazyLoadSpec?: boolean;

  /**
   * Auth scheme that applies to all the tools in the toolset.
   */
  authScheme?: AuthScheme;

  /**
   * Auth credential that applies to all the tools in the toolset.
   */
  authCredential?: AuthCredential;

  /**
   * Optional custom API Hub client for testing.
   */
  apihubClient?: BaseAPIHubClient;

  /**
   * The filter used to filter the tools in the toolset.
   * Can be either a tool predicate or a list of tool names of the tools to expose.
   */
  toolFilter?: ToolPredicate | string[];
}

/**
 * APIHubToolset generates tools from a given API Hub resource.
 *
 * This toolset connects to Google Cloud API Hub and dynamically creates
 * REST API tools based on the OpenAPI specifications stored in API Hub.
 *
 * @example
 * ```typescript
 * import {APIHubToolset, LlmAgent} from '@google/adk';
 *
 * // Create toolset from API Hub resource
 * const apihubToolset = new APIHubToolset({
 *   apihubResourceName: 'projects/test-project/locations/us-central1/apis/test-api',
 *   serviceAccountJson: '...',
 * });
 *
 * // Get all available tools
 * const agent = new LlmAgent({
 *   tools: [apihubToolset],
 * });
 *
 * // Or filter specific tools
 * const filteredToolset = new APIHubToolset({
 *   apihubResourceName: 'projects/test-project/locations/us-central1/apis/test-api',
 *   serviceAccountJson: '...',
 *   toolFilter: ['my_tool', 'my_other_tool'],
 * });
 * ```
 *
 * **apihubResourceName** is the resource name from API Hub. It must include
 * API name, and can optionally include API version and spec name.
 *
 * - If apihubResourceName includes a spec resource name, the content of that
 *   spec will be used for generating the tools.
 * - If apihubResourceName includes only an api or a version name, the
 *   first spec of the first version of that API will be used.
 */
export class APIHubToolset extends BaseToolset {
  /**
   * Name of the toolset (derived from spec or provided).
   */
  name: string;

  /**
   * Description of the toolset (derived from spec or provided).
   */
  description: string;

  private readonly apihubResourceName: string;
  private readonly lazyLoadSpec: boolean;
  private readonly apihubClient: BaseAPIHubClient;
  private readonly authScheme?: AuthScheme;
  private readonly authCredential?: AuthCredential;

  private openApiToolset?: OpenAPIToolset;
  private initialized = false;

  constructor(options: APIHubToolsetOptions) {
    super(options.toolFilter || []);

    this.name = options.name || '';
    this.description = options.description || '';
    this.apihubResourceName = options.apihubResourceName;
    this.lazyLoadSpec = options.lazyLoadSpec ?? false;
    this.authScheme = options.authScheme;
    this.authCredential = options.authCredential;

    this.apihubClient =
      options.apihubClient ||
      new APIHubClient({
        accessToken: options.accessToken,
        serviceAccountJson: options.serviceAccountJson,
      });
  }

  /**
   * Initializes the toolset by loading the spec from API Hub.
   * This is called automatically on first getTools() call if lazyLoadSpec is true,
   * or must be called manually if lazyLoadSpec is false.
   *
   * @returns A promise that resolves when initialization is complete.
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    await this.prepareToolset();
    this.initialized = true;
  }

  /**
   * Retrieves all available tools.
   *
   * @param readonlyContext Context for filtering tools.
   * @returns A list of all available RestApiTool objects.
   */
  override async getTools(
    readonlyContext?: ReadonlyContext
  ): Promise<RestApiTool[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    if (!this.openApiToolset) {
      return [];
    }

    return this.openApiToolset.getTools(readonlyContext);
  }

  /**
   * Fetches the spec from API Hub and generates the toolset.
   */
  private async prepareToolset(): Promise<void> {
    // Get spec content from API Hub
    const specStr = await this.apihubClient.getSpecContent(
      this.apihubResourceName
    );

    // Parse the spec (could be YAML or JSON)
    let specDict: OpenAPIV3.Document;
    try {
      specDict = yaml.load(specStr) as OpenAPIV3.Document;
    } catch {
      // Try JSON if YAML parsing fails
      specDict = JSON.parse(specStr) as OpenAPIV3.Document;
    }

    if (!specDict) {
      return;
    }

    // Derive name and description from spec if not provided
    const specInfo = specDict.info || {};
    if (!this.name) {
      this.name = toSnakeCase(specInfo.title || 'unnamed');
    }
    if (!this.description) {
      this.description = specInfo.description || '';
    }

    // Create the OpenAPI toolset with the spec
    // Only pass toolFilter if it's a function or a non-empty array
    const shouldPassFilter =
      typeof this.toolFilter === 'function' ||
      (Array.isArray(this.toolFilter) && this.toolFilter.length > 0);

    this.openApiToolset = new OpenAPIToolset({
      specDict,
      authCredential: this.authCredential,
      authScheme: this.authScheme,
      toolFilter: shouldPassFilter ? this.toolFilter : undefined,
    });
  }

  /**
   * Closes the toolset and releases any resources.
   */
  override async close(): Promise<void> {
    if (this.openApiToolset) {
      await this.openApiToolset.close();
      this.openApiToolset = undefined;
    }
    this.initialized = false;
  }
}
