/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GenerateContentConfig,
  VertexAISearch,
  VertexAISearchDataStoreSpec,
} from '@google/genai';

import {isGemini1Model, isGeminiModel} from '../utils/model_name.js';
import {logger} from '../utils/logger.js';

import {
  BaseTool,
  RunAsyncToolRequest,
  ToolProcessLlmRequest,
} from './base_tool.js';

/**
 * Configuration options for VertexAiSearchTool.
 */
export interface VertexAiSearchToolConfig {
  /**
   * Fully-qualified Vertex AI Search data store resource ID.
   * Format: `projects/{project}/locations/{location}/collections/{collection}/dataStores/{dataStore}`
   *
   * Either dataStoreId or searchEngineId must be specified, but not both.
   */
  dataStoreId?: string;

  /**
   * Specifications that define the specific DataStores to be searched,
   * along with configurations for those data stores.
   * This is only considered for Engines with multiple data stores.
   *
   * Note: searchEngineId must be specified if dataStoreSpecs is provided.
   */
  dataStoreSpecs?: VertexAISearchDataStoreSpec[];

  /**
   * Fully-qualified Vertex AI Search engine resource ID.
   * Format: `projects/{project}/locations/{location}/collections/{collection}/engines/{engine}`
   *
   * Either dataStoreId or searchEngineId must be specified, but not both.
   */
  searchEngineId?: string;

  /**
   * Optional filter strings to be passed to the search API.
   * For more information on filtering, see:
   * https://cloud.google.com/generative-ai-app-builder/docs/filter-search-metadata
   */
  filter?: string;

  /**
   * Maximum number of search results to return per query.
   * Default value is 10. Maximum allowed value is 10.
   */
  maxResults?: number;

  /**
   * Whether to bypass the multi-tools limit for Gemini 1.x models.
   *
   * In Gemini 1.x, the Vertex AI Search tool cannot be used alongside other tools.
   * Setting this to true wraps the tool in a sub-agent to work around this limitation.
   *
   * Note: This parameter is for future use when bypass functionality is implemented.
   */
  bypassMultiToolsLimit?: boolean;
}

/**
 * A built-in tool that enables grounding through Vertex AI Search.
 *
 * This tool allows agents to ground their responses using enterprise
 * document datastores configured in Vertex AI Search. It operates
 * internally within the Gemini model and does not require client-side
 * code execution.
 *
 * @example Basic usage with a data store:
 * ```typescript
 * const searchTool = new VertexAiSearchTool({
 *   dataStoreId: 'projects/my-project/locations/global/collections/default_collection/dataStores/my-datastore',
 * });
 *
 * const agent = new LlmAgent({
 *   name: 'search_agent',
 *   model: new Gemini({ model: 'gemini-2.0-flash' }),
 *   tools: [searchTool],
 * });
 * ```
 *
 * @example Using with a search engine and data store specs:
 * ```typescript
 * const searchTool = new VertexAiSearchTool({
 *   searchEngineId: 'projects/my-project/locations/global/collections/default_collection/engines/my-engine',
 *   dataStoreSpecs: [
 *     {
 *       dataStore: 'projects/my-project/locations/global/collections/default_collection/dataStores/store1',
 *       filter: 'category: "technical"',
 *     },
 *     {
 *       dataStore: 'projects/my-project/locations/global/collections/default_collection/dataStores/store2',
 *     },
 *   ],
 *   maxResults: 5,
 * });
 * ```
 */
export class VertexAiSearchTool extends BaseTool {
  private readonly dataStoreId?: string;
  private readonly dataStoreSpecs?: VertexAISearchDataStoreSpec[];
  private readonly searchEngineId?: string;
  private readonly filter?: string;
  private readonly maxResults?: number;
  private readonly bypassMultiToolsLimit: boolean;

  /**
   * Creates a new VertexAiSearchTool instance.
   *
   * @param config Configuration options for the Vertex AI Search tool.
   * @throws Error if neither dataStoreId nor searchEngineId is specified.
   * @throws Error if both dataStoreId and searchEngineId are specified.
   * @throws Error if dataStoreSpecs is provided without searchEngineId.
   */
  constructor(config: VertexAiSearchToolConfig) {
    super({
      name: 'vertex_ai_search',
      description: 'Vertex AI Search Tool for enterprise document grounding',
    });

    // Validation: exactly one of dataStoreId or searchEngineId must be specified
    if (
      (config.dataStoreId === undefined &&
        config.searchEngineId === undefined) ||
      (config.dataStoreId !== undefined && config.searchEngineId !== undefined)
    ) {
      throw new Error(
        'Either dataStoreId or searchEngineId must be specified, but not both.'
      );
    }

    // Validation: dataStoreSpecs requires searchEngineId
    if (
      config.dataStoreSpecs !== undefined &&
      config.searchEngineId === undefined
    ) {
      throw new Error(
        'searchEngineId must be specified if dataStoreSpecs is specified.'
      );
    }

    this.dataStoreId = config.dataStoreId;
    this.dataStoreSpecs = config.dataStoreSpecs;
    this.searchEngineId = config.searchEngineId;
    this.filter = config.filter;
    this.maxResults = config.maxResults;
    this.bypassMultiToolsLimit = config.bypassMultiToolsLimit ?? false;
  }

  /**
   * This is a built-in tool on the server side. It doesn't require
   * client-side execution - it's triggered by setting the corresponding
   * request parameters.
   */
  runAsync(request: RunAsyncToolRequest): Promise<unknown> {
    return Promise.resolve();
  }

  /**
   * Processes the LLM request to inject Vertex AI Search configuration.
   *
   * This method modifies the LLM request to include the Vertex AI Search
   * retrieval configuration, enabling the model to ground its responses
   * using the configured data stores.
   *
   * @param params The tool process request containing the LLM request to modify.
   * @throws Error if used with a non-Gemini model.
   * @throws Error if used with Gemini 1.x alongside other tools.
   */
  override async processLlmRequest({
    toolContext,
    llmRequest,
  }: ToolProcessLlmRequest): Promise<void> {
    if (!llmRequest.model) {
      return;
    }

    // Verify this is a Gemini model
    if (!isGeminiModel(llmRequest.model)) {
      throw new Error(
        `Vertex AI Search tool is not supported for model ${llmRequest.model}. ` +
          'Only Gemini models are supported.'
      );
    }

    // Initialize config and tools array
    llmRequest.config = llmRequest.config || ({} as GenerateContentConfig);
    llmRequest.config.tools = llmRequest.config.tools || [];

    // Check for Gemini 1.x multi-tool limitation
    if (isGemini1Model(llmRequest.model)) {
      // Check if there are other tools already configured
      const hasOtherTools = llmRequest.config.tools.some((tool) => {
        // Check if tool has functionDeclarations or other tool types
        return (
          'functionDeclarations' in tool ||
          'googleSearch' in tool ||
          'googleSearchRetrieval' in tool ||
          'codeExecution' in tool
        );
      });

      if (hasOtherTools) {
        throw new Error(
          'Vertex AI Search tool cannot be used with other tools in Gemini 1.x. ' +
            'Consider using Gemini 2.0 or later, or use the bypassMultiToolsLimit option.'
        );
      }
    }

    // Log the configuration for debugging
    this.logConfiguration();

    // Build the VertexAISearch configuration
    const vertexAiSearchConfig: VertexAISearch = {};

    if (this.dataStoreId !== undefined) {
      vertexAiSearchConfig.datastore = this.dataStoreId;
    }

    if (this.searchEngineId !== undefined) {
      vertexAiSearchConfig.engine = this.searchEngineId;
    }

    if (this.dataStoreSpecs !== undefined) {
      vertexAiSearchConfig.dataStoreSpecs = this.dataStoreSpecs;
    }

    if (this.filter !== undefined) {
      vertexAiSearchConfig.filter = this.filter;
    }

    if (this.maxResults !== undefined) {
      vertexAiSearchConfig.maxResults = this.maxResults;
    }

    // Add the retrieval tool to the request
    llmRequest.config.tools.push({
      retrieval: {
        vertexAiSearch: vertexAiSearchConfig,
      },
    });
  }

  /**
   * Logs the current configuration for debugging purposes.
   */
  private logConfiguration(): void {
    const configParts: string[] = [];

    if (this.dataStoreId !== undefined) {
      configParts.push(`dataStoreId=${this.dataStoreId}`);
    }

    if (this.searchEngineId !== undefined) {
      configParts.push(`searchEngineId=${this.searchEngineId}`);
    }

    if (this.filter !== undefined) {
      configParts.push(`filter=${this.filter}`);
    }

    if (this.maxResults !== undefined) {
      configParts.push(`maxResults=${this.maxResults}`);
    }

    if (this.dataStoreSpecs !== undefined && this.dataStoreSpecs.length > 0) {
      const dataStoreIds = this.dataStoreSpecs
        .map((spec) => spec.dataStore)
        .filter((ds) => ds !== undefined);
      configParts.push(
        `dataStoreSpecs=[${this.dataStoreSpecs.length} specs: ${dataStoreIds.join(', ')}]`
      );
    }

    logger.debug(`VertexAiSearchTool configuration: ${configParts.join(', ')}`);
  }
}

/**
 * Factory function to create a VertexAiSearchTool instance.
 *
 * @param config Configuration options for the Vertex AI Search tool.
 * @returns A new VertexAiSearchTool instance.
 *
 * @example
 * ```typescript
 * const searchTool = createVertexAiSearchTool({
 *   dataStoreId: 'projects/my-project/locations/global/collections/default_collection/dataStores/my-datastore',
 * });
 * ```
 */
export function createVertexAiSearchTool(
  config: VertexAiSearchToolConfig
): VertexAiSearchTool {
  return new VertexAiSearchTool(config);
}
