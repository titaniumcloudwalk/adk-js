/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FunctionDeclaration, Type} from '@google/genai';

import {BaseTool, BaseToolParams, RunAsyncToolRequest} from '../base_tool.js';

/**
 * Parameters for creating a BaseRetrievalTool.
 */
export interface BaseRetrievalToolParams extends BaseToolParams {}

/**
 * Base class for retrieval tools that query external data sources.
 *
 * This class provides a standard function declaration with a `query` parameter
 * that all retrieval tools share. Subclasses should implement `runAsync` to
 * perform the actual retrieval logic.
 *
 * For Gemini 2.x models, subclasses may override `processLlmRequest` to use
 * built-in retrieval capabilities (server-side execution). For Gemini 1.x
 * models, the default behavior adds a function declaration and uses client-side
 * execution via `runAsync`.
 *
 * @example Creating a custom retrieval tool:
 * ```typescript
 * class MyRetrievalTool extends BaseRetrievalTool {
 *   constructor() {
 *     super({
 *       name: 'my_retrieval',
 *       description: 'Retrieves data from my custom data source',
 *     });
 *   }
 *
 *   async runAsync(request: RunAsyncToolRequest): Promise<unknown> {
 *     const query = request.args['query'] as string;
 *     // Perform retrieval logic
 *     return ['result1', 'result2'];
 *   }
 * }
 * ```
 */
export abstract class BaseRetrievalTool extends BaseTool {
  constructor(params: BaseRetrievalToolParams) {
    super(params);
  }

  /**
   * Returns the function declaration for this retrieval tool.
   *
   * All retrieval tools share a common interface with a single `query`
   * parameter of type STRING.
   *
   * @returns The function declaration with a query parameter.
   */
  override _getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          query: {
            type: Type.STRING,
            description: 'The query to retrieve.',
          },
        },
        required: ['query'],
      },
    };
  }

  /**
   * Runs the retrieval with the given query.
   *
   * Subclasses must implement this method to perform the actual retrieval
   * logic. The query is available in `request.args['query']` as a string.
   *
   * @param request The request containing the query arguments and tool context.
   * @returns A promise resolving to the retrieval results.
   */
  abstract runAsync(request: RunAsyncToolRequest): Promise<unknown>;
}
