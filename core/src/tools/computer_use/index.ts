/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Computer Use Tools for controlling computer environments via LLM agents.
 *
 * This module provides tools for enabling LLM agents to control computer
 * environments, such as web browsers, through a standardized interface.
 *
 * **Key Components:**
 *
 * - {@link BaseComputer} - Abstract interface for computer implementations
 * - {@link ComputerUseTool} - Tool wrapper with coordinate normalization
 * - {@link ComputerUseToolset} - Toolset for LLM agent integration
 *
 * **Usage Example:**
 *
 * ```typescript
 * import {
 *   BaseComputer,
 *   ComputerState,
 *   ComputerUseToolset,
 * } from '@google/adk/tools/computer_use';
 *
 * // Implement the BaseComputer interface (e.g., using Playwright)
 * class MyComputer implements BaseComputer {
 *   async screenSize(): Promise<[number, number]> {
 *     return [1920, 1080];
 *   }
 *   // ... implement other methods
 * }
 *
 * // Create the toolset
 * const computer = new MyComputer();
 * const toolset = new ComputerUseToolset({ computer });
 *
 * // Use with an agent
 * const agent = new LlmAgent({
 *   name: 'browser-agent',
 *   model: new Gemini({ model: 'gemini-2.5-computer-use-preview-10-2025' }),
 *   tools: [toolset],
 * });
 * ```
 *
 * @module
 */

export type {
  BaseComputer,
  ComputerState,
  ScrollDirection,
} from './base_computer.js';

export {
  ComputerEnvironment,
  EXCLUDED_COMPUTER_METHODS,
} from './base_computer.js';

export type {ComputerUseToolOptions} from './computer_use_tool.js';
export {ComputerUseTool} from './computer_use_tool.js';

export type {ComputerUseToolsetOptions} from './computer_use_toolset.js';
export {ComputerUseToolset} from './computer_use_toolset.js';
