/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Content,
  FinishReason,
  FunctionCall,
  GenerateContentResponse,
  GenerateContentResponseUsageMetadata,
  Part,
} from '@google/genai';

import {LlmResponse} from '../models/llm_response.js';

/**
 * Represents a partial argument being accumulated during streaming function
 * calls.
 */
interface PartialArg {
  jsonPath: string;
  stringValue?: string;
  numberValue?: number;
  boolValue?: boolean;
  nullValue?: boolean;
}

/**
 * Aggregates partial streaming responses.
 *
 * It aggregates content from partial responses, and generates LlmResponses for
 * individual (partial) model responses, as well as for aggregated content.
 */
export class StreamingResponseAggregator {
  private text = '';
  private thoughtText = '';
  private usageMetadata?: GenerateContentResponseUsageMetadata;
  private response?: GenerateContentResponse;

  // For progressive SSE streaming mode: accumulate parts in order
  private partsSequence: Part[] = [];
  private currentTextBuffer = '';
  private currentTextIsThought?: boolean;
  private finishReason?: FinishReason;

  // For streaming function call arguments
  private currentFcName?: string;
  private currentFcArgs: Record<string, unknown> = {};
  private currentFcId?: string;
  private currentThoughtSignature?: string;

  /**
   * Flush current text buffer to parts sequence.
   *
   * This helper is used in progressive SSE mode to maintain part ordering.
   * It only merges consecutive text parts of the same type (thought or
   * regular).
   */
  private flushTextBufferToSequence(): void {
    if (this.currentTextBuffer) {
      if (this.currentTextIsThought) {
        this.partsSequence.push({text: this.currentTextBuffer, thought: true});
      } else {
        this.partsSequence.push({text: this.currentTextBuffer});
      }
      this.currentTextBuffer = '';
      this.currentTextIsThought = undefined;
    }
  }

  /**
   * Extract value from a partial argument.
   *
   * @param partialArg The partial argument object
   * @param jsonPath JSONPath for this argument
   * @returns Tuple of [value, hasValue] where hasValue indicates if a value
   *   exists
   */
  private getValueFromPartialArg(
    partialArg: PartialArg,
    jsonPath: string
  ): [unknown, boolean] {
    let value: unknown;
    let hasValue = false;

    if (partialArg.stringValue !== undefined) {
      // For streaming strings, append chunks to existing value
      const stringChunk = partialArg.stringValue;
      hasValue = true;

      // Get current value for this path (if any)
      const pathWithoutPrefix = jsonPath.startsWith('$.')
        ? jsonPath.slice(2)
        : jsonPath;
      const pathParts = pathWithoutPrefix.split('.');

      // Try to get existing value
      let existingValue: unknown = this.currentFcArgs;
      for (const part of pathParts) {
        if (
          typeof existingValue === 'object' &&
          existingValue !== null &&
          part in existingValue
        ) {
          existingValue = (existingValue as Record<string, unknown>)[part];
        } else {
          existingValue = undefined;
          break;
        }
      }

      // Append to existing string or set new value
      if (typeof existingValue === 'string') {
        value = existingValue + stringChunk;
      } else {
        value = stringChunk;
      }
    } else if (partialArg.numberValue !== undefined) {
      value = partialArg.numberValue;
      hasValue = true;
    } else if (partialArg.boolValue !== undefined) {
      value = partialArg.boolValue;
      hasValue = true;
    } else if (partialArg.nullValue !== undefined) {
      value = null;
      hasValue = true;
    }

    return [value, hasValue];
  }

  /**
   * Set a value in currentFcArgs using JSONPath notation.
   *
   * @param jsonPath JSONPath string like "$.location" or "$.location.latitude"
   * @param value The value to set
   */
  private setValueByJsonPath(jsonPath: string, value: unknown): void {
    // Remove leading "$." from jsonPath
    const path = jsonPath.startsWith('$.') ? jsonPath.slice(2) : jsonPath;

    // Split path into components
    const pathParts = path.split('.');

    // Navigate to the correct location and set the value
    let current: Record<string, unknown> = this.currentFcArgs;
    for (let i = 0; i < pathParts.length - 1; i++) {
      const part = pathParts[i];
      if (!(part in current)) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    // Set the final value
    current[pathParts[pathParts.length - 1]] = value;
  }

  /**
   * Flush current function call to parts sequence.
   *
   * This creates a complete FunctionCall part from accumulated partial args.
   */
  private flushFunctionCallToSequence(): void {
    if (this.currentFcName) {
      // Create function call part with accumulated args
      const functionCall: FunctionCall = {
        name: this.currentFcName,
        args: {...this.currentFcArgs},
      };

      // Set the ID if provided
      if (this.currentFcId) {
        functionCall.id = this.currentFcId;
      }

      const fcPart: Part = {functionCall};

      // Set thought_signature if provided
      if (this.currentThoughtSignature) {
        fcPart.thoughtSignature = this.currentThoughtSignature;
      }

      this.partsSequence.push(fcPart);

      // Reset FC state
      this.currentFcName = undefined;
      this.currentFcArgs = {};
      this.currentFcId = undefined;
      this.currentThoughtSignature = undefined;
    }
  }

  /**
   * Process a streaming function call with partialArgs.
   *
   * @param fc The function call object with partial_args
   * @param partialArgs Array of partial arguments
   */
  private processStreamingFunctionCall(
    fc: FunctionCall,
    partialArgs: PartialArg[]
  ): void {
    // Save function name if present (first chunk)
    if (fc.name) {
      this.currentFcName = fc.name;
    }
    if (fc.id) {
      this.currentFcId = fc.id;
    }

    // Process each partial argument
    for (const partialArg of partialArgs) {
      const jsonPath = partialArg.jsonPath;
      if (!jsonPath) {
        continue;
      }

      // Extract value from partial arg
      const [value, hasValue] = this.getValueFromPartialArg(
        partialArg,
        jsonPath
      );

      // Set the value using JSONPath (only if a value was provided)
      if (hasValue) {
        this.setValueByJsonPath(jsonPath, value);
      }
    }

    // Check if function call is complete
    // Note: In TypeScript, we check willContinue property on the function call
    const fcAny = fc as FunctionCall & {willContinue?: boolean};
    const fcWillContinue = fcAny.willContinue ?? false;
    if (!fcWillContinue) {
      // Function call complete, flush it
      this.flushTextBufferToSequence();
      this.flushFunctionCallToSequence();
    }
  }

  /**
   * Process a function call part (streaming or non-streaming).
   *
   * @param part The part containing a function call
   */
  private processFunctionCallPart(part: Part): void {
    const fc = part.functionCall;
    if (!fc) {
      return;
    }

    // Check if this is a streaming FC (has partialArgs)
    const fcAny = fc as FunctionCall & {partialArgs?: PartialArg[]};
    if (fcAny.partialArgs && fcAny.partialArgs.length > 0) {
      // Streaming function call arguments
      // Save thought_signature from the part (first chunk should have it)
      if (part.thoughtSignature && !this.currentThoughtSignature) {
        this.currentThoughtSignature = part.thoughtSignature;
      }
      this.processStreamingFunctionCall(fc, fcAny.partialArgs);
    } else {
      // Non-streaming function call (standard format with args)
      // Skip empty function calls (used as streaming end markers)
      if (fc.name) {
        // Flush any buffered text first, then add the FC part
        this.flushTextBufferToSequence();
        this.partsSequence.push(part);
      }
    }
  }

  /**
   * Processes a single model response.
   *
   * @param response The response to process.
   * @param progressiveSseEnabled Whether progressive SSE streaming is enabled.
   * @yields The generated LlmResponse(s), for the partial response, and the
   *   aggregated response if needed.
   */
  async *processResponse(
    response: GenerateContentResponse,
    progressiveSseEnabled = false
  ): AsyncGenerator<LlmResponse, void, void> {
    this.response = response;
    const llmResponse = this.createLlmResponseFromGenerateContentResponse(
      response
    );
    this.usageMetadata = llmResponse.usageMetadata;

    // Save finish_reason for final aggregation
    if (llmResponse.finishReason) {
      this.finishReason = llmResponse.finishReason;
    }

    if (progressiveSseEnabled) {
      // ========== Progressive SSE Streaming (new feature) ==========
      // Accumulate parts while preserving their order
      // Only merge consecutive text parts of the same type (thought or regular)
      if (llmResponse.content?.parts) {
        for (const part of llmResponse.content.parts) {
          if (part.text) {
            // Check if we need to flush the current buffer first
            // (when text type changes from thought to regular or vice versa)
            if (
              this.currentTextBuffer &&
              part.thought !== this.currentTextIsThought
            ) {
              this.flushTextBufferToSequence();
            }

            // Accumulate text to buffer
            if (!this.currentTextBuffer) {
              this.currentTextIsThought = part.thought;
            }
            this.currentTextBuffer += part.text;
          } else if (part.functionCall) {
            // Process function call (handles both streaming Args and
            // non-streaming Args)
            this.processFunctionCallPart(part);
          } else {
            // Other non-text parts (bytes, etc.)
            // Flush any buffered text first, then add the non-text part
            this.flushTextBufferToSequence();
            this.partsSequence.push(part);
          }
        }

        // Mark ALL intermediate chunks as partial
        llmResponse.partial = true;
        yield llmResponse;
        return;
      }
    }

    // ========== Non-Progressive SSE Streaming (old behavior) ==========
    if (
      llmResponse.content?.parts?.[0]?.text
    ) {
      const part0 = llmResponse.content.parts[0];
      if (part0.thought) {
        this.thoughtText += part0.text;
      } else {
        this.text += part0.text;
      }
      llmResponse.partial = true;
    } else if (
      (this.thoughtText || this.text) &&
      (!llmResponse.content?.parts?.[0]?.inlineData)
    ) {
      const parts: Part[] = [];
      if (this.thoughtText) {
        parts.push({text: this.thoughtText, thought: true});
      }
      if (this.text) {
        parts.push({text: this.text});
      }
      yield {
        content: {role: 'model', parts},
        usageMetadata: llmResponse.usageMetadata,
      };
      this.thoughtText = '';
      this.text = '';
    }
    yield llmResponse;
  }

  /**
   * Generate an aggregated response at the end, if needed.
   *
   * This should be called after all the model responses are processed.
   *
   * @param progressiveSseEnabled Whether progressive SSE streaming is enabled.
   * @returns The aggregated LlmResponse.
   */
  close(progressiveSseEnabled = false): LlmResponse | undefined {
    if (progressiveSseEnabled) {
      // ========== Progressive SSE Streaming (new feature) ==========
      // Always generate final aggregated response in progressive mode
      if (this.response?.candidates) {
        // Flush any remaining buffers to complete the sequence
        this.flushTextBufferToSequence();
        this.flushFunctionCallToSequence();

        // Use the parts sequence which preserves original ordering
        const finalParts = this.partsSequence;

        if (finalParts.length > 0) {
          const candidate = this.response.candidates[0];
          const finishReason =
            this.finishReason ?? candidate?.finishReason;

          return {
            content: {role: 'model', parts: finalParts},
            errorCode:
              finishReason === 'STOP' ? undefined : String(finishReason),
            errorMessage:
              finishReason === 'STOP' ? undefined : candidate?.finishMessage,
            usageMetadata: this.usageMetadata,
            finishReason,
            partial: false,
          };
        }

        return undefined;
      }
    }

    // ========== Non-Progressive SSE Streaming (old behavior) ==========
    if (
      (this.text || this.thoughtText) &&
      this.response?.candidates
    ) {
      const parts: Part[] = [];
      if (this.thoughtText) {
        parts.push({text: this.thoughtText, thought: true});
      }
      if (this.text) {
        parts.push({text: this.text});
      }
      const candidate = this.response.candidates[0];
      return {
        content: {role: 'model', parts},
        errorCode:
          candidate?.finishReason === 'STOP'
            ? undefined
            : String(candidate?.finishReason),
        errorMessage:
          candidate?.finishReason === 'STOP'
            ? undefined
            : candidate?.finishMessage,
        usageMetadata: this.usageMetadata,
      };
    }
    return undefined;
  }

  /**
   * Creates an LlmResponse from a GenerateContentResponse.
   */
  private createLlmResponseFromGenerateContentResponse(
    response: GenerateContentResponse
  ): LlmResponse {
    const usageMetadata = response.usageMetadata;

    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content?.parts && candidate.content.parts.length > 0) {
        return {
          content: candidate.content as Content,
          groundingMetadata: candidate.groundingMetadata,
          usageMetadata,
          finishReason: candidate.finishReason,
        };
      }

      return {
        errorCode: candidate.finishReason,
        errorMessage: candidate.finishMessage,
        usageMetadata,
        finishReason: candidate.finishReason,
      };
    }

    if (response.promptFeedback) {
      return {
        errorCode: response.promptFeedback.blockReason,
        errorMessage: response.promptFeedback.blockReasonMessage,
        usageMetadata,
      };
    }

    // The ultimate fallback for an unknown error state
    return {
      errorCode: 'UNKNOWN_ERROR',
      errorMessage: 'Unknown error.',
      usageMetadata,
    };
  }

  /**
   * Resets the aggregator state for reuse.
   */
  reset(): void {
    this.text = '';
    this.thoughtText = '';
    this.usageMetadata = undefined;
    this.response = undefined;
    this.partsSequence = [];
    this.currentTextBuffer = '';
    this.currentTextIsThought = undefined;
    this.finishReason = undefined;
    this.currentFcName = undefined;
    this.currentFcArgs = {};
    this.currentFcId = undefined;
    this.currentThoughtSignature = undefined;
  }
}
