/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Schema, Type} from '@google/genai';

import {BaseTool, RunAsyncToolRequest} from './base_tool.js';

/**
 * The name of the stop_streaming built-in function.
 */
export const STOP_STREAMING_FUNCTION_NAME = 'stop_streaming';

/**
 * A built-in tool that stops a currently running streaming function.
 *
 * This tool is automatically available during live/bidirectional streaming
 * sessions. When called, it cancels the specified streaming function and
 * cleans up its resources.
 *
 * @example
 * ```typescript
 * // The LLM can call this to stop a streaming function:
 * // stop_streaming({ function_name: "monitor_stock_price" })
 * ```
 */
export class StopStreamingTool extends BaseTool {
  constructor() {
    super({
      name: STOP_STREAMING_FUNCTION_NAME,
      description:
        'Stops a currently running streaming function. ' +
        'Call this when you want to cancel an active streaming operation.',
    });
  }

  override _getDeclaration() {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          function_name: {
            type: Type.STRING,
            description: 'The name of the streaming function to stop.',
          },
        },
        required: ['function_name'],
      } as Schema,
    };
  }

  /**
   * This tool's execution is handled specially in handleFunctionCallsLive().
   * The runAsync method should not be called directly.
   */
  override async runAsync(_request: RunAsyncToolRequest): Promise<unknown> {
    // Execution is handled in processFunctionLiveHelper
    return {
      error:
        'stop_streaming should be handled in live mode. ' +
        'This method should not be called directly.',
    };
  }
}

/**
 * Singleton instance of the StopStreamingTool.
 */
export const stopStreamingTool = new StopStreamingTool();
