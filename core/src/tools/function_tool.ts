/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {FunctionDeclaration, Schema, Type} from '@google/genai';
import {
  type infer as zInfer,
  ZodObject,
  type ZodRawShape,
} from 'zod';

import {isZodObject, zodObjectToSchema} from '../utils/simple_zod_to_json.js';

import {BaseTool, RunAsyncToolRequest} from './base_tool.js';
import {ToolContext} from './tool_context.js';

/**
 * Input parameters of the function tool.
 */
export type ToolInputParameters =
  | undefined
  | ZodObject<ZodRawShape>
  | Schema;

/*
 * The arguments of the function tool.
 */
export type ToolExecuteArgument<TParameters extends ToolInputParameters> =
  TParameters extends ZodObject<infer T, infer U, infer V>
    ? zInfer<ZodObject<T, U, V>>
    : TParameters extends Schema
      ? unknown
      : string;

/*
 * The function to execute by the tool.
 */
type ToolExecuteFunction<
  TParameters extends ToolInputParameters,
> = (
  input: ToolExecuteArgument<TParameters>,
  tool_context?: ToolContext,
) => Promise<unknown> | unknown;

/**
 * A function that determines whether confirmation is required for a tool execution.
 * @param args The arguments passed to the tool
 * @param toolContext The tool context
 * @returns true if confirmation is required, false otherwise
 */
export type RequireConfirmationFunction<
  TParameters extends ToolInputParameters,
> = (
  args: ToolExecuteArgument<TParameters>,
  toolContext: ToolContext,
) => boolean | Promise<boolean>;

/**
 * The configuration options for creating a function-based tool.
 * The `name`, `description` and `parameters` fields are used to generate the
 * tool definition that is passed to the LLM prompt.
 *
 * Note: Unlike Python's ADK, JSDoc on the `execute` function is ignored
 * for tool definition generation.
 */
export type ToolOptions<
  TParameters extends ToolInputParameters,
> = {
  name?: string;
  description: string;
  parameters?: TParameters;
  execute: ToolExecuteFunction<TParameters>;
  isLongRunning?: boolean;
  /**
   * Controls whether this tool requires user confirmation before execution.
   *
   * Can be either:
   * - `true`: Always require confirmation before executing
   * - `false`: Never require confirmation (default)
   * - A function: Dynamically determine if confirmation is needed based on arguments
   *
   * When confirmation is required, the tool will:
   * 1. Request confirmation via `toolContext.requestConfirmation()`
   * 2. Return an error indicating confirmation is needed
   * 3. Set `skipSummarization = true` to avoid summarizing the confirmation request
   *
   * On subsequent calls after user approval, the tool will execute normally.
   * If the user rejects, the tool returns an error without executing.
   *
   * @example
   * ```typescript
   * // Static confirmation requirement
   * const tool = new FunctionTool({
   *   name: 'reimburse',
   *   description: 'Reimburse an expense',
   *   parameters: z.object({ amount: z.number() }),
   *   execute: async (args) => { ... },
   *   requireConfirmation: true
   * });
   *
   * // Dynamic confirmation based on amount
   * const tool = new FunctionTool({
   *   name: 'transfer_money',
   *   description: 'Transfer money between accounts',
   *   parameters: z.object({ amount: z.number() }),
   *   execute: async (args) => { ... },
   *   requireConfirmation: (args) => args.amount > 1000
   * });
   * ```
   */
  requireConfirmation?: boolean | RequireConfirmationFunction<TParameters>;
};

function toSchema<TParameters extends ToolInputParameters>(
  parameters: TParameters): Schema {
  if (parameters === undefined) {
    return {type: Type.OBJECT, properties: {}};
  }

  if (isZodObject(parameters)) {
    return zodObjectToSchema(parameters);
  }

  return parameters;
}

export class FunctionTool<
  TParameters extends ToolInputParameters = undefined,
> extends BaseTool {
  // User defined function.
  private readonly execute: ToolExecuteFunction<TParameters>;
  // Typed input parameters.
  private readonly parameters?: TParameters;
  // Confirmation requirement configuration.
  private readonly requireConfirmation?: boolean | RequireConfirmationFunction<TParameters>;

  /**
   * The constructor acts as the user-friendly factory.
   * @param options The configuration for the tool.
   */
  constructor(options: ToolOptions<TParameters>) {
    const name = options.name ?? (options.execute as {name?: string}).name;
    if (!name) {
      throw new Error(
        'Tool name cannot be empty. Either name the `execute` function or provide a `name`.',
      );
    }
    super({
      name,
      description: options.description,
      isLongRunning: options.isLongRunning,
    });
    this.execute = options.execute;
    this.parameters = options.parameters;
    this.requireConfirmation = options.requireConfirmation;
  }

  /**
   * Provide a schema for the function.
   */
  override _getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: toSchema(this.parameters),
    };
  }

  /**
   * Logic for running the tool.
   */
  override async runAsync(req: RunAsyncToolRequest): Promise<unknown> {
    try {
      let validatedArgs: unknown = req.args;
      if (this.parameters instanceof ZodObject) {
        validatedArgs = this.parameters.parse(req.args);
      }

      // Check if confirmation is required
      let needsConfirmation = false;
      if (typeof this.requireConfirmation === 'function') {
        needsConfirmation = await this.requireConfirmation(
          validatedArgs as ToolExecuteArgument<TParameters>,
          req.toolContext,
        );
      } else if (this.requireConfirmation === true) {
        needsConfirmation = true;
      }

      // Handle confirmation flow
      if (needsConfirmation) {
        if (!req.toolContext.toolConfirmation) {
          // Request confirmation
          req.toolContext.requestConfirmation({
            hint: `Please approve or reject the tool call ${this.name}() by ` +
                  'responding with a FunctionResponse with an expected ' +
                  'ToolConfirmation payload.',
          });
          req.toolContext.actions.skipSummarization = true;
          return {
            error: 'This tool call requires confirmation, please approve or reject.',
          };
        } else if (!req.toolContext.toolConfirmation.confirmed) {
          // Confirmation was rejected
          return {error: 'This tool call is rejected.'};
        }
        // Confirmation was approved, proceed with execution
      }

      // Execute tool
      return await this.execute(
        validatedArgs as ToolExecuteArgument<TParameters>,
        req.toolContext,
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Error in tool '${this.name}': ${errorMessage}`);
    }
  }
}
