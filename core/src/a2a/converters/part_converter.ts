/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Module containing utilities for conversion between A2A Part and Google GenAI Part.
 */

import type {Part as GenAIPart, Outcome, Language} from '@google/genai';
import {logger} from '../../utils/logger.js';
import {logA2aExperimentalWarning} from '../experimental.js';
import {getAdkMetadataKey} from './utils.js';

// Constants for A2A DataPart metadata
export const A2A_DATA_PART_METADATA_TYPE_KEY = 'type';
export const A2A_DATA_PART_METADATA_IS_LONG_RUNNING_KEY = 'is_long_running';
export const A2A_DATA_PART_METADATA_TYPE_FUNCTION_CALL = 'function_call';
export const A2A_DATA_PART_METADATA_TYPE_FUNCTION_RESPONSE = 'function_response';
export const A2A_DATA_PART_METADATA_TYPE_CODE_EXECUTION_RESULT =
  'code_execution_result';
export const A2A_DATA_PART_METADATA_TYPE_EXECUTABLE_CODE = 'executable_code';
export const A2A_DATA_PART_TEXT_MIME_TYPE = 'text/plain';

// Tags for wrapping DataPart JSON in inline_data
export const A2A_DATA_PART_START_TAG = '<a2a_datapart_json>';
export const A2A_DATA_PART_END_TAG = '</a2a_datapart_json>';

/**
 * A2A Part types from @a2a-js/sdk
 * These types are defined here to avoid strict dependency on the SDK at compile time.
 */
export interface A2ATextPart {
  kind: 'text';
  text: string;
  metadata?: Record<string, unknown>;
}

export interface A2AFileWithUri {
  uri: string;
  mimeType?: string;
}

export interface A2AFileWithBytes {
  bytes: string; // base64 encoded
  mimeType?: string;
}

export interface A2AFilePart {
  kind: 'file';
  file: A2AFileWithUri | A2AFileWithBytes;
  metadata?: Record<string, unknown>;
}

export interface A2ADataPart {
  kind: 'data';
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type A2APart = A2ATextPart | A2AFilePart | A2ADataPart;

/**
 * Type for converting A2A Part to GenAI Part.
 */
export type A2APartToGenAIPartConverter = (
  a2aPart: A2APart
) => GenAIPart | GenAIPart[] | undefined;

/**
 * Type for converting GenAI Part to A2A Part.
 */
export type GenAIPartToA2APartConverter = (
  part: GenAIPart
) => A2APart | A2APart[] | undefined;

/**
 * Type guard to check if an A2A file is a FileWithUri.
 */
function isFileWithUri(
  file: A2AFileWithUri | A2AFileWithBytes
): file is A2AFileWithUri {
  return 'uri' in file;
}

/**
 * Type guard to check if an A2A file is a FileWithBytes.
 */
function isFileWithBytes(
  file: A2AFileWithUri | A2AFileWithBytes
): file is A2AFileWithBytes {
  return 'bytes' in file;
}

/**
 * Converts an A2A Part to a Google GenAI Part.
 *
 * @param a2aPart - The A2A part to convert.
 * @returns The converted GenAI part, or undefined if conversion fails.
 */
export function convertA2aPartToGenaiPart(
  a2aPart: A2APart
): GenAIPart | undefined {
  logA2aExperimentalWarning();

  if (a2aPart.kind === 'text') {
    return {text: a2aPart.text};
  }

  if (a2aPart.kind === 'file') {
    if (isFileWithUri(a2aPart.file)) {
      return {
        fileData: {
          fileUri: a2aPart.file.uri,
          mimeType: a2aPart.file.mimeType,
        },
      };
    }

    if (isFileWithBytes(a2aPart.file)) {
      // Decode base64 bytes
      const decodedData = Buffer.from(a2aPart.file.bytes, 'base64');
      return {
        inlineData: {
          data: decodedData.toString('base64'),
          mimeType: a2aPart.file.mimeType,
        },
      };
    }

    logger.warn(
      `Cannot convert unsupported file type for A2A part: ${JSON.stringify(a2aPart)}`
    );
    return undefined;
  }

  if (a2aPart.kind === 'data') {
    // Check for ADK-specific metadata to determine the type
    const metadata = a2aPart.metadata;
    if (metadata) {
      const typeKey = getAdkMetadataKey(A2A_DATA_PART_METADATA_TYPE_KEY);
      const partType = metadata[typeKey];

      if (partType === A2A_DATA_PART_METADATA_TYPE_FUNCTION_CALL) {
        return {
          functionCall: {
            name: a2aPart.data.name as string,
            args: a2aPart.data.args as Record<string, unknown>,
            id: a2aPart.data.id as string | undefined,
          },
        };
      }

      if (partType === A2A_DATA_PART_METADATA_TYPE_FUNCTION_RESPONSE) {
        return {
          functionResponse: {
            name: a2aPart.data.name as string,
            response: a2aPart.data.response as Record<string, unknown>,
            id: a2aPart.data.id as string | undefined,
          },
        };
      }

      if (partType === A2A_DATA_PART_METADATA_TYPE_CODE_EXECUTION_RESULT) {
        return {
          codeExecutionResult: {
            outcome: a2aPart.data.outcome as Outcome,
            output: a2aPart.data.output as string | undefined,
          },
        };
      }

      if (partType === A2A_DATA_PART_METADATA_TYPE_EXECUTABLE_CODE) {
        return {
          executableCode: {
            language: a2aPart.data.language as Language,
            code: a2aPart.data.code as string,
          },
        };
      }
    }

    // Default case: wrap DataPart as inline_data with special tags
    const dataJson = JSON.stringify(a2aPart);
    const wrappedData = `${A2A_DATA_PART_START_TAG}${dataJson}${A2A_DATA_PART_END_TAG}`;
    return {
      inlineData: {
        data: Buffer.from(wrappedData).toString('base64'),
        mimeType: A2A_DATA_PART_TEXT_MIME_TYPE,
      },
    };
  }

  logger.warn(
    `Cannot convert unsupported part type for A2A part: ${JSON.stringify(a2aPart)}`
  );
  return undefined;
}

/**
 * Converts a Google GenAI Part to an A2A Part.
 *
 * @param part - The GenAI part to convert.
 * @returns The converted A2A part, or undefined if conversion fails.
 */
export function convertGenaiPartToA2aPart(
  part: GenAIPart
): A2APart | undefined {
  logA2aExperimentalWarning();

  if (part.text !== undefined) {
    const textPart: A2ATextPart = {kind: 'text', text: part.text};
    if ((part as Record<string, unknown>).thought !== undefined) {
      textPart.metadata = {
        [getAdkMetadataKey('thought')]: (part as Record<string, unknown>).thought,
      };
    }
    return textPart;
  }

  if (part.fileData) {
    return {
      kind: 'file',
      file: {
        uri: part.fileData.fileUri ?? '',
        mimeType: part.fileData.mimeType,
      } as A2AFileWithUri,
    };
  }

  if (part.inlineData) {
    // Check if this is a wrapped DataPart
    if (part.inlineData.mimeType === A2A_DATA_PART_TEXT_MIME_TYPE) {
      try {
        const decodedData = Buffer.from(
          part.inlineData.data ?? '',
          'base64'
        ).toString('utf-8');
        if (
          decodedData.startsWith(A2A_DATA_PART_START_TAG) &&
          decodedData.endsWith(A2A_DATA_PART_END_TAG)
        ) {
          const jsonData = decodedData.slice(
            A2A_DATA_PART_START_TAG.length,
            -A2A_DATA_PART_END_TAG.length
          );
          return JSON.parse(jsonData) as A2ADataPart;
        }
      } catch {
        // Not a wrapped DataPart, continue with default conversion
      }
    }

    // Default case for inline_data: convert to FileWithBytes
    const filePart: A2AFilePart = {
      kind: 'file',
      file: {
        bytes: part.inlineData.data ?? '',
        mimeType: part.inlineData.mimeType,
      } as A2AFileWithBytes,
    };

    // Handle video metadata if present
    const videoMetadata = (part as Record<string, unknown>).videoMetadata;
    if (videoMetadata) {
      filePart.metadata = {
        [getAdkMetadataKey('video_metadata')]: videoMetadata,
      };
    }

    return filePart;
  }

  // Convert function_call to A2A DataPart
  if (part.functionCall) {
    return {
      kind: 'data',
      data: {
        name: part.functionCall.name,
        args: part.functionCall.args,
        id: part.functionCall.id,
      },
      metadata: {
        [getAdkMetadataKey(
          A2A_DATA_PART_METADATA_TYPE_KEY
        )]: A2A_DATA_PART_METADATA_TYPE_FUNCTION_CALL,
      },
    };
  }

  // Convert function_response to A2A DataPart
  if (part.functionResponse) {
    return {
      kind: 'data',
      data: {
        name: part.functionResponse.name,
        response: part.functionResponse.response,
        id: part.functionResponse.id,
      },
      metadata: {
        [getAdkMetadataKey(
          A2A_DATA_PART_METADATA_TYPE_KEY
        )]: A2A_DATA_PART_METADATA_TYPE_FUNCTION_RESPONSE,
      },
    };
  }

  // Convert code_execution_result to A2A DataPart
  if (part.codeExecutionResult) {
    return {
      kind: 'data',
      data: {
        outcome: part.codeExecutionResult.outcome,
        output: part.codeExecutionResult.output,
      },
      metadata: {
        [getAdkMetadataKey(
          A2A_DATA_PART_METADATA_TYPE_KEY
        )]: A2A_DATA_PART_METADATA_TYPE_CODE_EXECUTION_RESULT,
      },
    };
  }

  // Convert executable_code to A2A DataPart
  if (part.executableCode) {
    return {
      kind: 'data',
      data: {
        language: part.executableCode.language,
        code: part.executableCode.code,
      },
      metadata: {
        [getAdkMetadataKey(
          A2A_DATA_PART_METADATA_TYPE_KEY
        )]: A2A_DATA_PART_METADATA_TYPE_EXECUTABLE_CODE,
      },
    };
  }

  logger.warn(
    `Cannot convert unsupported GenAI part: ${JSON.stringify(part)}`
  );
  return undefined;
}
