/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Anthropic integration for Claude models.
 *
 * This module provides integration with Claude models via the Anthropic API
 * and Claude models served from Google Cloud Vertex AI.
 */

import {Content, FinishReason, FunctionDeclaration, GenerateContentResponseUsageMetadata, Part, Tool, ToolUnion} from '@google/genai';

import {logger} from '../utils/logger.js';

import {BaseLlm} from './base_llm.js';
import {BaseLlmConnection} from './base_llm_connection.js';
import {LlmRequest} from './llm_request.js';
import {LlmResponse} from './llm_response.js';

// Type definitions for Anthropic SDK - dynamically imported
// These mirror the key types from @anthropic-ai/sdk
interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: AnthropicContentBlock[];
}

interface AnthropicTextBlockParam {
  type: 'text';
  text: string;
}

interface AnthropicImageBlockParam {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

interface AnthropicToolUseBlockParam {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicToolResultBlockParam {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

type AnthropicContentBlock =
  | AnthropicTextBlockParam
  | AnthropicImageBlockParam
  | AnthropicToolUseBlockParam
  | AnthropicToolResultBlockParam;

interface AnthropicToolParam {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

interface AnthropicToolChoiceAutoParam {
  type: 'auto';
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

type AnthropicResponseContentBlock = AnthropicTextBlock | AnthropicToolUseBlock;

interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

interface AnthropicMessage {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicResponseContentBlock[];
  model: string;
  stop_reason: string | null;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

// Placeholder for NOT_GIVEN sentinel value
const NOT_GIVEN = Symbol('NOT_GIVEN');
type NotGiven = typeof NOT_GIVEN;

/**
 * Parameters for creating an AnthropicLlm instance.
 */
export interface AnthropicLlmParams {
  /**
   * The name of the Claude model.
   * Defaults to 'claude-sonnet-4-20250514' for direct API access.
   */
  model?: string;

  /**
   * The maximum number of tokens to generate.
   * Defaults to 8192.
   */
  maxTokens?: number;

  /**
   * The Anthropic API key. If not provided, it will look for
   * the ANTHROPIC_API_KEY environment variable.
   */
  apiKey?: string;
}

/**
 * Parameters for creating a Claude (Vertex AI) instance.
 */
export interface ClaudeParams extends AnthropicLlmParams {
  /**
   * The Google Cloud project ID. If not provided, it will look for
   * the GOOGLE_CLOUD_PROJECT environment variable.
   */
  project?: string;

  /**
   * The Google Cloud location/region. If not provided, it will look for
   * the GOOGLE_CLOUD_LOCATION environment variable.
   */
  location?: string;
}

/**
 * Converts a Google GenAI role to an Anthropic role.
 *
 * @param role - The Google GenAI role (e.g., 'user', 'model', 'assistant')
 * @returns The corresponding Anthropic role ('user' or 'assistant')
 */
export function toClaudeRole(
  role: string | undefined
): 'user' | 'assistant' {
  if (role === 'model' || role === 'assistant') {
    return 'assistant';
  }
  return 'user';
}

/**
 * Converts an Anthropic stop reason to a Google GenAI finish reason.
 *
 * @param anthropicStopReason - The Anthropic stop reason
 * @returns The corresponding Google GenAI FinishReason
 */
export function toGoogleGenaiFinishReason(
  anthropicStopReason: string | null | undefined
): FinishReason {
  if (
    anthropicStopReason === 'end_turn' ||
    anthropicStopReason === 'stop_sequence' ||
    anthropicStopReason === 'tool_use'
  ) {
    return 'STOP' as FinishReason;
  }
  if (anthropicStopReason === 'max_tokens') {
    return 'MAX_TOKENS' as FinishReason;
  }
  return 'FINISH_REASON_UNSPECIFIED' as FinishReason;
}

/**
 * Checks if a Part contains image data.
 *
 * @param part - The Part to check
 * @returns True if the part contains image data
 */
function isImagePart(part: Part): boolean {
  return !!(
    part.inlineData &&
    part.inlineData.mimeType &&
    part.inlineData.mimeType.startsWith('image')
  );
}

/**
 * Type guard to check if a Tool has functionDeclarations.
 */
function hasToolFunctionDeclarations(tool: ToolUnion): tool is Tool & {functionDeclarations: FunctionDeclaration[]} {
  return typeof tool === 'object' && tool !== null && 'functionDeclarations' in tool && Array.isArray((tool as Tool).functionDeclarations);
}

/**
 * Converts a Google GenAI Part to an Anthropic content block.
 *
 * Handles conversion of:
 * - Text parts
 * - Function calls (tool use)
 * - Function responses (tool results)
 * - Image data (base64 encoded)
 * - Executable code (converted to text)
 * - Code execution results (converted to text)
 *
 * @param part - The Google GenAI Part to convert
 * @returns The corresponding Anthropic content block
 * @throws If the part type is not supported
 */
export function partToMessageBlock(
  part: Part
): AnthropicContentBlock {
  if (part.text) {
    return {
      type: 'text',
      text: part.text,
    };
  } else if (part.functionCall) {
    if (!part.functionCall.name) {
      throw new Error('Function call must have a name');
    }

    return {
      type: 'tool_use',
      id: part.functionCall.id || '',
      name: part.functionCall.name,
      input: (part.functionCall.args || {}) as Record<string, unknown>,
    };
  } else if (part.functionResponse) {
    let content = '';
    const responseData = part.functionResponse.response as Record<string, unknown>;

    // Handle response with content array
    if (responseData && 'content' in responseData && Array.isArray(responseData.content)) {
      const contentItems: string[] = [];
      for (const item of responseData.content) {
        if (typeof item === 'object' && item !== null) {
          // Handle text content blocks
          if (
            (item as Record<string, unknown>).type === 'text' &&
            'text' in (item as Record<string, unknown>)
          ) {
            contentItems.push(String((item as Record<string, unknown>).text));
          } else {
            // Handle other structured content
            contentItems.push(JSON.stringify(item));
          }
        } else {
          contentItems.push(String(item));
        }
      }
      content = contentItems.length > 0 ? contentItems.join('\n') : '';
    }
    // Handle traditional result format
    else if (responseData && 'result' in responseData && responseData.result) {
      // Convert to string to prevent Anthropic BadRequestError
      content = String(responseData.result);
    }

    return {
      type: 'tool_result',
      tool_use_id: part.functionResponse.id || '',
      content,
      is_error: false,
    };
  } else if (isImagePart(part)) {
    // Handle image data - ensure it's base64 encoded
    let data: string;
    const inlineData = part.inlineData!;

    if (typeof inlineData.data === 'string') {
      data = inlineData.data;
    } else if (inlineData.data) {
      // Convert Uint8Array or ArrayBuffer to base64
      // Use type assertion since the SDK types may be ambiguous
      const rawData = inlineData.data as unknown;
      const uint8Array = rawData instanceof Uint8Array
        ? rawData
        : new Uint8Array(rawData as ArrayBuffer);
      data = Buffer.from(uint8Array).toString('base64');
    } else {
      throw new Error('Image data is missing');
    }

    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: inlineData.mimeType!,
        data,
      },
    };
  } else if (part.executableCode) {
    return {
      type: 'text',
      text: `Code:\`\`\`python\n${part.executableCode.code}\n\`\`\``,
    };
  } else if (part.codeExecutionResult) {
    return {
      type: 'text',
      text: `Execution Result:\`\`\`code_output\n${part.codeExecutionResult.output}\n\`\`\``,
    };
  }

  throw new Error(`Unsupported part type: ${JSON.stringify(part)}`);
}

/**
 * Converts a Google GenAI Content to an Anthropic MessageParam.
 *
 * @param content - The Google GenAI Content to convert
 * @returns The corresponding Anthropic MessageParam
 */
export function contentToMessageParam(
  content: Content
): AnthropicMessageParam {
  const messageBlocks: AnthropicContentBlock[] = [];

  for (const part of content.parts || []) {
    // Image data is not supported in Claude for assistant turns
    if (content.role !== 'user' && isImagePart(part)) {
      logger.warn(
        'Image data is not supported in Claude for assistant turns.'
      );
      continue;
    }

    messageBlocks.push(partToMessageBlock(part));
  }

  return {
    role: toClaudeRole(content.role),
    content: messageBlocks,
  };
}

/**
 * Converts an Anthropic content block to a Google GenAI Part.
 *
 * @param contentBlock - The Anthropic content block to convert
 * @returns The corresponding Google GenAI Part
 * @throws If the content block type is not supported
 */
export function contentBlockToPart(
  contentBlock: AnthropicResponseContentBlock
): Part {
  if (contentBlock.type === 'text') {
    return {text: contentBlock.text};
  }
  if (contentBlock.type === 'tool_use') {
    return {
      functionCall: {
        id: contentBlock.id,
        name: contentBlock.name,
        args: contentBlock.input,
      },
    };
  }
  // TypeScript exhaustiveness check - this should never happen
  const _exhaustiveCheck: never = contentBlock;
  throw new Error(`Unsupported content block type: ${(_exhaustiveCheck as {type: string}).type}`);
}

/**
 * Converts an Anthropic Message to an LlmResponse.
 *
 * @param message - The Anthropic Message to convert
 * @returns The corresponding LlmResponse
 */
export function messageToLlmResponse(
  message: AnthropicMessage
): LlmResponse {
  logger.info('Received response from Claude.');
  logger.debug(`Claude response: ${JSON.stringify(message, null, 2)}`);

  const parts = message.content.map((cb) => contentBlockToPart(cb));

  const usageMetadata: GenerateContentResponseUsageMetadata = {
    promptTokenCount: message.usage.input_tokens,
    candidatesTokenCount: message.usage.output_tokens,
    totalTokenCount:
      message.usage.input_tokens + message.usage.output_tokens,
  };

  return {
    content: {
      role: 'model',
      parts,
    },
    usageMetadata,
    finishReason: toGoogleGenaiFinishReason(message.stop_reason),
  };
}

/**
 * Updates 'type' fields in a schema to expected JSON schema format (lowercase).
 * Recursively processes nested properties and items.
 *
 * @param valueDict - The schema object to update
 */
function updateTypeString(valueDict: Record<string, unknown>): void {
  if ('type' in valueDict && typeof valueDict.type === 'string') {
    valueDict.type = valueDict.type.toLowerCase();
  }

  if ('items' in valueDict && typeof valueDict.items === 'object' && valueDict.items !== null) {
    const items = valueDict.items as Record<string, unknown>;
    updateTypeString(items);

    if ('properties' in items && typeof items.properties === 'object' && items.properties !== null) {
      const properties = items.properties as Record<string, Record<string, unknown>>;
      for (const key in properties) {
        updateTypeString(properties[key]);
      }
    }
  }

  if ('properties' in valueDict && typeof valueDict.properties === 'object' && valueDict.properties !== null) {
    const properties = valueDict.properties as Record<string, Record<string, unknown>>;
    for (const key in properties) {
      updateTypeString(properties[key]);
    }
  }
}

/**
 * Converts a Google GenAI FunctionDeclaration to an Anthropic ToolParam.
 *
 * @param functionDeclaration - The function declaration to convert
 * @returns The corresponding Anthropic ToolParam
 * @throws If the function declaration has no name
 */
export function functionDeclarationToToolParam(
  functionDeclaration: FunctionDeclaration
): AnthropicToolParam {
  if (!functionDeclaration.name) {
    throw new Error('Function declaration must have a name');
  }

  let inputSchema: Record<string, unknown>;

  // Use parametersJsonSchema if available, otherwise convert from parameters
  if (functionDeclaration.parametersJsonSchema) {
    inputSchema = functionDeclaration.parametersJsonSchema as Record<string, unknown>;
  } else {
    const properties: Record<string, unknown> = {};
    const requiredParams: string[] = [];

    if (functionDeclaration.parameters) {
      if (functionDeclaration.parameters.properties) {
        for (const [key, value] of Object.entries(
          functionDeclaration.parameters.properties
        )) {
          // Create a copy of the value and normalize type strings
          const valueDict = JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
          updateTypeString(valueDict);
          properties[key] = valueDict;
        }
      }
      if (functionDeclaration.parameters.required) {
        requiredParams.push(...functionDeclaration.parameters.required);
      }
    }

    inputSchema = {
      type: 'object',
      properties,
    };

    if (requiredParams.length > 0) {
      inputSchema.required = requiredParams;
    }
  }

  return {
    name: functionDeclaration.name,
    description: functionDeclaration.description || '',
    input_schema: inputSchema,
  };
}

/**
 * Integration with Claude models via the Anthropic API.
 *
 * This class provides integration with Claude models through the direct
 * Anthropic API. For Claude models served from Google Cloud Vertex AI,
 * use the {@link Claude} class instead.
 *
 * @example
 * ```typescript
 * const llm = new AnthropicLlm({
 *   model: 'claude-sonnet-4-20250514',
 *   maxTokens: 4096,
 * });
 *
 * const response = await llm.generateContentAsync(llmRequest);
 * ```
 */
export class AnthropicLlm extends BaseLlm {
  /**
   * The maximum number of tokens to generate.
   */
  readonly maxTokens: number;

  /**
   * The Anthropic API key.
   */
  protected readonly apiKey?: string;

  /**
   * Cached Anthropic client instance.
   */
  protected _client: unknown;

  /**
   * List of supported model patterns.
   * Matches Claude 3.x models (claude-3-*) and Claude 4.x models (claude-*-4*).
   */
  static override readonly supportedModels: Array<string | RegExp> = [
    /claude-3-.*/,
    /claude-.*-4.*/,
  ];

  constructor({model, maxTokens, apiKey}: AnthropicLlmParams = {}) {
    const resolvedModel = model || 'claude-sonnet-4-20250514';
    super({model: resolvedModel});

    this.maxTokens = maxTokens || 8192;
    this.apiKey = apiKey;
  }

  /**
   * Gets or creates the Anthropic client instance.
   * Uses dynamic import to avoid requiring the SDK at module load time.
   *
   * @returns Promise resolving to the Anthropic client
   */
  protected async getAnthropicClient(): Promise<unknown> {
    if (this._client) {
      return this._client;
    }

    try {
      // Dynamic import of Anthropic SDK
      // The SDK is an optional peer dependency, so we use dynamic import
      const anthropicModule = await import('@anthropic-ai/sdk');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const Anthropic = (anthropicModule as any).default || (anthropicModule as any).Anthropic;

      this._client = new Anthropic({
        apiKey: this.apiKey,
      });

      return this._client;
    } catch (error) {
      throw new Error(
        'Anthropic SDK is required for AnthropicLlm. ' +
          'Please install it with: npm install @anthropic-ai/sdk\n' +
          `Original error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Generates content using the Claude model.
   *
   * @param llmRequest - The LLM request containing messages and configuration
   * @param stream - Whether to stream the response (note: streaming not yet implemented)
   * @yields LlmResponse objects containing the model's response
   */
  override async *generateContentAsync(
    llmRequest: LlmRequest,
    stream = false
  ): AsyncGenerator<LlmResponse, void> {
    // Convert contents to Anthropic message format
    const messages: AnthropicMessageParam[] = [];
    for (const content of llmRequest.contents || []) {
      messages.push(contentToMessageParam(content));
    }

    // Process tools if available
    let tools: AnthropicToolParam[] | NotGiven = NOT_GIVEN;
    if (
      llmRequest.config?.tools &&
      llmRequest.config.tools.length > 0
    ) {
      const firstTool = llmRequest.config.tools[0];
      if (hasToolFunctionDeclarations(firstTool)) {
        tools = firstTool.functionDeclarations.map(
          (tool: FunctionDeclaration) => functionDeclarationToToolParam(tool)
        );
      }
    }

    // Set tool choice
    let toolChoice: AnthropicToolChoiceAutoParam | NotGiven = NOT_GIVEN;
    if (Object.keys(llmRequest.toolsDict || {}).length > 0) {
      toolChoice = {type: 'auto'};
    }

    // Get system instruction
    const systemInstruction =
      typeof llmRequest.config?.systemInstruction === 'string'
        ? llmRequest.config.systemInstruction
        : '';

    // Get the client
    const client = (await this.getAnthropicClient()) as {
      messages: {
        create: (params: {
          model: string;
          system: string;
          messages: AnthropicMessageParam[];
          tools?: AnthropicToolParam[];
          tool_choice?: AnthropicToolChoiceAutoParam;
          max_tokens: number;
        }) => Promise<AnthropicMessage>;
      };
    };

    // Note: Streaming is not yet implemented for Anthropic models
    // (matching Python TODO: b/421255973)
    if (stream) {
      logger.warn('Streaming is not yet supported for Anthropic models. Falling back to non-streaming.');
    }

    // Make the API call
    const createParams: {
      model: string;
      system: string;
      messages: AnthropicMessageParam[];
      tools?: AnthropicToolParam[];
      tool_choice?: AnthropicToolChoiceAutoParam;
      max_tokens: number;
    } = {
      model: llmRequest.model || this.model,
      system: systemInstruction,
      messages,
      max_tokens: this.maxTokens,
    };

    // Only add tools and tool_choice if they're set
    if (tools !== NOT_GIVEN) {
      createParams.tools = tools;
    }
    if (toolChoice !== NOT_GIVEN) {
      createParams.tool_choice = toolChoice;
    }

    const message = await client.messages.create(createParams);

    yield messageToLlmResponse(message);
  }

  /**
   * Creates a live connection to the LLM.
   * Note: Live connections are not supported for Anthropic models.
   *
   * @throws Always throws as live connections are not supported
   */
  override async connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error('Live connections are not supported for Anthropic models.');
  }
}

/**
 * Integration with Claude models served from Google Cloud Vertex AI.
 *
 * This class extends {@link AnthropicLlm} to use the Anthropic SDK's
 * Vertex AI integration, which routes requests through Google Cloud
 * infrastructure for enhanced security and compliance.
 *
 * @example
 * ```typescript
 * // Using environment variables
 * // Set GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION
 * const llm = new Claude({
 *   model: 'claude-3-5-sonnet-v2@20241022',
 * });
 *
 * // Or provide project and location directly
 * const llm = new Claude({
 *   model: 'claude-3-5-sonnet-v2@20241022',
 *   project: 'my-project',
 *   location: 'us-east5',
 * });
 * ```
 */
export class Claude extends AnthropicLlm {
  /**
   * The Google Cloud project ID.
   */
  private readonly project?: string;

  /**
   * The Google Cloud location/region.
   */
  private readonly location?: string;

  /**
   * List of supported model patterns for Vertex AI Claude models.
   * Matches Vertex AI model naming patterns (e.g., claude-3-5-sonnet-v2@20241022).
   */
  static override readonly supportedModels: Array<string | RegExp> = [
    /claude-3-.*@.*/,
    /claude-.*-4.*@.*/,
  ];

  constructor({model, maxTokens, project, location}: ClaudeParams = {}) {
    const resolvedModel = model || 'claude-3-5-sonnet-v2@20241022';
    super({model: resolvedModel, maxTokens});

    // Resolve project and location from environment if not provided
    const canReadEnv = typeof process === 'object';

    this.project = project;
    this.location = location;

    if (!this.project && canReadEnv) {
      this.project = process.env['GOOGLE_CLOUD_PROJECT'];
    }
    if (!this.location && canReadEnv) {
      this.location = process.env['GOOGLE_CLOUD_LOCATION'];
    }

    // Validate required parameters
    if (!this.project || !this.location) {
      throw new Error(
        'GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION must be set for using ' +
          'Anthropic on Vertex AI. Set them via constructor or environment variables.'
      );
    }
  }

  /**
   * Gets or creates the Anthropic Vertex AI client instance.
   * Uses dynamic import to avoid requiring the SDK at module load time.
   *
   * @returns Promise resolving to the Anthropic Vertex AI client
   */
  protected override async getAnthropicClient(): Promise<unknown> {
    if (this._client) {
      return this._client;
    }

    try {
      // Dynamic import of Anthropic SDK
      // The SDK is an optional peer dependency, so we use dynamic import
      const anthropicModule = await import('@anthropic-ai/sdk');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const am = anthropicModule as any;
      const AnthropicVertex =
        am.AnthropicVertex ||
        (am.default && am.default.AnthropicVertex);

      if (!AnthropicVertex) {
        throw new Error('AnthropicVertex class not found in @anthropic-ai/sdk');
      }

      this._client = new AnthropicVertex({
        projectId: this.project,
        region: this.location,
      });

      return this._client;
    } catch (error) {
      throw new Error(
        'Anthropic SDK is required for Claude on Vertex AI. ' +
          'Please install it with: npm install @anthropic-ai/sdk\n' +
          `Original error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
