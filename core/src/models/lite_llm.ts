/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * LiteLLM integration for model-agnostic support.
 *
 * This module provides integration with 100+ LLM providers through LiteLLM,
 * supporting providers like OpenAI, Azure, Groq, Anthropic, and more.
 */

import {
  Content,
  FinishReason,
  FunctionDeclaration,
  GenerateContentResponseUsageMetadata,
  Part,
  Tool,
  ToolUnion,
} from '@google/genai';

import {logger} from '../utils/logger.js';

import {BaseLlm} from './base_llm.js';
import {BaseLlmConnection} from './base_llm_connection.js';
import {LlmRequest} from './llm_request.js';
import {LlmResponse} from './llm_response.js';

// ============================================================================
// Type definitions for LiteLLM SDK - dynamically imported
// ============================================================================

/** LiteLLM message types */
interface LiteLLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | LiteLLMContentBlock[] | null;
  tool_calls?: LiteLLMToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

interface LiteLLMContentBlock {
  type: 'text' | 'image_url' | 'video_url' | 'audio_url' | 'file';
  text?: string;
  image_url?: {url: string};
  video_url?: {url: string};
  audio_url?: {url: string};
  file?: {file_id?: string; file_data?: string; format?: string};
}

interface LiteLLMToolCall {
  type: 'function';
  id: string;
  function: {
    name: string;
    arguments: string;
  };
  index?: number;
}

interface LiteLLMFunction {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

interface LiteLLMTool {
  type: 'function';
  function: LiteLLMFunction;
}

interface LiteLLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
  cached_prompt_tokens?: number;
  cached_tokens?: number;
}

interface LiteLLMChoice {
  message?: LiteLLMMessage;
  delta?: LiteLLMMessage;
  finish_reason?: string | null;
}

interface LiteLLMResponse {
  choices: LiteLLMChoice[];
  usage?: LiteLLMUsage;
  model?: string;
}

// ============================================================================
// Constants
// ============================================================================

const NEW_LINE = '\n';

/**
 * Mapping of LiteLLM finish_reason strings to FinishReason enum values.
 * Note: tool_calls/function_call map to STOP because:
 * 1. FinishReason.TOOL_CALL enum does not exist
 * 2. Tool calls represent normal completion (model stopped to invoke tools)
 * 3. Gemini native responses use STOP for tool calls
 */
const FINISH_REASON_MAPPING: Record<string, FinishReason> = {
  length: 'MAX_TOKENS' as FinishReason,
  stop: 'STOP' as FinishReason,
  tool_calls: 'STOP' as FinishReason,
  function_call: 'STOP' as FinishReason,
  content_filter: 'SAFETY' as FinishReason,
};

/** File MIME types supported for upload as file content. */
const SUPPORTED_FILE_CONTENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/json',
  'application/x-sh',
]);

/** Providers that require file_id instead of inline file_data. */
const FILE_ID_REQUIRED_PROVIDERS = new Set(['openai', 'azure']);

const MISSING_TOOL_RESULT_MESSAGE =
  'Error: Missing tool result (tool execution may have been interrupted ' +
  'before a response was recorded).';

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Maps a LiteLLM finish_reason value to a google-genai FinishReason enum.
 */
function mapFinishReason(
  finishReason: string | null | undefined
): FinishReason | undefined {
  if (!finishReason) {
    return undefined;
  }
  const finishReasonStr = String(finishReason).toLowerCase();
  return FINISH_REASON_MAPPING[finishReasonStr] || ('OTHER' as FinishReason);
}

/**
 * Extracts the provider name from a LiteLLM model string.
 */
export function getProviderFromModel(model: string): string {
  if (!model) {
    return '';
  }
  // LiteLLM uses "provider/model" format
  if (model.includes('/')) {
    const [provider] = model.split('/', 1);
    return provider.toLowerCase();
  }
  // Fallback heuristics for common patterns
  const modelLower = model.toLowerCase();
  if (modelLower.includes('azure')) {
    return 'azure';
  }
  if (modelLower.startsWith('gpt-') || modelLower.startsWith('o1')) {
    return 'openai';
  }
  return '';
}

/**
 * Checks if the model is a Gemini model accessed via LiteLLM.
 */
function isLiteLLMGeminiModel(modelString: string): boolean {
  return (
    modelString.startsWith('gemini/gemini-') ||
    modelString.startsWith('vertex_ai/gemini-')
  );
}

/**
 * Extracts the pure Gemini model name from a LiteLLM model string.
 */
function extractGeminiModelFromLiteLLM(litellmModel: string): string {
  if (litellmModel.includes('/')) {
    return litellmModel.split('/', 2)[1];
  }
  return litellmModel;
}

/**
 * Warn if Gemini is being used via LiteLLM.
 */
function warnGeminiViaLiteLLM(modelString: string): void {
  if (!isLiteLLMGeminiModel(modelString)) {
    return;
  }

  // Check if warning should be suppressed via environment variable
  const canReadEnv = typeof process === 'object';
  if (canReadEnv) {
    const suppressWarning =
      process.env['ADK_SUPPRESS_GEMINI_LITELLM_WARNINGS'] || '';
    if (['1', 'true', 'yes', 'on'].includes(suppressWarning.toLowerCase())) {
      return;
    }
  }

  logger.warn(
    `[GEMINI_VIA_LITELLM] ${modelString}: You are using Gemini via LiteLLM. ` +
      `For better performance, reliability, and access to latest features, ` +
      `consider using Gemini directly through ADK's native Gemini integration. ` +
      `Replace LiteLlm(model='${modelString}') with ` +
      `Gemini(model='${extractGeminiModelFromLiteLLM(modelString)}'). ` +
      `Set ADK_SUPPRESS_GEMINI_LITELLM_WARNINGS=true to suppress this warning.`
  );
}

/**
 * Returns True when file_uri should not be sent as a file content block.
 */
function requiresFileUriFallback(
  provider: string,
  model: string,
  fileUri: string
): boolean {
  // OpenAI/Azure require file_id from uploaded file
  if (FILE_ID_REQUIRED_PROVIDERS.has(provider)) {
    return !fileUri.startsWith('file-');
  }
  // Anthropic doesn't support file URIs
  if (provider === 'anthropic') {
    return true;
  }
  // Vertex AI only supports file URIs for Gemini models
  if (provider === 'vertex_ai' && !isLiteLLMGeminiModel(model)) {
    return true;
  }
  return false;
}

/**
 * Converts a types.Content role to a LiteLLM role.
 */
function toLiteLLMRole(
  role: string | undefined
): 'user' | 'assistant' | 'system' {
  if (role === 'model' || role === 'assistant') {
    return 'assistant';
  }
  return 'user';
}

/**
 * Recursively converts a schema object to a pure-python dict.
 */
function schemaToDict(schema: Record<string, unknown>): Record<string, unknown> {
  const schemaDict = {...schema};

  // Handle enum values
  const enumValues = schemaDict.enum;
  if (Array.isArray(enumValues)) {
    schemaDict.enum = enumValues.filter((v) => v !== null);
  }

  // Normalize type field to lowercase
  if ('type' in schemaDict && schemaDict.type !== null) {
    const t = schemaDict.type;
    schemaDict.type = String(t).toLowerCase();
  }

  // Handle items
  if ('items' in schemaDict && typeof schemaDict.items === 'object') {
    schemaDict.items = schemaToDict(schemaDict.items as Record<string, unknown>);
  }

  // Handle properties
  if (
    'properties' in schemaDict &&
    typeof schemaDict.properties === 'object'
  ) {
    const properties = schemaDict.properties as Record<
      string,
      Record<string, unknown>
    >;
    const newProps: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(properties)) {
      if (typeof value === 'object' && value !== null) {
        newProps[key] = schemaToDict(value as Record<string, unknown>);
      } else {
        newProps[key] = value;
      }
    }
    schemaDict.properties = newProps;
  }

  return schemaDict;
}

/**
 * Converts a FunctionDeclaration to a LiteLLM tool parameter.
 */
export function functionDeclarationToToolParam(
  functionDeclaration: FunctionDeclaration
): LiteLLMTool {
  if (!functionDeclaration.name) {
    throw new Error('Function declaration must have a name');
  }

  let parameters: Record<string, unknown> = {
    type: 'object',
    properties: {},
  };

  if (
    functionDeclaration.parameters &&
    functionDeclaration.parameters.properties
  ) {
    const properties: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      functionDeclaration.parameters.properties
    )) {
      properties[key] = schemaToDict(
        value as unknown as Record<string, unknown>
      );
    }

    parameters = {
      type: 'object',
      properties,
    };
  } else if (functionDeclaration.parametersJsonSchema) {
    parameters = functionDeclaration.parametersJsonSchema as Record<
      string,
      unknown
    >;
  }

  // Add required fields if present
  const requiredFields = functionDeclaration.parameters?.required;
  if (requiredFields && requiredFields.length > 0) {
    parameters.required = requiredFields;
  }

  return {
    type: 'function',
    function: {
      name: functionDeclaration.name,
      description: functionDeclaration.description || '',
      parameters,
    },
  };
}

/**
 * Safely serializes any value to JSON string.
 */
function safeJsonSerialize(obj: unknown): string {
  try {
    return JSON.stringify(obj);
  } catch {
    return String(obj);
  }
}

/**
 * Extracts cached prompt tokens from LiteLLM usage.
 */
function extractCachedPromptTokens(usage: LiteLLMUsage): number {
  // Try prompt_tokens_details.cached_tokens first
  if (
    usage.prompt_tokens_details &&
    typeof usage.prompt_tokens_details.cached_tokens === 'number'
  ) {
    return usage.prompt_tokens_details.cached_tokens;
  }

  // Try cached_prompt_tokens
  if (typeof usage.cached_prompt_tokens === 'number') {
    return usage.cached_prompt_tokens;
  }

  // Try cached_tokens
  if (typeof usage.cached_tokens === 'number') {
    return usage.cached_tokens;
  }

  return 0;
}

/**
 * Iterates text fragments from provider-specific reasoning payloads.
 */
function* iterReasoningTexts(
  reasoningValue: unknown
): Generator<string, void, void> {
  if (reasoningValue === null || reasoningValue === undefined) {
    return;
  }

  if (typeof reasoningValue === 'string') {
    yield reasoningValue;
    return;
  }

  if (Array.isArray(reasoningValue)) {
    for (const value of reasoningValue) {
      yield* iterReasoningTexts(value);
    }
    return;
  }

  if (typeof reasoningValue === 'object') {
    const obj = reasoningValue as Record<string, unknown>;
    // Check known keys for reasoning text
    for (const key of ['text', 'content', 'reasoning', 'reasoning_content']) {
      const textValue = obj[key];
      if (typeof textValue === 'string') {
        yield textValue;
      }
    }
    return;
  }

  if (
    typeof reasoningValue === 'number' ||
    typeof reasoningValue === 'boolean'
  ) {
    yield String(reasoningValue);
  }
}

/**
 * Converts provider reasoning payloads into Gemini thought parts.
 */
function convertReasoningValueToParts(reasoningValue: unknown): Part[] {
  const parts: Part[] = [];
  for (const text of iterReasoningTexts(reasoningValue)) {
    if (text) {
      parts.push({text, thought: true});
    }
  }
  return parts;
}

/**
 * Extracts the reasoning payload from a LiteLLM message.
 */
function extractReasoningValue(message: LiteLLMMessage | undefined): unknown {
  if (!message) {
    return null;
  }
  return message.reasoning_content || null;
}

/**
 * Type guard to check if a Tool has functionDeclarations.
 */
function hasToolFunctionDeclarations(
  tool: ToolUnion
): tool is Tool & {functionDeclarations: FunctionDeclaration[]} {
  return (
    typeof tool === 'object' &&
    tool !== null &&
    'functionDeclarations' in tool &&
    Array.isArray((tool as Tool).functionDeclarations)
  );
}

// ============================================================================
// Content conversion functions
// ============================================================================

/**
 * Converts Google GenAI Parts to LiteLLM content blocks.
 */
function getContent(
  parts: Part[],
  provider: string,
  model: string
): string | LiteLLMContentBlock[] | null {
  if (!parts || parts.length === 0) {
    return null;
  }

  // Single text part case - return as string for better compatibility
  if (parts.length === 1) {
    const part = parts[0];
    if (part.text) {
      return part.text;
    }
    if (
      part.inlineData?.data &&
      part.inlineData.mimeType?.startsWith('text/')
    ) {
      // Decode base64 text content
      const data = part.inlineData.data;
      if (typeof data === 'string') {
        return Buffer.from(data, 'base64').toString('utf-8');
      }
    }
  }

  const contentObjects: LiteLLMContentBlock[] = [];

  for (const part of parts) {
    // Skip thought parts for user messages
    if (part.thought) {
      continue;
    }

    if (part.text) {
      contentObjects.push({
        type: 'text',
        text: part.text,
      });
    } else if (part.inlineData?.data && part.inlineData.mimeType) {
      const mimeType = part.inlineData.mimeType;

      // Handle text/* MIME types
      if (mimeType.startsWith('text/')) {
        const data = part.inlineData.data;
        let decodedText: string;
        if (typeof data === 'string') {
          decodedText = Buffer.from(data, 'base64').toString('utf-8');
        } else {
          decodedText = Buffer.from(data).toString('utf-8');
        }
        contentObjects.push({
          type: 'text',
          text: decodedText,
        });
        continue;
      }

      // Create base64 data URI
      const base64String =
        typeof part.inlineData.data === 'string'
          ? part.inlineData.data
          : Buffer.from(part.inlineData.data).toString('base64');
      const dataUri = `data:${mimeType};base64,${base64String}`;

      if (mimeType.startsWith('image')) {
        contentObjects.push({
          type: 'image_url',
          image_url: {url: dataUri},
        });
      } else if (mimeType.startsWith('video')) {
        contentObjects.push({
          type: 'video_url',
          video_url: {url: dataUri},
        });
      } else if (mimeType.startsWith('audio')) {
        contentObjects.push({
          type: 'audio_url',
          audio_url: {url: dataUri},
        });
      } else if (SUPPORTED_FILE_CONTENT_MIME_TYPES.has(mimeType)) {
        contentObjects.push({
          type: 'file',
          file: {file_data: dataUri},
        });
      } else {
        throw new Error(
          `LiteLlm does not support content part with MIME type ${mimeType}.`
        );
      }
    } else if (part.fileData?.fileUri) {
      const fileUri = part.fileData.fileUri;

      // Handle OpenAI file IDs
      if (
        FILE_ID_REQUIRED_PROVIDERS.has(provider) &&
        fileUri.startsWith('file-')
      ) {
        contentObjects.push({
          type: 'file',
          file: {file_id: fileUri},
        });
        continue;
      }

      // Check if file URI requires fallback to text
      if (requiresFileUriFallback(provider, model, fileUri)) {
        const identifier = part.fileData.displayName || fileUri;
        contentObjects.push({
          type: 'text',
          text: `[File reference: "${identifier}"]`,
        });
        continue;
      }

      // Use file URI directly
      const mimeType = part.fileData.mimeType || 'application/octet-stream';
      contentObjects.push({
        type: 'file',
        file: {
          file_id: fileUri,
          format: mimeType,
        },
      });
    }
  }

  return contentObjects.length > 0 ? contentObjects : null;
}

/**
 * Converts a Google GenAI Content to LiteLLM message(s).
 */
export function contentToMessageParam(
  content: Content,
  provider: string,
  model: string
): LiteLLMMessage | LiteLLMMessage[] {
  const toolMessages: LiteLLMMessage[] = [];
  const nonToolParts: Part[] = [];

  for (const part of content.parts || []) {
    if (part.functionResponse) {
      const response = part.functionResponse.response;
      const responseContent =
        typeof response === 'string' ? response : safeJsonSerialize(response);
      toolMessages.push({
        role: 'tool',
        tool_call_id: part.functionResponse.id || '',
        content: responseContent,
      });
    } else {
      nonToolParts.push(part);
    }
  }

  // Only tool responses
  if (toolMessages.length > 0 && nonToolParts.length === 0) {
    return toolMessages.length > 1 ? toolMessages : toolMessages[0];
  }

  // Both tool responses and other content
  if (toolMessages.length > 0 && nonToolParts.length > 0) {
    const followUp = contentToMessageParam(
      {role: content.role, parts: nonToolParts},
      provider,
      model
    );
    const followUpMessages = Array.isArray(followUp) ? followUp : [followUp];
    return [...toolMessages, ...followUpMessages];
  }

  // Handle user or assistant messages
  const role = toLiteLLMRole(content.role);

  if (role === 'user') {
    // Filter out thought parts for user messages
    const userParts = nonToolParts.filter((p) => !p.thought);
    const messageContent = getContent(userParts, provider, model);
    return {
      role: 'user',
      content: messageContent,
    };
  } else {
    // Assistant message
    const toolCalls: LiteLLMToolCall[] = [];
    const contentParts: Part[] = [];
    const reasoningParts: Part[] = [];

    for (const part of nonToolParts) {
      if (part.functionCall) {
        toolCalls.push({
          type: 'function',
          id: part.functionCall.id || '',
          function: {
            name: part.functionCall.name || '',
            arguments: safeJsonSerialize(part.functionCall.args || {}),
          },
        });
      } else if (part.thought) {
        reasoningParts.push(part);
      } else {
        contentParts.push(part);
      }
    }

    let finalContent = contentParts.length > 0
      ? getContent(contentParts, provider, model)
      : null;

    // Flatten content for ollama_chat compatibility if needed
    if (finalContent && Array.isArray(finalContent)) {
      if (
        finalContent.length === 1 &&
        finalContent[0].type === 'text' &&
        finalContent[0].text
      ) {
        finalContent = finalContent[0].text;
      }
    }

    // Extract reasoning content
    const reasoningTexts: string[] = [];
    for (const part of reasoningParts) {
      if (part.text) {
        reasoningTexts.push(part.text);
      }
    }
    const reasoningContent = reasoningTexts.join(NEW_LINE) || undefined;

    return {
      role: 'assistant',
      content: finalContent,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      reasoning_content: reasoningContent,
    };
  }
}

/**
 * Insert placeholder tool messages for missing tool results.
 */
function ensureToolResults(messages: LiteLLMMessage[]): LiteLLMMessage[] {
  if (!messages || messages.length === 0) {
    return messages;
  }

  const healedMessages: LiteLLMMessage[] = [];
  let pendingToolCallIds: string[] = [];

  for (const message of messages) {
    const role = message.role;

    // Insert missing tool responses before non-tool messages
    if (pendingToolCallIds.length > 0 && role !== 'tool') {
      logger.warn(
        `Missing tool results for tool_call_id(s): ${pendingToolCallIds.join(', ')}`
      );
      for (const toolCallId of pendingToolCallIds) {
        healedMessages.push({
          role: 'tool',
          tool_call_id: toolCallId,
          content: MISSING_TOOL_RESULT_MESSAGE,
        });
      }
      pendingToolCallIds = [];
    }

    if (role === 'assistant') {
      const toolCalls = message.tool_calls || [];
      pendingToolCallIds = toolCalls
        .map((tc) => tc.id)
        .filter((id): id is string => !!id);
    } else if (role === 'tool') {
      const toolCallId = message.tool_call_id;
      if (toolCallId && pendingToolCallIds.includes(toolCallId)) {
        pendingToolCallIds = pendingToolCallIds.filter(
          (id) => id !== toolCallId
        );
      }
    }

    healedMessages.push(message);
  }

  // Handle any remaining pending tool calls at the end
  if (pendingToolCallIds.length > 0) {
    logger.warn(
      `Missing tool results for tool_call_id(s): ${pendingToolCallIds.join(', ')}`
    );
    for (const toolCallId of pendingToolCallIds) {
      healedMessages.push({
        role: 'tool',
        tool_call_id: toolCallId,
        content: MISSING_TOOL_RESULT_MESSAGE,
      });
    }
  }

  return healedMessages;
}

// ============================================================================
// Response conversion functions
// ============================================================================

/**
 * Splits message content and tool calls, parsing inline JSON when needed.
 */
function splitMessageContentAndToolCalls(
  message: LiteLLMMessage
): [string | LiteLLMContentBlock[] | null, LiteLLMToolCall[]] {
  const existingToolCalls = message.tool_calls || [];
  const content = message.content;

  // If we have tool calls or non-string content, return as-is
  if (existingToolCalls.length > 0 || typeof content !== 'string') {
    return [content ?? null, existingToolCalls];
  }

  // Try to parse inline JSON tool calls from text
  const [fallbackToolCalls, remainder] = parseToolCallsFromText(content);
  if (fallbackToolCalls.length > 0) {
    return [remainder, fallbackToolCalls];
  }

  return [content, []];
}

/**
 * Extracts inline JSON tool calls from LiteLLM text responses.
 */
function parseToolCallsFromText(
  textBlock: string
): [LiteLLMToolCall[], string | null] {
  const toolCalls: LiteLLMToolCall[] = [];

  if (!textBlock) {
    return [toolCalls, null];
  }

  const remainderSegments: string[] = [];
  let cursor = 0;

  while (cursor < textBlock.length) {
    const braceIndex = textBlock.indexOf('{', cursor);
    if (braceIndex === -1) {
      remainderSegments.push(textBlock.slice(cursor));
      break;
    }

    remainderSegments.push(textBlock.slice(cursor, braceIndex));

    // Try to parse JSON starting at this brace
    try {
      // Find matching closing brace
      let depth = 0;
      let endIndex = braceIndex;
      for (let i = braceIndex; i < textBlock.length; i++) {
        if (textBlock[i] === '{') depth++;
        else if (textBlock[i] === '}') {
          depth--;
          if (depth === 0) {
            endIndex = i + 1;
            break;
          }
        }
      }

      const jsonStr = textBlock.slice(braceIndex, endIndex);
      const candidate = JSON.parse(jsonStr) as Record<string, unknown>;

      // Check if this looks like a tool call
      const toolCall = buildToolCallFromJsonDict(candidate, toolCalls.length);
      if (toolCall) {
        toolCalls.push(toolCall);
        cursor = endIndex;
        continue;
      }

      // Not a tool call - add to remainder
      remainderSegments.push(textBlock.slice(braceIndex, endIndex));
      cursor = endIndex;
    } catch {
      // Not valid JSON - add the brace to remainder and continue
      remainderSegments.push(textBlock[braceIndex]);
      cursor = braceIndex + 1;
    }
  }

  const remainder = remainderSegments.join('').trim() || null;
  return [toolCalls, remainder];
}

/**
 * Creates a tool call object from JSON content embedded in text.
 */
function buildToolCallFromJsonDict(
  candidate: Record<string, unknown>,
  index: number
): LiteLLMToolCall | null {
  const name = candidate.name;
  const args = candidate.arguments;

  if (typeof name !== 'string' || args === undefined) {
    return null;
  }

  const argumentsPayload =
    typeof args === 'string' ? args : safeJsonSerialize(args);
  const callId =
    (candidate.id as string) || `adk_tool_call_${Math.random().toString(36).slice(2)}`;

  return {
    type: 'function',
    id: callId,
    function: {
      name,
      arguments: argumentsPayload,
    },
    index,
  };
}

/**
 * Converts a LiteLLM message to an LlmResponse.
 */
function messageToGenerateContentResponse(
  message: LiteLLMMessage,
  isPartial = false,
  modelVersion?: string,
  thoughtParts?: Part[]
): LlmResponse {
  const parts: Part[] = [];

  // Add thought parts if provided
  if (!thoughtParts) {
    thoughtParts = convertReasoningValueToParts(extractReasoningValue(message));
  }
  if (thoughtParts) {
    parts.push(...thoughtParts);
  }

  // Split content and tool calls
  const [messageContent, toolCalls] = splitMessageContentAndToolCalls(message);

  // Add text content
  if (typeof messageContent === 'string' && messageContent) {
    parts.push({text: messageContent});
  }

  // Add function calls
  if (toolCalls && toolCalls.length > 0) {
    for (const toolCall of toolCalls) {
      if (toolCall.type === 'function') {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(toolCall.function.arguments || '{}');
        } catch {
          // Keep empty args on parse error
        }
        parts.push({
          functionCall: {
            id: toolCall.id,
            name: toolCall.function.name,
            args,
          },
        });
      }
    }
  }

  return {
    content: {
      role: 'model',
      parts,
    },
    partial: isPartial,
    customMetadata: modelVersion ? {modelVersion} : undefined,
  };
}

/**
 * Converts a LiteLLM response to LlmResponse. Also adds usage metadata.
 */
function modelResponseToGenerateContentResponse(
  response: LiteLLMResponse
): LlmResponse {
  let message: LiteLLMMessage | undefined;
  let finishReason: string | null | undefined;

  if (response.choices && response.choices.length > 0) {
    const firstChoice = response.choices[0];
    message = firstChoice.message;
    finishReason = firstChoice.finish_reason;
  }

  if (!message) {
    throw new Error('No message in response');
  }

  const thoughtParts = convertReasoningValueToParts(
    extractReasoningValue(message)
  );
  const llmResponse = messageToGenerateContentResponse(
    message,
    false,
    response.model,
    thoughtParts.length > 0 ? thoughtParts : undefined
  );

  if (finishReason) {
    llmResponse.finishReason = mapFinishReason(finishReason);
  }

  if (response.usage) {
    const usage = response.usage;
    llmResponse.usageMetadata = {
      promptTokenCount: usage.prompt_tokens,
      candidatesTokenCount: usage.completion_tokens,
      totalTokenCount: usage.total_tokens,
      cachedContentTokenCount: extractCachedPromptTokens(usage),
    } as GenerateContentResponseUsageMetadata;
  }

  return llmResponse;
}

// ============================================================================
// LiteLlm Parameters
// ============================================================================

/**
 * Parameters for creating a LiteLlm instance.
 */
export interface LiteLlmParams {
  /**
   * The name of the LiteLLM model (e.g., "openai/gpt-4o", "groq/llama3-70b").
   */
  model: string;

  /**
   * Additional arguments to pass to the LiteLLM completion API.
   */
  additionalArgs?: Record<string, unknown>;

  /**
   * Whether to drop unsupported parameters for specific providers.
   */
  dropParams?: boolean;
}

// ============================================================================
// LiteLlm Class
// ============================================================================

/**
 * Wrapper around LiteLLM for model-agnostic LLM support.
 *
 * This wrapper can be used with any of the models supported by LiteLLM.
 * The environment variable(s) needed for authenticating with the model
 * endpoint must be set prior to instantiating this class.
 *
 * @example
 * ```typescript
 * // For OpenAI
 * process.env['OPENAI_API_KEY'] = 'your-api-key';
 * const llm = new LiteLlm({model: 'openai/gpt-4o'});
 *
 * // For Groq
 * process.env['GROQ_API_KEY'] = 'your-api-key';
 * const llm = new LiteLlm({model: 'groq/llama3-70b-8192'});
 *
 * // For Anthropic via LiteLLM
 * process.env['ANTHROPIC_API_KEY'] = 'your-api-key';
 * const llm = new LiteLlm({model: 'anthropic/claude-3-opus-20240229'});
 * ```
 */
export class LiteLlm extends BaseLlm {
  /**
   * Additional arguments for LiteLLM completion.
   */
  private readonly additionalArgs: Record<string, unknown>;

  /**
   * Cached LiteLLM module.
   */
  private _litellm: unknown;

  /**
   * List of supported model patterns.
   * These patterns activate the integration for the most common use cases.
   * LiteLLM can handle many more - see https://docs.litellm.ai/docs/providers
   */
  static override readonly supportedModels: Array<string | RegExp> = [
    // OpenAI models (e.g., "openai/gpt-4o")
    /openai\/.*/,
    // Groq models (e.g., "groq/llama3-70b-8192")
    /groq\/.*/,
    // Anthropic models via LiteLLM (e.g., "anthropic/claude-3-opus")
    /anthropic\/.*/,
    // Azure OpenAI models (e.g., "azure/gpt-4")
    /azure\/.*/,
    // Bedrock models (e.g., "bedrock/anthropic.claude-3")
    /bedrock\/.*/,
    // Cohere models (e.g., "cohere/command-r-plus")
    /cohere\/.*/,
    // Mistral models (e.g., "mistral/mistral-large-latest")
    /mistral\/.*/,
    // Together AI models (e.g., "together_ai/llama3-70b")
    /together_ai\/.*/,
    // Ollama models (e.g., "ollama/llama3")
    /ollama\/.*/,
    /ollama_chat\/.*/,
    // Deepseek models (e.g., "deepseek/deepseek-chat")
    /deepseek\/.*/,
    // Perplexity models (e.g., "perplexity/llama-3.1-sonar-small")
    /perplexity\/.*/,
    // Fireworks AI models (e.g., "fireworks_ai/llama-v3p1-70b")
    /fireworks_ai\/.*/,
    // AI21 models (e.g., "ai21/j2-ultra")
    /ai21\/.*/,
    // Replicate models (e.g., "replicate/meta/llama-2-70b")
    /replicate\/.*/,
    // Anyscale models
    /anyscale\/.*/,
    // HuggingFace models
    /huggingface\/.*/,
    // Cloudflare Workers AI models
    /cloudflare\/.*/,
    // Voyage AI models
    /voyage\/.*/,
  ];

  constructor({model, additionalArgs = {}, dropParams}: LiteLlmParams) {
    super({model});

    // Warn if using Gemini via LiteLLM
    warnGeminiViaLiteLLM(model);

    // Store additional args, filtering out managed parameters
    this.additionalArgs = {...additionalArgs};
    delete this.additionalArgs.messages;
    delete this.additionalArgs.tools;
    delete this.additionalArgs.stream;

    if (dropParams !== undefined) {
      this.additionalArgs.drop_params = dropParams;
    }
  }

  /**
   * Gets or creates the LiteLLM module instance.
   * Uses dynamic import to avoid requiring the SDK at module load time.
   */
  private async getLiteLLM(): Promise<{
    acompletion: (params: Record<string, unknown>) => Promise<unknown>;
  }> {
    if (this._litellm) {
      return this._litellm as {
        acompletion: (params: Record<string, unknown>) => Promise<unknown>;
      };
    }

    try {
      // Dynamic import of LiteLLM SDK
      // @ts-expect-error - litellm is an optional peer dependency
      const litellmModule = await import('litellm');
      this._litellm = litellmModule.default || litellmModule;
      return this._litellm as {
        acompletion: (params: Record<string, unknown>) => Promise<unknown>;
      };
    } catch (error) {
      throw new Error(
        'LiteLLM SDK is required for LiteLlm. ' +
          'Please install it with: npm install litellm\n' +
          `Original error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Appends a fallback user content if missing.
   */
  private appendFallbackUserContentIfMissing(llmRequest: LlmRequest): void {
    const contents = llmRequest.contents || [];

    // Find the last user message
    for (let i = contents.length - 1; i >= 0; i--) {
      const content = contents[i];
      if (content.role === 'user') {
        const parts = content.parts || [];
        // Check if it has meaningful content
        const hasPayload = parts.some(
          (part) =>
            part.text ||
            (part.inlineData && part.inlineData.data) ||
            (part.fileData && part.fileData.fileUri)
        );
        if (hasPayload) {
          return;
        }
        // Add fallback content
        content.parts = [
          ...(content.parts || []),
          {text: 'Handle the requests as specified in the System Instruction.'},
        ];
        return;
      }
    }

    // No user message found - add one
    llmRequest.contents.push({
      role: 'user',
      parts: [
        {text: 'Handle the requests as specified in the System Instruction.'},
      ],
    });
  }

  /**
   * Gets completion inputs from LlmRequest.
   */
  private getCompletionInputs(
    llmRequest: LlmRequest,
    effectiveModel: string
  ): {
    messages: LiteLLMMessage[];
    tools: LiteLLMTool[] | undefined;
    responseFormat: Record<string, unknown> | undefined;
    generationParams: Record<string, unknown> | undefined;
  } {
    const provider = getProviderFromModel(effectiveModel);

    // 1. Construct messages
    const messages: LiteLLMMessage[] = [];
    for (const content of llmRequest.contents || []) {
      const messageParamOrList = contentToMessageParam(
        content,
        provider,
        effectiveModel
      );
      if (Array.isArray(messageParamOrList)) {
        messages.push(...messageParamOrList);
      } else {
        messages.push(messageParamOrList);
      }
    }

    // Add system instruction
    if (llmRequest.config?.systemInstruction) {
      const systemInstruction =
        typeof llmRequest.config.systemInstruction === 'string'
          ? llmRequest.config.systemInstruction
          : '';
      if (systemInstruction) {
        messages.unshift({
          role: 'system',
          content: systemInstruction,
        });
      }
    }

    // Ensure tool results are present
    const healedMessages = ensureToolResults(messages);

    // 2. Convert tool declarations
    let tools: LiteLLMTool[] | undefined;
    if (
      llmRequest.config?.tools &&
      llmRequest.config.tools.length > 0 &&
      hasToolFunctionDeclarations(llmRequest.config.tools[0])
    ) {
      tools = llmRequest.config.tools[0].functionDeclarations.map(
        (tool: FunctionDeclaration) => functionDeclarationToToolParam(tool)
      );
    }

    // 3. Handle response format
    let responseFormat: Record<string, unknown> | undefined;
    if (llmRequest.config?.responseSchema) {
      responseFormat = this.toLiteLLMResponseFormat(
        llmRequest.config.responseSchema as Record<string, unknown>,
        effectiveModel
      );
    }

    // 4. Extract generation parameters
    let generationParams: Record<string, unknown> | undefined;
    if (llmRequest.config) {
      const config = llmRequest.config as Record<string, unknown>;
      generationParams = {};

      const paramMapping: Record<string, string> = {
        maxOutputTokens: 'max_completion_tokens',
        max_output_tokens: 'max_completion_tokens',
        stopSequences: 'stop',
        stop_sequences: 'stop',
      };

      const paramKeys = [
        'temperature',
        'maxOutputTokens',
        'max_output_tokens',
        'topP',
        'top_p',
        'topK',
        'top_k',
        'stopSequences',
        'stop_sequences',
        'presencePenalty',
        'presence_penalty',
        'frequencyPenalty',
        'frequency_penalty',
      ];

      for (const key of paramKeys) {
        if (key in config && config[key] !== undefined) {
          const mappedKey = paramMapping[key] || key;
          // Convert camelCase to snake_case for LiteLLM
          const snakeKey = mappedKey.replace(/([A-Z])/g, '_$1').toLowerCase();
          generationParams[snakeKey] = config[key];
        }
      }

      if (Object.keys(generationParams).length === 0) {
        generationParams = undefined;
      }
    }

    return {
      messages: healedMessages,
      tools,
      responseFormat,
      generationParams,
    };
  }

  /**
   * Converts ADK response schema to LiteLLM-compatible format.
   */
  private toLiteLLMResponseFormat(
    responseSchema: Record<string, unknown>,
    model: string
  ): Record<string, unknown> | undefined {
    const schemaType = responseSchema.type;
    if (
      typeof schemaType === 'string' &&
      ['json_object', 'json_schema'].includes(schemaType.toLowerCase())
    ) {
      return responseSchema;
    }

    const schemaDict = {...responseSchema};
    const schemaName =
      (schemaDict.title as string) || (schemaDict.name as string) || 'response';

    // Gemini models use a special response format
    if (isLiteLLMGeminiModel(model)) {
      return {
        type: 'json_object',
        response_schema: schemaDict,
      };
    }

    // OpenAI-compatible format (default)
    if (
      schemaDict.type === 'object' &&
      !('additionalProperties' in schemaDict)
    ) {
      schemaDict.additionalProperties = false;
    }

    return {
      type: 'json_schema',
      json_schema: {
        name: schemaName,
        strict: true,
        schema: schemaDict,
      },
    };
  }

  /**
   * Generates content using LiteLLM.
   *
   * @param llmRequest - The LLM request containing messages and configuration
   * @param stream - Whether to stream the response
   * @yields LlmResponse objects containing the model's response
   */
  override async *generateContentAsync(
    llmRequest: LlmRequest,
    stream = false
  ): AsyncGenerator<LlmResponse, void> {
    // Append user content if needed
    this.maybeAppendUserContent(llmRequest);
    this.appendFallbackUserContentIfMissing(llmRequest);

    const effectiveModel = llmRequest.model || this.model;
    const {messages, tools, responseFormat, generationParams} =
      this.getCompletionInputs(llmRequest, effectiveModel);

    // Get LiteLLM module
    const litellm = await this.getLiteLLM();

    // Build completion arguments
    const completionArgs: Record<string, unknown> = {
      model: effectiveModel,
      messages,
      tools,
      response_format: responseFormat,
      ...this.additionalArgs,
    };

    if (generationParams) {
      Object.assign(completionArgs, generationParams);
    }

    if (stream) {
      completionArgs.stream = true;
      completionArgs.stream_options = {include_usage: true};

      // Streaming mode
      let text = '';
      const reasoningParts: Part[] = [];
      const functionCalls: Map<
        number,
        {name: string; args: string; id: string | null}
      > = new Map();
      let aggregatedLlmResponse: LlmResponse | null = null;
      let aggregatedLlmResponseWithToolCall: LlmResponse | null = null;
      let usageMetadata: GenerateContentResponseUsageMetadata | null = null;
      let fallbackIndex = 0;

      const response = (await litellm.acompletion(completionArgs)) as AsyncIterable<LiteLLMResponse>;

      for await (const chunk of response) {
        if (!chunk.choices || chunk.choices.length === 0) {
          // Handle usage metadata in final chunk
          if (chunk.usage) {
            usageMetadata = {
              promptTokenCount: chunk.usage.prompt_tokens,
              candidatesTokenCount: chunk.usage.completion_tokens,
              totalTokenCount: chunk.usage.total_tokens,
              cachedContentTokenCount: extractCachedPromptTokens(chunk.usage),
            } as GenerateContentResponseUsageMetadata;
          }
          continue;
        }

        const choice = chunk.choices[0];
        const delta = choice.delta;
        const finishReason = choice.finish_reason;
        const modelVersion = chunk.model;

        if (delta) {
          // Handle reasoning content
          const reasoningValue = extractReasoningValue(delta);
          if (reasoningValue) {
            const parts = convertReasoningValueToParts(reasoningValue);
            if (parts.length > 0) {
              reasoningParts.push(...parts);
              yield {
                content: {role: 'model', parts},
                partial: true,
                customMetadata: modelVersion ? {modelVersion} : undefined,
              };
            }
          }

          // Handle text content
          const content = delta.content;
          if (typeof content === 'string' && content) {
            text += content;
            yield {
              content: {role: 'model', parts: [{text: content}]},
              partial: true,
              customMetadata: modelVersion ? {modelVersion} : undefined,
            };
          }

          // Handle tool calls
          if (delta.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              const index = toolCall.index ?? fallbackIndex;
              if (!functionCalls.has(index)) {
                functionCalls.set(index, {name: '', args: '', id: null});
              }

              const funcData = functionCalls.get(index)!;
              if (toolCall.function.name) {
                funcData.name += toolCall.function.name;
              }
              if (toolCall.function.arguments) {
                funcData.args += toolCall.function.arguments;

                // Check if args are complete (workaround for improper indexing)
                try {
                  JSON.parse(funcData.args);
                  fallbackIndex++;
                } catch {
                  // Args not yet complete
                }
              }
              funcData.id = toolCall.id || funcData.id || String(index);
            }
          }
        }

        // Handle finish reason
        if (
          (finishReason === 'tool_calls' || finishReason === 'stop') &&
          functionCalls.size > 0
        ) {
          const toolCalls: LiteLLMToolCall[] = [];
          for (const [index, funcData] of functionCalls) {
            if (funcData.id) {
              toolCalls.push({
                type: 'function',
                id: funcData.id,
                function: {
                  name: funcData.name,
                  arguments: funcData.args,
                },
                index,
              });
            }
          }

          aggregatedLlmResponseWithToolCall = messageToGenerateContentResponse(
            {
              role: 'assistant',
              content: text || null,
              tool_calls: toolCalls,
            },
            false,
            modelVersion,
            reasoningParts.length > 0 ? [...reasoningParts] : undefined
          );
          aggregatedLlmResponseWithToolCall.finishReason =
            mapFinishReason(finishReason);

          text = '';
          reasoningParts.length = 0;
          functionCalls.clear();
        } else if (finishReason === 'stop' && (text || reasoningParts.length > 0)) {
          aggregatedLlmResponse = messageToGenerateContentResponse(
            {
              role: 'assistant',
              content: text || null,
            },
            false,
            modelVersion,
            reasoningParts.length > 0 ? [...reasoningParts] : undefined
          );
          aggregatedLlmResponse.finishReason = mapFinishReason(finishReason);

          text = '';
          reasoningParts.length = 0;
        }

        // Handle usage metadata in chunk
        if (chunk.usage) {
          usageMetadata = {
            promptTokenCount: chunk.usage.prompt_tokens,
            candidatesTokenCount: chunk.usage.completion_tokens,
            totalTokenCount: chunk.usage.total_tokens,
            cachedContentTokenCount: extractCachedPromptTokens(chunk.usage),
          } as GenerateContentResponseUsageMetadata;
        }
      }

      // Yield aggregated responses at the end
      if (aggregatedLlmResponse) {
        if (usageMetadata) {
          aggregatedLlmResponse.usageMetadata = usageMetadata;
          usageMetadata = null;
        }
        yield aggregatedLlmResponse;
      }

      if (aggregatedLlmResponseWithToolCall) {
        if (usageMetadata) {
          aggregatedLlmResponseWithToolCall.usageMetadata = usageMetadata;
        }
        yield aggregatedLlmResponseWithToolCall;
      }
    } else {
      // Non-streaming mode
      const response = (await litellm.acompletion(completionArgs)) as LiteLLMResponse;
      yield modelResponseToGenerateContentResponse(response);
    }
  }

  /**
   * Creates a live connection to the LLM.
   * Note: Live connections are not supported for LiteLLM models.
   *
   * @throws Always throws as live connections are not supported
   */
  override async connect(_llmRequest: LlmRequest): Promise<BaseLlmConnection> {
    throw new Error('Live connections are not supported for LiteLLM models.');
  }
}
