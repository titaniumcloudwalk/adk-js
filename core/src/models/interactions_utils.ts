/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Utilities for the Interactions API integration.
 *
 * This module provides both conversion utilities and the main entry point
 * for generating content via the Interactions API. It includes:
 *
 * - Type conversion functions between ADK types and Interactions API types
 * - The `generateContentViaInteractions` async generator that handles the
 *   complete flow of sending requests and processing responses
 * - Request/response logging utilities for debugging
 * - Support for both streaming and non-streaming modes
 *
 * The Interactions API provides stateful conversation capabilities, allowing
 * chained interactions using previousInteractionId instead of sending full
 * conversation history.
 */

import {
  Blob as GenaiBlob,
  Content,
  ExecutableCode,
  FileData,
  FinishReason,
  FunctionCall,
  FunctionResponse,
  GenerateContentConfig,
  GenerateContentResponseUsageMetadata,
  GoogleGenAI,
  Outcome,
  Part,
  Tool,
} from '@google/genai';

import {logger} from '../utils/logger.js';

import {LlmRequest} from './llm_request.js';
import {LlmResponse} from './llm_response.js';

/**
 * Turn parameter for the Interactions API.
 */
export interface TurnParam {
  role: string;
  content: InteractionContent[];
}

/**
 * Tool parameter for the Interactions API.
 */
export interface ToolParam {
  type: string;
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
}

/**
 * Content types supported by the Interactions API.
 */
export type InteractionContent =
  | {type: 'text'; text: string}
  | {type: 'function_call'; id: string; name: string; arguments: Record<string, unknown>}
  | {type: 'function_result'; name: string; call_id: string; result: string}
  | {type: 'image'; data?: string; uri?: string; mime_type: string}
  | {type: 'audio'; data?: string; uri?: string; mime_type: string}
  | {type: 'video'; data?: string; uri?: string; mime_type: string}
  | {type: 'document'; data?: string; uri?: string; mime_type: string}
  | {type: 'thought'; signature?: string}
  | {type: 'code_execution_result'; call_id: string; result: string; is_error: boolean}
  | {type: 'code_execution_call'; id: string; arguments: {code: string; language: string}};

/**
 * Interaction output from the API response.
 */
export interface InteractionOutput {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  call_id?: string;
  result?: string | {items?: unknown[]};
  data?: string;
  uri?: string;
  mime_type?: string;
  is_error?: boolean;
}

/**
 * Interaction usage metadata.
 */
export interface InteractionUsage {
  total_input_tokens?: number;
  total_output_tokens?: number;
}

/**
 * Interaction error.
 */
export interface InteractionError {
  code?: string;
  message?: string;
}

/**
 * Full Interaction response from the API.
 */
export interface Interaction {
  id?: string;
  status?: 'completed' | 'requires_action' | 'failed' | 'in_progress';
  outputs?: InteractionOutput[];
  usage?: InteractionUsage;
  error?: InteractionError;
}

/**
 * SSE event delta content.
 */
export interface InteractionDelta {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  data?: string;
  uri?: string;
  mime_type?: string;
}

/**
 * SSE event from streaming response.
 */
export interface InteractionSSEEvent {
  event_type?: string;
  id?: string;
  delta?: InteractionDelta;
  status?: string;
  error?: InteractionError;
  // For 'interaction' event type, the event itself contains the full interaction
  outputs?: InteractionOutput[];
  usage?: InteractionUsage;
}

/**
 * Convert a Part to an interaction content dict.
 *
 * @param part - The Part object to convert.
 * @returns A dictionary representing the interaction content, or null if
 *   the part type is not supported.
 */
export function convertPartToInteractionContent(
  part: Part,
): InteractionContent | null {
  if (part.text !== undefined && part.text !== null) {
    return {type: 'text', text: part.text};
  }

  if (part.functionCall) {
    return {
      type: 'function_call',
      id: part.functionCall.id || '',
      name: part.functionCall.name || '',
      arguments: part.functionCall.args || {},
    };
  }

  if (part.functionResponse) {
    // Convert the function response to a string for the interactions API
    // The interactions API expects result to be either a string or items list
    const rawResult = part.functionResponse.response;
    let result: string;
    if (typeof rawResult === 'object') {
      result = JSON.stringify(rawResult);
    } else if (typeof rawResult !== 'string') {
      result = String(rawResult);
    } else {
      result = rawResult;
    }
    logger.debug(
      `Converting function_response: name=${part.functionResponse.name}, call_id=${part.functionResponse.id}`,
    );
    return {
      type: 'function_result',
      name: part.functionResponse.name || '',
      call_id: part.functionResponse.id || '',
      result,
    };
  }

  if (part.inlineData) {
    const mimeType = part.inlineData.mimeType || '';
    const data = part.inlineData.data || '';

    if (mimeType.startsWith('image/')) {
      return {type: 'image', data, mime_type: mimeType};
    } else if (mimeType.startsWith('audio/')) {
      return {type: 'audio', data, mime_type: mimeType};
    } else if (mimeType.startsWith('video/')) {
      return {type: 'video', data, mime_type: mimeType};
    } else {
      return {type: 'document', data, mime_type: mimeType};
    }
  }

  if (part.fileData) {
    const mimeType = part.fileData.mimeType || '';
    const uri = part.fileData.fileUri || '';

    if (mimeType.startsWith('image/')) {
      return {type: 'image', uri, mime_type: mimeType};
    } else if (mimeType.startsWith('audio/')) {
      return {type: 'audio', uri, mime_type: mimeType};
    } else if (mimeType.startsWith('video/')) {
      return {type: 'video', uri, mime_type: mimeType};
    } else {
      return {type: 'document', uri, mime_type: mimeType};
    }
  }

  // Handle thought parts
  if ('thought' in part && part.thought) {
    const result: {type: 'thought'; signature?: string} = {type: 'thought'};
    if ('thoughtSignature' in part && part.thoughtSignature) {
      // Signature is already base64 encoded in TypeScript SDK
      result.signature = part.thoughtSignature as string;
    }
    return result;
  }

  if (part.codeExecutionResult) {
    const isError =
      part.codeExecutionResult.outcome === Outcome.OUTCOME_FAILED ||
      part.codeExecutionResult.outcome === Outcome.OUTCOME_DEADLINE_EXCEEDED;
    return {
      type: 'code_execution_result',
      call_id: '',
      result: part.codeExecutionResult.output || '',
      is_error: isError,
    };
  }

  if (part.executableCode) {
    return {
      type: 'code_execution_call',
      id: '',
      arguments: {
        code: part.executableCode.code || '',
        language: part.executableCode.language || 'PYTHON',
      },
    };
  }

  return null;
}

/**
 * Convert a Content to a TurnParam dict for interactions API.
 *
 * @param content - The Content object to convert.
 * @returns A TurnParam dictionary for the interactions API.
 */
export function convertContentToTurn(content: Content): TurnParam {
  const contents: InteractionContent[] = [];
  if (content.parts) {
    for (const part of content.parts) {
      const interactionContent = convertPartToInteractionContent(part);
      if (interactionContent) {
        contents.push(interactionContent);
      }
    }
  }

  return {
    role: content.role || 'user',
    content: contents,
  };
}

/**
 * Convert a list of Content objects to interactions API input format.
 *
 * @param contents - The list of Content objects to convert.
 * @returns A list of TurnParam dictionaries for the interactions API.
 */
export function convertContentsToTurns(contents: Content[]): TurnParam[] {
  const turns: TurnParam[] = [];
  for (const content of contents) {
    const turn = convertContentToTurn(content);
    if (turn.content.length > 0) {
      // Only add turns with content
      turns.push(turn);
    }
  }
  return turns;
}

/**
 * Convert tools from GenerateContentConfig to interactions API format.
 *
 * @param config - The GenerateContentConfig containing tools to convert.
 * @returns A list of ToolParam dictionaries for the interactions API.
 */
export function convertToolsConfigToInteractionsFormat(
  config?: GenerateContentConfig,
): ToolParam[] {
  if (!config?.tools) {
    return [];
  }

  const interactionTools: ToolParam[] = [];

  for (const tool of config.tools) {
    // Handle function declarations
    if ((tool as Tool).functionDeclarations) {
      for (const funcDecl of (tool as Tool).functionDeclarations!) {
        const funcTool: ToolParam = {
          type: 'function',
          name: funcDecl.name,
        };
        if (funcDecl.description) {
          funcTool.description = funcDecl.description;
        }
        if (funcDecl.parameters) {
          // Parameters are already in JSON schema format
          funcTool.parameters = funcDecl.parameters as Record<string, unknown>;
        }
        interactionTools.push(funcTool);
      }
    }

    // Handle google_search
    if ((tool as Tool).googleSearch) {
      interactionTools.push({type: 'google_search'});
    }

    // Handle code_execution
    if ((tool as Tool).codeExecution) {
      interactionTools.push({type: 'code_execution'});
    }

    // Handle url_context
    if ((tool as Tool & {urlContext?: unknown}).urlContext) {
      interactionTools.push({type: 'url_context'});
    }

    // Handle computer_use
    if ((tool as Tool & {computerUse?: unknown}).computerUse) {
      interactionTools.push({type: 'computer_use'});
    }
  }

  return interactionTools;
}

/**
 * Convert an interaction output content to a Part.
 *
 * @param output - The interaction output object to convert.
 * @returns A Part object, or null if the output type is not supported.
 */
export function convertInteractionOutputToPart(
  output: InteractionOutput,
): Part | null {
  if (!output.type) {
    return null;
  }

  const outputType = output.type;

  if (outputType === 'text') {
    return {text: output.text || ''};
  }

  if (outputType === 'function_call') {
    logger.debug(
      `Converting function_call output: name=${output.name}, id=${output.id}`,
    );
    return {
      functionCall: {
        id: output.id,
        name: output.name,
        args: output.arguments || {},
      } as FunctionCall,
    };
  }

  if (outputType === 'function_result') {
    let resultValue = output.result;
    // Handle different result formats
    if (typeof resultValue === 'object' && resultValue && 'items' in resultValue) {
      resultValue = (resultValue as {items: unknown[]}).items as unknown as string;
    }
    return {
      functionResponse: {
        id: output.call_id,
        response: resultValue,
      } as FunctionResponse,
    };
  }

  if (outputType === 'image') {
    if (output.data) {
      return {
        inlineData: {
          data: output.data,
          mimeType: output.mime_type,
        } as GenaiBlob,
      };
    } else if (output.uri) {
      return {
        fileData: {
          fileUri: output.uri,
          mimeType: output.mime_type,
        } as FileData,
      };
    }
  }

  if (outputType === 'audio') {
    if (output.data) {
      return {
        inlineData: {
          data: output.data,
          mimeType: output.mime_type,
        } as GenaiBlob,
      };
    } else if (output.uri) {
      return {
        fileData: {
          fileUri: output.uri,
          mimeType: output.mime_type,
        } as FileData,
      };
    }
  }

  if (outputType === 'thought') {
    // Thought outputs are internal model reasoning and typically not exposed as Parts
    // Skip thought outputs for now
    return null;
  }

  if (outputType === 'code_execution_result') {
    return {
      codeExecutionResult: {
        output: output.result as string || '',
        outcome: output.is_error ? Outcome.OUTCOME_FAILED : Outcome.OUTCOME_OK,
      },
    };
  }

  if (outputType === 'code_execution_call') {
    const args = output.arguments || {};
    return {
      executableCode: {
        code: (args as {code?: string}).code || '',
        language: (args as {language?: string}).language || 'PYTHON',
      } as ExecutableCode,
    };
  }

  if (outputType === 'google_search_result') {
    // For google search results, we create a text part with the results
    if (output.result && Array.isArray(output.result)) {
      const resultsText = output.result
        .filter((r) => r)
        .map((r) => String(r))
        .join('\n');
      return {text: resultsText};
    }
  }

  return null;
}

/**
 * Convert an Interaction response to an LlmResponse.
 *
 * @param interaction - The Interaction response object from the API.
 * @returns An LlmResponse object with the converted data.
 */
export function convertInteractionToLlmResponse(
  interaction: Interaction,
): LlmResponse {
  // Check for errors
  if (interaction.status === 'failed') {
    let errorMsg = 'Unknown error';
    let errorCode = 'UNKNOWN_ERROR';
    if (interaction.error) {
      errorMsg = interaction.error.message || errorMsg;
      errorCode = interaction.error.code || errorCode;
    }
    return {
      errorCode,
      errorMessage: errorMsg,
      interactionId: interaction.id,
    };
  }

  // Convert outputs to Content parts
  const parts: Part[] = [];
  if (interaction.outputs) {
    for (const output of interaction.outputs) {
      const part = convertInteractionOutputToPart(output);
      if (part) {
        parts.push(part);
      }
    }
  }

  const content: Content | undefined =
    parts.length > 0 ? {role: 'model', parts} : undefined;

  // Convert usage metadata if available
  let usageMetadata: GenerateContentResponseUsageMetadata | undefined;
  if (interaction.usage) {
    usageMetadata = {
      promptTokenCount: interaction.usage.total_input_tokens,
      candidatesTokenCount: interaction.usage.total_output_tokens,
      totalTokenCount:
        (interaction.usage.total_input_tokens || 0) +
        (interaction.usage.total_output_tokens || 0),
    };
  }

  // Determine finish reason based on status.
  // Interaction status can be: 'completed', 'requires_action', 'failed', or
  // 'in_progress'. The 'failed' status is handled earlier in this function.
  // For 'in_progress', finish_reason stays undefined as the interaction is ongoing.
  // Both 'completed' and 'requires_action' indicate the model has finished
  // its current turn (requires_action means it's waiting for tool results).
  let finishReason: FinishReason | undefined;
  if (
    interaction.status === 'completed' ||
    interaction.status === 'requires_action'
  ) {
    finishReason = FinishReason.STOP;
  }

  return {
    content,
    usageMetadata,
    finishReason,
    turnComplete:
      interaction.status === 'completed' ||
      interaction.status === 'requires_action',
    interactionId: interaction.id,
  };
}

/**
 * Convert an InteractionSSEEvent to an LlmResponse for streaming.
 *
 * @param event - The streaming event from interactions API.
 * @param aggregatedParts - List to accumulate parts across events.
 * @param interactionId - The interaction ID to include in responses.
 * @returns LlmResponse if this event produces one, null otherwise.
 */
export function convertInteractionEventToLlmResponse(
  event: InteractionSSEEvent,
  aggregatedParts: Part[],
  interactionId?: string,
): LlmResponse | null {
  const eventType = event.event_type;

  if (eventType === 'content.delta') {
    const delta = event.delta;
    if (!delta) {
      return null;
    }

    const deltaType = delta.type;

    if (deltaType === 'text') {
      const text = delta.text || '';
      if (text) {
        const part: Part = {text};
        aggregatedParts.push(part);
        return {
          content: {role: 'model', parts: [part]},
          partial: true,
          turnComplete: false,
          interactionId,
        };
      }
    } else if (deltaType === 'function_call') {
      // Function calls are typically sent as complete units
      // DON'T yield immediately - add to aggregatedParts only.
      // The function_call will be yielded in the final response which has
      // the correct interaction_id. If we yield here, interaction_id may be
      // undefined because SSE streams the id later in the 'interaction' event.
      if (delta.name) {
        const part: Part = {
          functionCall: {
            id: delta.id || '',
            name: delta.name,
            args: delta.arguments || {},
          } as FunctionCall,
        };
        aggregatedParts.push(part);
        // Return null - function_call will be in the final aggregated response
        return null;
      }
    } else if (deltaType === 'image') {
      if (delta.data || delta.uri) {
        let part: Part;
        if (delta.data) {
          part = {
            inlineData: {
              data: delta.data,
              mimeType: delta.mime_type,
            } as GenaiBlob,
          };
        } else {
          part = {
            fileData: {
              fileUri: delta.uri,
              mimeType: delta.mime_type,
            } as FileData,
          };
        }
        aggregatedParts.push(part);
        return {
          content: {role: 'model', parts: [part]},
          partial: false,
          turnComplete: false,
          interactionId,
        };
      }
    }
  } else if (eventType === 'content.stop') {
    // Content streaming finished, return aggregated content
    if (aggregatedParts.length > 0) {
      return {
        content: {role: 'model', parts: [...aggregatedParts]},
        partial: false,
        turnComplete: false,
        interactionId,
      };
    }
  } else if (eventType === 'interaction') {
    // Final interaction event with complete data
    // The event itself contains the interaction data
    return convertInteractionToLlmResponse(event as unknown as Interaction);
  } else if (eventType === 'interaction.status_update') {
    const status = event.status;
    if (status === 'completed' || status === 'requires_action') {
      return {
        content:
          aggregatedParts.length > 0
            ? {role: 'model', parts: [...aggregatedParts]}
            : undefined,
        partial: false,
        turnComplete: true,
        finishReason: FinishReason.STOP,
        interactionId,
      };
    } else if (status === 'failed') {
      const error = event.error;
      return {
        errorCode: error?.code || 'UNKNOWN_ERROR',
        errorMessage: error?.message || 'Unknown error',
        turnComplete: true,
        interactionId,
      };
    }
  } else if (eventType === 'error') {
    return {
      errorCode: event.error?.code || 'UNKNOWN_ERROR',
      errorMessage: event.error?.message || 'Unknown error',
      turnComplete: true,
      interactionId,
    };
  }

  return null;
}

/**
 * Build generation config dict for interactions API.
 *
 * @param config - The GenerateContentConfig to extract parameters from.
 * @returns A dictionary containing generation configuration parameters.
 */
export function buildGenerationConfig(
  config?: GenerateContentConfig,
): Record<string, unknown> {
  if (!config) {
    return {};
  }

  const generationConfig: Record<string, unknown> = {};
  if (config.temperature !== undefined && config.temperature !== null) {
    generationConfig['temperature'] = config.temperature;
  }
  if (config.topP !== undefined && config.topP !== null) {
    generationConfig['top_p'] = config.topP;
  }
  if (config.topK !== undefined && config.topK !== null) {
    generationConfig['top_k'] = config.topK;
  }
  if (config.maxOutputTokens !== undefined && config.maxOutputTokens !== null) {
    generationConfig['max_output_tokens'] = config.maxOutputTokens;
  }
  if (config.stopSequences && config.stopSequences.length > 0) {
    generationConfig['stop_sequences'] = config.stopSequences;
  }
  if (config.presencePenalty !== undefined && config.presencePenalty !== null) {
    generationConfig['presence_penalty'] = config.presencePenalty;
  }
  if (
    config.frequencyPenalty !== undefined &&
    config.frequencyPenalty !== null
  ) {
    generationConfig['frequency_penalty'] = config.frequencyPenalty;
  }
  return generationConfig;
}

/**
 * Extract system instruction as a string from config.
 *
 * @param config - The GenerateContentConfig containing the system instruction.
 * @returns The system instruction as a string, or null if not present.
 */
export function extractSystemInstruction(
  config?: GenerateContentConfig,
): string | null {
  if (!config?.systemInstruction) {
    return null;
  }

  if (typeof config.systemInstruction === 'string') {
    return config.systemInstruction;
  }

  // Extract text from Content
  const instruction = config.systemInstruction as Content;
  if (instruction.parts) {
    const texts: string[] = [];
    for (const part of instruction.parts) {
      if (part.text) {
        texts.push(part.text);
      }
    }
    return texts.length > 0 ? texts.join('\n') : null;
  }
  return null;
}

/**
 * Extract the latest turn contents for interactions API.
 *
 * For interactions API with previousInteractionId, we only need to send
 * the current turn's messages since prior history is maintained by
 * the interaction chain.
 *
 * Special handling for function_result: When the user content contains a
 * function_result (response to a model's function_call), we must also include
 * the preceding model content with the function_call. The Interactions API
 * needs both the function_call and function_result to properly match call_ids.
 *
 * @param contents - The full list of content messages.
 * @returns A list containing the contents needed for the current turn.
 */
export function getLatestUserContents(contents: Content[]): Content[] {
  if (!contents || contents.length === 0) {
    return [];
  }

  // Find the latest continuous user messages from the end
  const latestUserContents: Content[] = [];
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i].role === 'user') {
      latestUserContents.unshift(contents[i]);
    } else {
      // Stop when we hit a non-user message
      break;
    }
  }

  // Check if the user contents contain a function_result
  let hasFunctionResult = false;
  for (const content of latestUserContents) {
    if (content.parts) {
      for (const part of content.parts) {
        if (part.functionResponse) {
          hasFunctionResult = true;
          break;
        }
      }
    }
    if (hasFunctionResult) {
      break;
    }
  }

  // If we have a function_result, we also need the preceding model content
  // with the function_call so the API can match the call_id
  if (hasFunctionResult && contents.length > latestUserContents.length) {
    // Get the index where user contents start
    const userStartIdx = contents.length - latestUserContents.length;
    if (userStartIdx > 0) {
      // Check if the content before user contents is a model turn with
      // function_call
      const precedingContent = contents[userStartIdx - 1];
      if (precedingContent.role === 'model' && precedingContent.parts) {
        for (const part of precedingContent.parts) {
          if (part.functionCall) {
            // Include the model's function_call turn before user's
            // function_result
            return [precedingContent, ...latestUserContents];
          }
        }
      }
    }
  }

  return latestUserContents;
}

/**
 * Build a log string for a single tool.
 */
function buildToolLog(tool: ToolParam): string {
  const toolType = tool.type || 'unknown';
  if (toolType === 'function') {
    const name = tool.name || 'unknown';
    const desc = tool.description || '';
    const params = tool.parameters;
    const paramsStr = params ? JSON.stringify(params) : '{}';
    return `${name}(${paramsStr}): ${desc}`;
  }
  return toolType;
}

/**
 * Build a log string for an interactions API request.
 */
export function buildInteractionsRequestLog(
  model: string,
  inputTurns: TurnParam[],
  systemInstruction: string | null,
  tools: ToolParam[] | null,
  generationConfig: Record<string, unknown> | null,
  previousInteractionId: string | null | undefined,
  stream: boolean,
): string {
  // Format input turns for logging
  const turnsLogs: string[] = [];
  for (const turn of inputTurns) {
    const role = turn.role || 'unknown';
    const contents = turn.content || [];
    const contentStrs: string[] = [];
    for (const content of contents) {
      const contentType = content.type || 'unknown';
      if (contentType === 'text') {
        let text = (content as {text: string}).text || '';
        // Truncate long text
        if (text.length > 200) {
          text = text.slice(0, 200) + '...';
        }
        contentStrs.push(`text: "${text}"`);
      } else if (contentType === 'function_call') {
        const fc = content as {name: string; arguments: Record<string, unknown>};
        contentStrs.push(`function_call: ${fc.name}(${JSON.stringify(fc.arguments)})`);
      } else if (contentType === 'function_result') {
        const fr = content as {call_id: string; result: string};
        let result = fr.result || '';
        // Truncate long results
        if (result.length > 200) {
          result = result.slice(0, 200) + '...';
        }
        contentStrs.push(`function_result[${fr.call_id}]: ${result}`);
      } else {
        contentStrs.push(`${contentType}: ...`);
      }
    }
    turnsLogs.push(`  [${role}]: ${contentStrs.join(', ')}`);
  }

  // Format tools for logging
  const toolsLogs: string[] = [];
  if (tools) {
    for (const tool of tools) {
      toolsLogs.push(`  ${buildToolLog(tool)}`);
    }
  }

  // Format generation config
  const configStr = generationConfig ? JSON.stringify(generationConfig) : '{}';

  return `
Interactions API Request:
-----------------------------------------------------------
Model: ${model}
Stream: ${stream}
Previous Interaction ID: ${previousInteractionId || '(none)'}
-----------------------------------------------------------
System Instruction:
${systemInstruction || '(none)'}
-----------------------------------------------------------
Generation Config:
${configStr}
-----------------------------------------------------------
Input Turns:
${turnsLogs.length > 0 ? turnsLogs.join('\n') : '(none)'}
-----------------------------------------------------------
Tools:
${toolsLogs.length > 0 ? toolsLogs.join('\n') : '(none)'}
-----------------------------------------------------------
`;
}

/**
 * Build a log string for an interactions API response.
 */
export function buildInteractionsResponseLog(interaction: Interaction): string {
  // Extract basic info
  const interactionId = interaction.id || 'unknown';
  const status = interaction.status || 'unknown';

  // Extract outputs
  const outputsLogs: string[] = [];
  if (interaction.outputs) {
    for (const output of interaction.outputs) {
      const outputType = output.type || 'unknown';
      if (outputType === 'text') {
        let text = output.text || '';
        if (text.length > 300) {
          text = text.slice(0, 300) + '...';
        }
        outputsLogs.push(`  text: "${text}"`);
      } else if (outputType === 'function_call') {
        const name = output.name || '';
        const args = output.arguments || {};
        outputsLogs.push(`  function_call: ${name}(${JSON.stringify(args)})`);
      } else {
        outputsLogs.push(`  ${outputType}: ...`);
      }
    }
  }

  // Extract usage
  let usageStr = '(none)';
  if (interaction.usage) {
    const inputTokens = interaction.usage.total_input_tokens || 0;
    const outputTokens = interaction.usage.total_output_tokens || 0;
    usageStr = `input_tokens: ${inputTokens}, output_tokens: ${outputTokens}`;
  }

  // Extract error if present
  let errorStr = '(none)';
  if (interaction.error) {
    const errorCode = interaction.error.code || 'unknown';
    const errorMessage = interaction.error.message || 'unknown';
    errorStr = `${errorCode}: ${errorMessage}`;
  }

  return `
Interactions API Response:
-----------------------------------------------------------
Interaction ID: ${interactionId}
Status: ${status}
-----------------------------------------------------------
Outputs:
${outputsLogs.length > 0 ? outputsLogs.join('\n') : '(none)'}
-----------------------------------------------------------
Usage:
${usageStr}
-----------------------------------------------------------
Error:
${errorStr}
-----------------------------------------------------------
`;
}

/**
 * Build a log string for an interactions API streaming event.
 */
export function buildInteractionsEventLog(event: InteractionSSEEvent): string {
  const eventType = event.event_type || 'unknown';
  const eventId = event.id;

  const details: string[] = [];

  if (eventType === 'content.delta') {
    const delta = event.delta;
    if (delta) {
      const deltaType = delta.type || 'unknown';
      if (deltaType === 'text') {
        let text = delta.text || '';
        if (text.length > 100) {
          text = text.slice(0, 100) + '...';
        }
        details.push(`text: "${text}"`);
      } else if (deltaType === 'function_call') {
        const name = delta.name || '';
        const args = delta.arguments || {};
        details.push(`function_call: ${name}(${JSON.stringify(args)})`);
      } else {
        details.push(`${deltaType}: ...`);
      }
    }
  } else if (eventType === 'interaction.status_update') {
    const status = event.status || 'unknown';
    details.push(`status: ${status}`);
  } else if (eventType === 'error') {
    const code = event.error?.code || 'unknown';
    const message = event.error?.message || 'unknown';
    details.push(`error: ${code} - ${message}`);
  }

  const detailsStr = details.length > 0 ? details.join(', ') : '';
  const idStr = eventId ? ` (id: ${eventId})` : '';

  return `Interactions SSE Event: ${eventType}${idStr} [${detailsStr}]`;
}

/**
 * Generate content using the interactions API.
 *
 * The interactions API provides stateful conversation capabilities. When
 * previousInteractionId is set in the request, the API chains interactions
 * instead of requiring full conversation history.
 *
 * Note: Context caching is not used with the Interactions API since it
 * maintains conversation state via previousInteractionId.
 *
 * @param apiClient - The Google GenAI client.
 * @param llmRequest - The LLM request to send.
 * @param stream - Whether to stream the response.
 * @yields LlmResponse objects converted from interaction responses.
 */
export async function* generateContentViaInteractions(
  apiClient: GoogleGenAI,
  llmRequest: LlmRequest,
  stream: boolean,
): AsyncGenerator<LlmResponse, void> {
  // When previousInteractionId is set, only send the latest continuous
  // user messages (the current turn) instead of full conversation history
  let contents = llmRequest.contents;
  if (llmRequest.previousInteractionId && contents) {
    contents = getLatestUserContents(contents);
  }

  // Convert contents to interactions API format
  const inputTurns = convertContentsToTurns(contents);
  const interactionTools = convertToolsConfigToInteractionsFormat(
    llmRequest.config,
  );
  const systemInstruction = extractSystemInstruction(llmRequest.config);
  const generationConfig = buildGenerationConfig(llmRequest.config);

  // Get previous interaction ID for stateful conversations
  const previousInteractionId = llmRequest.previousInteractionId;

  // Log the request
  logger.info(
    `Sending request via interactions API, model: ${llmRequest.model}, stream: ${stream}, previous_interaction_id: ${previousInteractionId}`,
  );

  logger.debug(
    buildInteractionsRequestLog(
      llmRequest.model || '',
      inputTurns,
      systemInstruction,
      interactionTools.length > 0 ? interactionTools : null,
      Object.keys(generationConfig).length > 0 ? generationConfig : null,
      previousInteractionId,
      stream,
    ),
  );

  // Track the current interaction ID from responses
  let currentInteractionId: string | undefined;

  // Access the interactions API
  // Note: The @google/genai SDK may have a different API structure.
  // This assumes there's an interactions.create method available.
  const interactions = (apiClient as unknown as {
    aio?: {
      interactions?: {
        create: (params: {
          model?: string;
          input: TurnParam[];
          stream: boolean;
          system_instruction?: string | null;
          tools?: ToolParam[] | null;
          generation_config?: Record<string, unknown> | null;
          previous_interaction_id?: string | null;
        }) => Promise<Interaction | AsyncIterable<InteractionSSEEvent>>;
      };
    };
    interactions?: {
      create: (params: {
        model?: string;
        input: TurnParam[];
        stream: boolean;
        systemInstruction?: string | null;
        tools?: ToolParam[] | null;
        generationConfig?: Record<string, unknown> | null;
        previousInteractionId?: string | null;
      }) => Promise<Interaction | AsyncIterable<InteractionSSEEvent>>;
    };
  });

  // Try different API access patterns
  const interactionsApi = interactions.aio?.interactions || interactions.interactions;

  if (!interactionsApi) {
    throw new Error(
      'Interactions API is not available on the provided API client. ' +
      'The Interactions API may not be supported in the current version of the @google/genai SDK.',
    );
  }

  if (stream) {
    // Streaming mode
    const responses = await interactionsApi.create({
      model: llmRequest.model,
      input: inputTurns,
      stream: true,
      system_instruction: systemInstruction,
      systemInstruction: systemInstruction,
      tools: interactionTools.length > 0 ? interactionTools : undefined,
      generation_config:
        Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
      generationConfig:
        Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
      previous_interaction_id: previousInteractionId,
      previousInteractionId: previousInteractionId,
    } as unknown as Parameters<typeof interactionsApi.create>[0]);

    const aggregatedParts: Part[] = [];
    for await (const event of responses as AsyncIterable<InteractionSSEEvent>) {
      // Log the streaming event
      logger.debug(buildInteractionsEventLog(event));

      // Extract interaction ID from event if available
      if (event.id) {
        currentInteractionId = event.id;
      }
      const llmResponse = convertInteractionEventToLlmResponse(
        event,
        aggregatedParts,
        currentInteractionId,
      );
      if (llmResponse) {
        yield llmResponse;
      }
    }

    // Final aggregated response
    if (aggregatedParts.length > 0) {
      yield {
        content: {role: 'model', parts: aggregatedParts},
        partial: false,
        turnComplete: true,
        finishReason: FinishReason.STOP,
        interactionId: currentInteractionId,
      };
    }
  } else {
    // Non-streaming mode
    const interaction = (await interactionsApi.create({
      model: llmRequest.model,
      input: inputTurns,
      stream: false,
      system_instruction: systemInstruction,
      systemInstruction: systemInstruction,
      tools: interactionTools.length > 0 ? interactionTools : undefined,
      generation_config:
        Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
      generationConfig:
        Object.keys(generationConfig).length > 0 ? generationConfig : undefined,
      previous_interaction_id: previousInteractionId,
      previousInteractionId: previousInteractionId,
    } as unknown as Parameters<typeof interactionsApi.create>[0])) as Interaction;

    // Log the response
    logger.info('Interaction response received from the model.');
    logger.debug(buildInteractionsResponseLog(interaction));

    yield convertInteractionToLlmResponse(interaction);
  }
}
