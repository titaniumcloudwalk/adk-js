/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {logger} from '../../utils/logger.js';

import {
  FunctionTool,
  type ToolOptions,
  type ToolInputParameters,
} from '../function_tool.js';
import {RunAsyncToolRequest, ToolProcessLlmRequest} from '../base_tool.js';
import {ComputerState} from './base_computer.js';

/**
 * Options for creating a ComputerUseTool.
 */
export interface ComputerUseToolOptions<TParameters extends ToolInputParameters>
  extends Omit<ToolOptions<TParameters>, 'requireConfirmation'> {
  /**
   * The actual screen size as [width, height] in pixels.
   * This represents the real dimensions of the target screen/display.
   */
  screenSize: [number, number];

  /**
   * The virtual coordinate space dimensions as [width, height] that the LLM
   * uses to specify coordinates. Coordinates from the LLM are automatically
   * normalized from this virtual space to the actual screenSize.
   * Defaults to [1000, 1000], meaning the LLM thinks it's working with a
   * 1000x1000 pixel screen regardless of the actual screen dimensions.
   */
  virtualScreenSize?: [number, number];
}

/**
 * A tool that wraps computer control functions for use with LLMs.
 *
 * This tool automatically normalizes coordinates from a virtual coordinate space
 * (by default 1000x1000) to the actual screen size. This allows LLMs to work
 * with a consistent coordinate system regardless of the actual screen
 * dimensions, making their output more predictable and easier to handle.
 *
 * @example
 * ```typescript
 * const clickTool = new ComputerUseTool({
 *   name: 'click_at',
 *   description: 'Clicks at a specific coordinate',
 *   parameters: z.object({ x: z.number(), y: z.number() }),
 *   execute: async (args) => computer.clickAt(args.x, args.y),
 *   screenSize: [1920, 1080],
 *   virtualScreenSize: [1000, 1000], // optional, defaults to 1000x1000
 * });
 * ```
 */
export class ComputerUseTool<
  TParameters extends ToolInputParameters = undefined,
> extends FunctionTool<TParameters> {
  /**
   * The actual screen size [width, height] in pixels.
   */
  readonly screenSize: [number, number];

  /**
   * The virtual coordinate space [width, height].
   */
  readonly virtualScreenSize: [number, number];

  /**
   * Internal reference to the execute function for tool adaptation.
   * @internal
   */
  readonly func: ToolOptions<TParameters>['execute'];

  constructor(options: ComputerUseToolOptions<TParameters>) {
    super({
      name: options.name,
      description: options.description,
      parameters: options.parameters,
      execute: options.execute,
      isLongRunning: options.isLongRunning,
    });

    this.func = options.execute;
    this.screenSize = options.screenSize;
    this.virtualScreenSize = options.virtualScreenSize ?? [1000, 1000];

    // Validate screen size
    if (
      !Array.isArray(this.screenSize) ||
      this.screenSize.length !== 2 ||
      this.screenSize[0] <= 0 ||
      this.screenSize[1] <= 0
    ) {
      throw new Error('screenSize must be a tuple of positive [width, height]');
    }

    // Validate virtual screen size
    if (
      !Array.isArray(this.virtualScreenSize) ||
      this.virtualScreenSize.length !== 2 ||
      this.virtualScreenSize[0] <= 0 ||
      this.virtualScreenSize[1] <= 0
    ) {
      throw new Error(
        'virtualScreenSize must be a tuple of positive [width, height]',
      );
    }
  }

  /**
   * Normalize x coordinate from virtual screen space to actual screen width.
   */
  private normalizeX(x: number): number {
    if (typeof x !== 'number' || isNaN(x)) {
      throw new Error(`x coordinate must be numeric, got ${typeof x}`);
    }

    const normalized = Math.floor(
      (x / this.virtualScreenSize[0]) * this.screenSize[0],
    );
    // Clamp to screen bounds
    return Math.max(0, Math.min(normalized, this.screenSize[0] - 1));
  }

  /**
   * Normalize y coordinate from virtual screen space to actual screen height.
   */
  private normalizeY(y: number): number {
    if (typeof y !== 'number' || isNaN(y)) {
      throw new Error(`y coordinate must be numeric, got ${typeof y}`);
    }

    const normalized = Math.floor(
      (y / this.virtualScreenSize[1]) * this.screenSize[1],
    );
    // Clamp to screen bounds
    return Math.max(0, Math.min(normalized, this.screenSize[1] - 1));
  }

  /**
   * Run the computer control function with normalized coordinates.
   */
  override async runAsync(req: RunAsyncToolRequest): Promise<unknown> {
    try {
      const args = {...(req.args as Record<string, unknown>)};

      // Normalize coordinates if present
      if ('x' in args && typeof args.x === 'number') {
        const originalX = args.x;
        args.x = this.normalizeX(args.x);
        logger.debug(`Normalized x: ${originalX} -> ${args.x}`);
      }

      if ('y' in args && typeof args.y === 'number') {
        const originalY = args.y;
        args.y = this.normalizeY(args.y);
        logger.debug(`Normalized y: ${originalY} -> ${args.y}`);
      }

      // Handle destination coordinates for drag and drop
      if ('destination_x' in args && typeof args.destination_x === 'number') {
        const originalDestX = args.destination_x;
        args.destination_x = this.normalizeX(args.destination_x);
        logger.debug(
          `Normalized destination_x: ${originalDestX} -> ${args.destination_x}`,
        );
      }

      if ('destination_y' in args && typeof args.destination_y === 'number') {
        const originalDestY = args.destination_y;
        args.destination_y = this.normalizeY(args.destination_y);
        logger.debug(
          `Normalized destination_y: ${originalDestY} -> ${args.destination_y}`,
        );
      }

      // Execute the actual computer control function with normalized args
      const modifiedReq: RunAsyncToolRequest = {
        ...req,
        args,
      };
      const result = await super.runAsync(modifiedReq);

      // Process the result if it's a ComputerState
      if (isComputerState(result)) {
        return {
          image: result.screenshot
            ? {
                mimetype: 'image/png',
                data: bufferToBase64(result.screenshot),
              }
            : undefined,
          url: result.url,
        };
      }

      return result;
    } catch (error) {
      logger.error(`Error in ComputerUseTool.runAsync: ${error}`);
      throw error;
    }
  }

  /**
   * ComputerUseToolset will add this tool to the LLM request and add
   * computer use configuration to the LLM request.
   */
  override async processLlmRequest(
    _request: ToolProcessLlmRequest,
  ): Promise<void> {
    // The ComputerUseToolset handles adding tools and configuration to the LLM request
    // This method is intentionally empty to prevent FunctionTool's default behavior
  }
}

/**
 * Type guard to check if a value is a ComputerState.
 */
function isComputerState(value: unknown): value is ComputerState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const state = value as Record<string, unknown>;
  // ComputerState has optional screenshot and url fields
  return (
    ('screenshot' in state || 'url' in state) &&
    (state.screenshot === undefined ||
      state.screenshot instanceof Uint8Array ||
      Buffer.isBuffer(state.screenshot)) &&
    (state.url === undefined || typeof state.url === 'string')
  );
}

/**
 * Convert a Uint8Array or Buffer to a base64 string.
 */
function bufferToBase64(data: Uint8Array): string {
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(data)) {
    return data.toString('base64');
  }
  // Browser-compatible base64 encoding
  let binary = '';
  const bytes = new Uint8Array(data);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
