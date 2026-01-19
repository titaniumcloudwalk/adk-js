/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {ToolContext} from './tool_context.js';

/**
 * Exits the control loop and skips summarization.
 *
 * Call this function only when you are instructed to do so. This function
 * sets the escalate flag to true and skips summarization, which causes the
 * agent to break out of its current execution loop.
 *
 * @param toolContext - The tool context providing access to actions
 *
 * @example
 * ```typescript
 * import { exitLoop, FunctionTool, LlmAgent } from '@google/adk';
 *
 * // Create an agent with the exit_loop tool
 * const agent = new LlmAgent({
 *   tools: [
 *     new FunctionTool({ name: 'exit_loop', description: 'Exit the loop', execute: exitLoop }),
 *   ],
 * });
 * ```
 */
export function exitLoop(toolContext: ToolContext): void {
  toolContext.actions.escalate = true;
  toolContext.actions.skipSummarization = true;
}
