/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  GenerateContentConfig,
  RagRetrievalConfig,
  VertexRagStore,
  VertexRagStoreRagResource,
} from '@google/genai';

import {logger} from '../../utils/logger.js';
import {isGemini2OrAbove} from '../../utils/model_name.js';
import {RunAsyncToolRequest, ToolProcessLlmRequest} from '../base_tool.js';

import {BaseRetrievalTool} from './base_retrieval_tool.js';

/**
 * Configuration options for VertexAiRagRetrieval tool.
 */
export interface VertexAiRagRetrievalConfig {
  /**
   * The name of the retrieval tool.
   */
  name: string;

  /**
   * Description of what this retrieval tool does.
   */
  description: string;

  /**
   * Optional. Deprecated. Please use ragResources instead.
   *
   * List of RAG corpus names in the format:
   * `projects/{project}/locations/{location}/ragCorpora/{rag_corpus}`
   */
  ragCorpora?: string[];

  /**
   * Optional. The representation of the RAG source. It can be used to specify
   * corpus only or RAG files. Currently only supports one corpus or multiple
   * files from one corpus.
   */
  ragResources?: VertexRagStoreRagResource[];

  /**
   * Optional. The retrieval config for the RAG query.
   */
  ragRetrievalConfig?: RagRetrievalConfig;

  /**
   * Optional. Number of top k results to return from the selected corpora.
   */
  similarityTopK?: number;

  /**
   * Optional. Only return results with vector distance smaller than the
   * threshold.
   */
  vectorDistanceThreshold?: number;
}

/**
 * A retrieval tool that uses Vertex AI RAG (Retrieval-Augmented Generation)
 * to retrieve data.
 *
 * This tool supports two modes of operation:
 * - **Gemini 2.x models**: Uses built-in Vertex AI RAG retrieval (server-side
 *   execution). The model handles the retrieval internally.
 * - **Gemini 1.x models**: Uses client-side execution by adding a function
 *   declaration. Note that client-side execution requires the Vertex AI RAG
 *   API to be called, which is not yet fully implemented in TypeScript.
 *
 * @example Basic usage with RAG corpus:
 * ```typescript
 * const ragTool = new VertexAiRagRetrieval({
 *   name: 'company_docs_retrieval',
 *   description: 'Retrieves relevant company documentation',
 *   ragCorpora: ['projects/my-project/locations/us-central1/ragCorpora/my-corpus'],
 *   similarityTopK: 5,
 * });
 *
 * const agent = new LlmAgent({
 *   name: 'doc_assistant',
 *   model: new Gemini({ model: 'gemini-2.0-flash' }),
 *   tools: [ragTool],
 * });
 * ```
 *
 * @example Using with RAG resources:
 * ```typescript
 * const ragTool = new VertexAiRagRetrieval({
 *   name: 'knowledge_base',
 *   description: 'Searches the company knowledge base',
 *   ragResources: [
 *     {
 *       ragCorpus: 'projects/my-project/locations/us-central1/ragCorpora/kb-corpus',
 *       ragFileIds: ['file-1', 'file-2'],
 *     },
 *   ],
 *   similarityTopK: 10,
 *   vectorDistanceThreshold: 0.8,
 * });
 * ```
 */
export class VertexAiRagRetrieval extends BaseRetrievalTool {
  /**
   * The Vertex RAG store configuration containing the retrieval settings.
   */
  readonly vertexRagStore: VertexRagStore;

  /**
   * Creates a new VertexAiRagRetrieval instance.
   *
   * @param config Configuration options for the Vertex AI RAG retrieval tool.
   */
  constructor(config: VertexAiRagRetrievalConfig) {
    super({
      name: config.name,
      description: config.description,
    });

    this.vertexRagStore = {
      ragCorpora: config.ragCorpora,
      ragResources: config.ragResources,
      ragRetrievalConfig: config.ragRetrievalConfig,
      similarityTopK: config.similarityTopK,
      vectorDistanceThreshold: config.vectorDistanceThreshold,
    };
  }

  /**
   * Processes the LLM request to inject Vertex AI RAG configuration.
   *
   * For Gemini 2.x models, this adds a retrieval tool with the Vertex RAG
   * store configuration directly to the LLM request, enabling server-side
   * retrieval.
   *
   * For Gemini 1.x models, this falls back to the parent class behavior,
   * which adds a function declaration for client-side execution.
   *
   * @param params The tool process request containing the LLM request to modify.
   */
  override async processLlmRequest({
    toolContext,
    llmRequest,
  }: ToolProcessLlmRequest): Promise<void> {
    // Use Gemini built-in Vertex AI RAG tool for Gemini 2 models.
    if (llmRequest.model && isGemini2OrAbove(llmRequest.model)) {
      // Initialize config if not present
      llmRequest.config = llmRequest.config || ({} as GenerateContentConfig);
      llmRequest.config.tools = llmRequest.config.tools || [];

      // Add the retrieval tool with Vertex RAG store configuration
      llmRequest.config.tools.push({
        retrieval: {
          vertexRagStore: this.vertexRagStore,
        },
      });

      logger.debug(
        `VertexAiRagRetrieval: Added built-in retrieval for model ${llmRequest.model}`
      );
    } else {
      // For Gemini 1.x models, add function declaration for client-side execution
      await super.processLlmRequest({toolContext, llmRequest});

      logger.debug(
        `VertexAiRagRetrieval: Added function declaration for model ${llmRequest.model || 'unknown'}`
      );
    }
  }

  /**
   * Runs the RAG retrieval query.
   *
   * This method is called for client-side execution (Gemini 1.x models).
   * For Gemini 2.x models, retrieval is handled server-side and this method
   * will not be called.
   *
   * Note: Full client-side execution requires calling the Vertex AI RAG API,
   * which is not yet fully implemented in the TypeScript SDK. This
   * implementation returns a placeholder message indicating that client-side
   * RAG retrieval is not available.
   *
   * @param request The request containing the query arguments.
   * @returns A promise resolving to the retrieval results.
   */
  override async runAsync(request: RunAsyncToolRequest): Promise<unknown> {
    const query = request.args['query'] as string;

    // Log the query for debugging
    logger.debug(`VertexAiRagRetrieval: Executing query: ${query}`);

    // Client-side RAG retrieval requires the Vertex AI RAG API
    // which is not yet available in the TypeScript SDK.
    // For Gemini 2.x models, retrieval is handled server-side.
    logger.warn(
      'VertexAiRagRetrieval: Client-side RAG retrieval (for Gemini 1.x) is not ' +
        'yet fully implemented. Consider using Gemini 2.x models for built-in ' +
        'RAG support.'
    );

    return {
      error:
        'Client-side RAG retrieval is not available. Please use Gemini 2.x models ' +
        'for built-in Vertex AI RAG support, or implement custom retrieval logic.',
      query: query,
      config: this.vertexRagStore,
    };
  }
}

/**
 * Factory function to create a VertexAiRagRetrieval instance.
 *
 * @param config Configuration options for the Vertex AI RAG retrieval tool.
 * @returns A new VertexAiRagRetrieval instance.
 *
 * @example
 * ```typescript
 * const ragTool = createVertexAiRagRetrieval({
 *   name: 'my_rag_tool',
 *   description: 'Retrieves data from my RAG corpus',
 *   ragCorpora: ['projects/my-project/locations/us-central1/ragCorpora/my-corpus'],
 * });
 * ```
 */
export function createVertexAiRagRetrieval(
  config: VertexAiRagRetrievalConfig
): VertexAiRagRetrieval {
  return new VertexAiRagRetrieval(config);
}
