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
  type ZodTypeAny,
} from 'zod';

import {LiveRequestQueue} from '../agents/live_request_queue.js';
import {Aclosing, isAsyncGeneratorFunction} from '../utils/async_generator_utils.js';
import {isZodObject, isZodType, zodObjectToSchema, zodTypeToSchema} from '../utils/simple_zod_to_json.js';

import {BaseTool, CallLiveToolRequest, RunAsyncToolRequest} from './base_tool.js';
import {ToolContext} from './tool_context.js';

/**
 * Input parameters of the function tool.
 */
export type ToolInputParameters =
  | undefined
  | ZodObject<ZodRawShape>
  | Schema;

/**
 * Response schema type for the function tool.
 * Can be a Zod schema (any type) or a raw Google GenAI Schema.
 *
 * For streaming tools (async generators), this represents the yield type,
 * i.e., the type of each item yielded by the generator.
 *
 * @example
 * ```typescript
 * // Using Zod (recommended)
 * response: z.string()  // Simple string response
 * response: z.array(z.number())  // Array of numbers
 * response: z.object({ result: z.string() })  // Object response
 *
 * // Using raw Schema
 * response: { type: Type.STRING }  // Simple string
 * response: { type: Type.ARRAY, items: { type: Type.NUMBER } }  // Array
 * ```
 */
export type ToolResponseSchema =
  | ZodTypeAny
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

/**
 * The function to execute by the tool.
 * Supports regular functions, async functions, and async generator functions.
 */
type ToolExecuteFunction<
  TParameters extends ToolInputParameters,
> = (
  input: ToolExecuteArgument<TParameters>,
  tool_context?: ToolContext,
) => Promise<unknown> | unknown | AsyncGenerator<unknown>;

/**
 * A streaming tool function that accepts an input stream for bidirectional streaming.
 * Used for live/streaming tool execution that can receive data while producing output.
 */
export type StreamingToolFunction<
  TParameters extends ToolInputParameters,
> = (
  input: ToolExecuteArgument<TParameters>,
  tool_context: ToolContext,
  input_stream?: LiveRequestQueue,
) => AsyncGenerator<unknown>;

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
  /**
   * Describes the output from this function in Schema format.
   *
   * For streaming tools (async generator functions), this represents the yield type,
   * i.e., the type of each item yielded by the generator.
   *
   * Since TypeScript erases generic types at runtime (unlike Python which can
   * introspect `AsyncGenerator[YieldType, SendType]` at runtime), you must explicitly
   * specify the response schema if you want the LLM to know the expected output format.
   *
   * @example
   * ```typescript
   * // Streaming tool with string yield type
   * const streamingTool = new FunctionTool({
   *   name: 'streaming_search',
   *   description: 'Streams search results',
   *   parameters: z.object({ query: z.string() }),
   *   response: z.string(),  // Specify yield type
   *   execute: async function* (args) {
   *     yield 'result 1';
   *     yield 'result 2';
   *   },
   * });
   *
   * // Regular tool with structured response
   * const regularTool = new FunctionTool({
   *   name: 'get_weather',
   *   description: 'Gets weather for a location',
   *   parameters: z.object({ location: z.string() }),
   *   response: z.object({
   *     temperature: z.number(),
   *     conditions: z.string(),
   *   }),
   *   execute: async (args) => ({
   *     temperature: 72,
   *     conditions: 'sunny',
   *   }),
   * });
   * ```
   */
  response?: ToolResponseSchema;
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

/**
 * Converts a response schema (Zod type or raw Schema) to a Google GenAI Schema.
 * Returns undefined if no response schema is provided.
 */
function toResponseSchema(
  response: ToolResponseSchema | undefined,
): Schema | undefined {
  if (response === undefined) {
    return undefined;
  }

  if (isZodType(response)) {
    return zodTypeToSchema(response);
  }

  // Raw Schema
  return response;
}

export class FunctionTool<
  TParameters extends ToolInputParameters = undefined,
> extends BaseTool {
  // User defined function.
  private readonly execute: ToolExecuteFunction<TParameters>;
  // Typed input parameters.
  private readonly parameters?: TParameters;
  // Response schema for tool output.
  private readonly response?: ToolResponseSchema;
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
    this.response = options.response;
    this.requireConfirmation = options.requireConfirmation;
  }

  /**
   * Provide a schema for the function.
   * Includes the response schema if specified, which is particularly useful
   * for streaming tools to describe the yield type.
   */
  override _getDeclaration(): FunctionDeclaration {
    const responseSchema = toResponseSchema(this.response);
    return {
      name: this.name,
      description: this.description,
      parameters: toSchema(this.parameters),
      ...(responseSchema && {response: responseSchema}),
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

  /**
   * Checks if this tool's execute function is an async generator function.
   * Async generator functions are used for streaming tool execution.
   */
  get isStreamingFunction(): boolean {
    return isAsyncGeneratorFunction(this.execute);
  }

  /**
   * Executes the tool in live/streaming mode for async generator functions.
   *
   * This method is called for streaming tool execution in bidirectional
   * streaming scenarios. It:
   * 1. Injects the input_stream parameter if the tool is registered in activeStreamingTools
   * 2. Yields results as they become available from the async generator
   *
   * @param request The request to run the tool in live mode.
   * @yields Results as they become available during streaming.
   */
  override async *_callLive(request: CallLiveToolRequest): AsyncGenerator<unknown> {
    const {args, toolContext, invocationContext} = request;

    // Validate and parse arguments
    let validatedArgs: unknown = args;
    if (this.parameters instanceof ZodObject) {
      validatedArgs = this.parameters.parse(args);
    }

    // Check if we need to inject input_stream for bidirectional streaming
    const activeStreamingTools = invocationContext.activeStreamingTools;
    let inputStream: LiveRequestQueue | undefined;
    if (
      activeStreamingTools &&
      this.name in activeStreamingTools &&
      activeStreamingTools[this.name].stream
    ) {
      inputStream = activeStreamingTools[this.name].stream;
    }

    // Call the execute function with tool context and optional input stream
    // Note: For async generator functions, the signature may include input_stream
    const executeWithStream = this.execute as (
      input: unknown,
      toolContext: ToolContext,
      inputStream?: LiveRequestQueue,
    ) => AsyncGenerator<unknown>;

    const generator = executeWithStream(
      validatedArgs as ToolExecuteArgument<TParameters>,
      toolContext,
      inputStream,
    );

    // Use Aclosing for proper cleanup of the async generator
    const aclosing = new Aclosing(generator as AsyncGenerator<unknown>);
    for await (const item of aclosing) {
      yield item;
    }
  }
}
