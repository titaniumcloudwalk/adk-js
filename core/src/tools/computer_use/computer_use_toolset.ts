/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Environment, Tool, ComputerUse} from '@google/genai';

import {logger} from '../../utils/logger.js';
import {LlmRequest} from '../../models/llm_request.js';
import {ReadonlyContext} from '../../agents/readonly_context.js';
import {BaseToolset, ToolPredicate} from '../base_toolset.js';
import {BaseTool} from '../base_tool.js';
import {ToolContext} from '../tool_context.js';

import {
  BaseComputer,
  ComputerEnvironment,
  EXCLUDED_COMPUTER_METHODS,
} from './base_computer.js';
import {ComputerUseTool, ComputerUseToolOptions} from './computer_use_tool.js';


/**
 * Options for creating a ComputerUseToolset.
 */
export interface ComputerUseToolsetOptions {
  /**
   * The computer implementation to use for controlling the environment.
   */
  computer: BaseComputer;

  /**
   * Optional tool filter to include/exclude specific tools.
   */
  toolFilter?: ToolPredicate | string[];

  /**
   * The virtual coordinate space dimensions as [width, height] that the LLM
   * uses to specify coordinates. Defaults to [1000, 1000].
   */
  virtualScreenSize?: [number, number];
}

/**
 * A toolset that provides computer control capabilities to LLM agents.
 *
 * This toolset wraps a BaseComputer implementation and automatically:
 * - Creates tools for all computer control methods (click, type, scroll, etc.)
 * - Normalizes coordinates from virtual space (1000x1000) to actual screen size
 * - Configures the LLM request for computer use mode
 * - Handles initialization and cleanup of the computer environment
 *
 * @example
 * ```typescript
 * // Create a computer implementation (e.g., using Playwright)
 * const computer = new PlaywrightComputer();
 *
 * // Create the toolset
 * const toolset = new ComputerUseToolset({ computer });
 *
 * // Use with an agent
 * const agent = new LlmAgent({
 *   name: 'browser-agent',
 *   model: new Gemini({ model: 'gemini-2.5-computer-use-preview-10-2025' }),
 *   tools: [toolset],
 * });
 *
 * // Remember to close the toolset when done
 * await toolset.close();
 * ```
 */
export class ComputerUseToolset extends BaseToolset {
  private readonly computer: BaseComputer;
  private readonly virtualScreenSize: [number, number];
  private initialized = false;
  private tools: ComputerUseTool[] | undefined;

  constructor(options: ComputerUseToolsetOptions) {
    super(options.toolFilter ?? []);
    this.computer = options.computer;
    this.virtualScreenSize = options.virtualScreenSize ?? [1000, 1000];
  }

  /**
   * Ensures the computer is initialized before use.
   */
  private async ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      if (this.computer.initialize) {
        await this.computer.initialize();
      }
      this.initialized = true;
    }
  }

  /**
   * Adapt a computer use tool by replacing it with a modified version.
   *
   * This allows runtime modification of computer tools, for example to
   * add custom behavior before or after tool execution.
   *
   * @param methodName The name of the method (of BaseComputer class) to adapt.
   * @param adapterFunc A function that accepts existing computer use async function
   *   and returns a new computer use async function. The name of the returned
   *   function will be used as the new tool name.
   * @param llmRequest The LLM request containing the tools dictionary.
   *
   * @example
   * ```typescript
   * // Wrap the wait function to add logging
   * await ComputerUseToolset.adaptComputerUseTool(
   *   'wait',
   *   (originalFunc) => {
   *     async function loggedWait(seconds: number) {
   *       console.log(`Waiting for ${seconds} seconds...`);
   *       return originalFunc(seconds);
   *     }
   *     return loggedWait;
   *   },
   *   llmRequest
   * );
   * ```
   */
  static async adaptComputerUseTool(
    methodName: string,
    adapterFunc: (
      originalFunc: (...args: unknown[]) => Promise<unknown>,
    ) => ((...args: unknown[]) => Promise<unknown>) | Promise<(...args: unknown[]) => Promise<unknown>>,
    llmRequest: LlmRequest,
  ): Promise<void> {
    // Validate that the method is not an excluded method
    if (EXCLUDED_COMPUTER_METHODS.has(methodName)) {
      logger.warn(`Method ${methodName} is not a valid BaseComputer method`);
      return;
    }

    if (!(methodName in llmRequest.toolsDict)) {
      logger.warn(`Method ${methodName} not found in tools_dict`);
      return;
    }

    const originalTool = llmRequest.toolsDict[methodName];
    if (!(originalTool instanceof ComputerUseTool)) {
      logger.warn(`Tool ${methodName} is not a ComputerUseTool`);
      return;
    }

    // Create the adapted function using the adapter
    const originalFunc = originalTool.func as (...args: unknown[]) => Promise<unknown>;
    let adaptedFunc = adapterFunc(originalFunc);

    // Handle async adapter functions
    if (adaptedFunc instanceof Promise) {
      adaptedFunc = await adaptedFunc;
    }

    // Get the name from the adapted function
    const newMethodName =
      (adaptedFunc as {name?: string}).name ?? methodName;

    // Create a new ComputerUseTool with the adapted function
    const adaptedTool = new ComputerUseTool({
      name: newMethodName,
      description: originalTool.description,
      execute: adaptedFunc as (...args: unknown[]) => Promise<unknown>,
      screenSize: originalTool.screenSize,
      virtualScreenSize: originalTool.virtualScreenSize,
    });

    // Add the adapted tool and remove the original
    llmRequest.toolsDict[newMethodName] = adaptedTool as BaseTool;
    delete llmRequest.toolsDict[methodName];

    logger.debug(
      `Adapted tool ${methodName} to ${newMethodName} with adapter function`,
    );
  }

  /**
   * Returns the tools provided by this toolset.
   *
   * Creates ComputerUseTool instances for each method defined in the
   * BaseComputer interface (excluding utility methods like screenSize,
   * environment, close, initialize).
   */
  override async getTools(
    _readonlyContext?: ReadonlyContext,
  ): Promise<BaseTool[]> {
    if (this.tools) {
      return this.filterTools(this.tools, _readonlyContext);
    }

    await this.ensureInitialized();

    // Get screen size for tool configuration
    const screenSize = await this.computer.screenSize();

    // Get all methods defined in BaseComputer interface
    const computerMethods: Array<{
      name: string;
      originalName: string;
      method: (...args: unknown[]) => Promise<unknown>;
    }> = [];

    // List of all BaseComputer methods that should become tools
    const methodNames = [
      'openWebBrowser',
      'clickAt',
      'hoverAt',
      'typeTextAt',
      'scrollDocument',
      'scrollAt',
      'wait',
      'goBack',
      'goForward',
      'search',
      'navigate',
      'keyCombination',
      'dragAndDrop',
      'currentState',
    ];

    for (const methodName of methodNames) {
      // Skip excluded methods
      if (EXCLUDED_COMPUTER_METHODS.has(methodName)) {
        continue;
      }

      // Get the corresponding method from the concrete instance
      const instanceMethod = (
        this.computer as unknown as Record<
          string,
          (...args: unknown[]) => Promise<unknown>
        >
      )[methodName];

      if (typeof instanceMethod === 'function') {
        computerMethods.push({
          name: toSnakeCase(methodName),
          originalName: methodName,
          method: instanceMethod.bind(this.computer),
        });
      }
    }

    // Create ComputerUseTool instances for each method
    // Each tool wraps the method to extract args from the FunctionTool args object
    this.tools = computerMethods.map(({name, originalName, method}) => {
      // Create a wrapper function that extracts args and calls the original method
      const wrappedExecute = createMethodWrapper(originalName, method);

      const toolOptions: ComputerUseToolOptions<undefined> = {
        name,
        description: getMethodDescription(name),
        execute: wrappedExecute,
        screenSize,
        virtualScreenSize: this.virtualScreenSize,
      };
      return new ComputerUseTool(toolOptions);
    });

    return this.filterTools(this.tools, _readonlyContext);
  }

  /**
   * Apply tool filtering to the tools list.
   */
  private filterTools(
    tools: ComputerUseTool[],
    context?: ReadonlyContext,
  ): BaseTool[] {
    if (context) {
      return tools.filter((tool) => this.isToolSelected(tool as BaseTool, context));
    }

    if (Array.isArray(this.toolFilter) && this.toolFilter.length > 0) {
      const filterSet = new Set(this.toolFilter as string[]);
      return tools.filter((tool) => filterSet.has(tool.name));
    }

    return tools;
  }

  /**
   * Cleanup resources of the computer.
   */
  override async close(): Promise<void> {
    if (this.computer.close) {
      await this.computer.close();
    }
    this.tools = undefined;
    this.initialized = false;
  }

  /**
   * Add tools to the LLM request and configure computer use mode.
   */
  override async processLlmRequest(
    _toolContext: ToolContext,
    llmRequest: LlmRequest,
  ): Promise<void> {
    try {
      // Get tools if not already loaded
      const tools = await this.getTools();

      // Add all tools to the tools dictionary
      for (const tool of tools) {
        llmRequest.toolsDict[tool.name] = tool as BaseTool;
      }

      // Initialize config if needed
      if (!llmRequest.config) {
        llmRequest.config = {};
      }
      if (!llmRequest.config.tools) {
        llmRequest.config.tools = [];
      }

      // Check if computer use is already configured
      for (const tool of llmRequest.config.tools) {
        if (
          typeof tool === 'object' &&
          tool !== null &&
          'computerUse' in tool &&
          (tool as {computerUse?: ComputerUse}).computerUse
        ) {
          logger.debug('Computer use already configured in LLM request');
          return;
        }
      }

      // Add computer use tool configuration
      const computerEnvironment = await this.computer.environment();
      const environment = mapEnvironment(computerEnvironment);

      const computerUseTool: Tool = {
        computerUse: {
          environment,
        },
      };
      llmRequest.config.tools.push(computerUseTool);

      logger.debug(`Added computer use tool with environment: ${environment}`);
    } catch (error) {
      logger.error(`Error in ComputerUseToolset.processLlmRequest: ${error}`);
      throw error;
    }
  }
}

/**
 * Convert a camelCase method name to snake_case.
 */
function toSnakeCase(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

/**
 * Map ComputerEnvironment to genai Environment.
 */
function mapEnvironment(computerEnvironment: ComputerEnvironment): Environment {
  switch (computerEnvironment) {
    case ComputerEnvironment.ENVIRONMENT_BROWSER:
      return Environment.ENVIRONMENT_BROWSER;
    case ComputerEnvironment.ENVIRONMENT_UNSPECIFIED:
    default:
      return Environment.ENVIRONMENT_UNSPECIFIED;
  }
}

/**
 * Get a description for a computer method based on its name.
 */
function getMethodDescription(methodName: string): string {
  const descriptions: Record<string, string> = {
    open_web_browser: 'Opens the web browser.',
    click_at:
      'Clicks at a specific x, y coordinate on the webpage. The x and y values are absolute values scaled to the screen dimensions.',
    hover_at:
      'Hovers at a specific x, y coordinate on the webpage. May be used to explore sub-menus that appear on hover.',
    type_text_at:
      'Types text at a specific x, y coordinate. Automatically presses ENTER after typing unless press_enter is false. Clears existing content before typing unless clear_before_typing is false.',
    scroll_document:
      'Scrolls the entire webpage in the specified direction (up, down, left, or right).',
    scroll_at:
      'Scrolls at a specific x, y coordinate in the specified direction by the given magnitude.',
    wait: 'Waits for the specified number of seconds to allow unfinished webpage processes to complete.',
    go_back: 'Navigates back to the previous webpage in the browser history.',
    go_forward:
      'Navigates forward to the next webpage in the browser history.',
    search:
      'Directly jumps to a search engine home page. Used when starting a new search task.',
    navigate: 'Navigates directly to the specified URL.',
    key_combination:
      'Presses keyboard keys and combinations, such as "control+c" or "enter".',
    drag_and_drop:
      'Drags an element from a x, y coordinate to a destination coordinate.',
    current_state: 'Returns the current state of the webpage with a screenshot.',
  };

  return descriptions[methodName] ?? `Performs the ${methodName} action.`;
}

/**
 * Create a wrapper function that extracts args from the FunctionTool args object
 * and calls the original method with the correct positional arguments.
 *
 * This is needed because FunctionTool calls execute(args, toolContext) but
 * BaseComputer methods expect individual positional arguments like (x, y).
 */
function createMethodWrapper(
  methodName: string,
  method: (...args: unknown[]) => Promise<unknown>,
): (args: unknown) => Promise<unknown> {
  // Define argument mappings for each method
  const argMappings: Record<string, string[]> = {
    openWebBrowser: [],
    clickAt: ['x', 'y'],
    hoverAt: ['x', 'y'],
    typeTextAt: ['x', 'y', 'text', 'press_enter', 'clear_before_typing'],
    scrollDocument: ['direction'],
    scrollAt: ['x', 'y', 'direction', 'magnitude'],
    wait: ['seconds'],
    goBack: [],
    goForward: [],
    search: [],
    navigate: ['url'],
    keyCombination: ['keys'],
    dragAndDrop: ['x', 'y', 'destination_x', 'destination_y'],
    currentState: [],
  };

  const argNames = argMappings[methodName] ?? [];

  return async (args: unknown): Promise<unknown> => {
    const argsObj = (args ?? {}) as Record<string, unknown>;
    const positionalArgs = argNames.map((name) => argsObj[name]);
    return method(...positionalArgs);
  };
}
