/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, FunctionDeclaration, Part, Type} from '@google/genai';

import {LlmRequest, appendInstructions} from '../models/llm_request.js';
import {logger} from '../utils/logger.js';
import {BaseTool} from './base_tool.js';
import {ToolContext} from './tool_context.js';

/**
 * MIME types Gemini accepts for inline data in requests.
 */
const GEMINI_SUPPORTED_INLINE_MIME_PREFIXES = ['image/', 'audio/', 'video/'];

const GEMINI_SUPPORTED_INLINE_MIME_TYPES = new Set(['application/pdf']);

const TEXT_LIKE_MIME_TYPES = new Set([
  'application/csv',
  'application/json',
  'application/xml',
]);

/**
 * Normalizes a MIME type by removing parameters like charset.
 */
function normalizeMimeType(mimeType: string | undefined): string | undefined {
  if (!mimeType) {
    return undefined;
  }
  return mimeType.split(';', 2)[0].trim();
}

/**
 * Returns true if Gemini accepts this MIME type as inline data.
 */
function isInlineMimeTypeSupported(mimeType: string | undefined): boolean {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized) {
    return false;
  }
  if (GEMINI_SUPPORTED_INLINE_MIME_TYPES.has(normalized)) {
    return true;
  }
  return GEMINI_SUPPORTED_INLINE_MIME_PREFIXES.some((prefix) =>
    normalized.startsWith(prefix)
  );
}

/**
 * Best-effort base64 decode for both standard and URL-safe formats.
 */
function maybeBase64ToBytes(data: string): Uint8Array | undefined {
  // Standard base64 decode
  try {
    // Check if it's valid base64
    if (/^[A-Za-z0-9+/]*={0,2}$/.test(data) && data.length % 4 === 0) {
      const binary = atob(data);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes;
    }
  } catch {
    // Fall through to URL-safe decode
  }

  // URL-safe base64 decode
  try {
    // Convert URL-safe base64 to standard base64
    const standardBase64 = data.replace(/-/g, '+').replace(/_/g, '/');
    // Add padding if needed
    const paddedBase64 = standardBase64.padEnd(
      standardBase64.length + ((4 - (standardBase64.length % 4)) % 4),
      '='
    );
    const binary = atob(paddedBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return undefined;
  }
}

/**
 * Returns a Part that is safe to send to Gemini.
 * Converts unsupported inline MIME types to text.
 */
function asSafePartForLlm(artifact: Part, artifactName: string): Part {
  const inlineData = artifact.inlineData;
  if (!inlineData) {
    return artifact;
  }

  if (isInlineMimeTypeSupported(inlineData.mimeType)) {
    return artifact;
  }

  const mimeType =
    normalizeMimeType(inlineData.mimeType) ?? 'application/octet-stream';
  const data = inlineData.data;

  if (data === undefined || data === null) {
    return {
      text: `[Artifact: ${artifactName}, type: ${mimeType}. No inline data was provided.]`,
    };
  }

  // Convert string data to bytes if it's base64 encoded
  let bytes: Uint8Array | undefined;
  if (typeof data === 'string') {
    bytes = maybeBase64ToBytes(data);
    if (!bytes) {
      // Not valid base64, treat as plain text
      return {text: data};
    }
  } else {
    // Assume Uint8Array or ArrayBufferView
    bytes = data as Uint8Array;
  }

  // Try to decode as text for text-like MIME types
  if (mimeType.startsWith('text/') || TEXT_LIKE_MIME_TYPES.has(mimeType)) {
    const decoder = new TextDecoder('utf-8', {fatal: false});
    const text = decoder.decode(bytes);
    return {text};
  }

  // Binary data that can't be displayed inline
  const sizeKb = bytes.length / 1024;
  return {
    text: `[Binary artifact: ${artifactName}, type: ${mimeType}, size: ${sizeKb.toFixed(1)} KB. Content cannot be displayed inline.]`,
  };
}

/**
 * A tool that loads artifacts and adds them to the session.
 *
 * When the LLM calls this tool, it retrieves artifacts from the artifact
 * service and makes them available in the LLM request.
 *
 * @example
 * ```typescript
 * const agent = new LlmAgent({
 *   name: 'artifact_agent',
 *   model: 'gemini-2.0-flash',
 *   tools: [loadArtifactsTool],
 * });
 * ```
 */
export class LoadArtifactsTool extends BaseTool {
  constructor() {
    super({
      name: 'load_artifacts',
      description: `Loads artifacts into the session for this request.

NOTE: Call when you need access to artifacts (for example, uploads saved by the
web UI).`,
    });
  }

  /**
   * Returns the function declaration for this tool.
   */
  override _getDeclaration(): FunctionDeclaration | undefined {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          artifact_names: {
            type: Type.ARRAY,
            items: {
              type: Type.STRING,
            },
          },
        },
      },
    };
  }

  /**
   * Runs the tool to load artifacts.
   */
  override async runAsync({
    args,
  }: {
    args: Record<string, unknown>;
    toolContext: ToolContext;
  }): Promise<Record<string, unknown>> {
    const artifactNames = (args.artifact_names as string[]) ?? [];
    return {
      artifact_names: artifactNames,
      status:
        'artifact contents temporarily inserted and removed. to access ' +
        'these artifacts, call load_artifacts tool again.',
    };
  }

  /**
   * Processes the LLM request to append artifact information.
   */
  override async processLlmRequest({
    toolContext,
    llmRequest,
  }: {
    toolContext: ToolContext;
    llmRequest: LlmRequest;
  }): Promise<void> {
    await super.processLlmRequest({toolContext, llmRequest});
    await this.appendArtifactsToLlmRequest({toolContext, llmRequest});
  }

  /**
   * Appends artifact information and content to the LLM request.
   */
  private async appendArtifactsToLlmRequest({
    toolContext,
    llmRequest,
  }: {
    toolContext: ToolContext;
    llmRequest: LlmRequest;
  }): Promise<void> {
    const artifactNames = await toolContext.listArtifacts();
    if (!artifactNames || artifactNames.length === 0) {
      return;
    }

    // Tell the model about the available artifacts
    appendInstructions(llmRequest, [
      `You have a list of artifacts:
  ${JSON.stringify(artifactNames)}

  When the user asks questions about any of the artifacts, you should call the
  \`load_artifacts\` function to load the artifact. Always call load_artifacts
  before answering questions related to the artifacts, regardless of whether the
  artifacts have been loaded before. Do not depend on prior answers about the
  artifacts.`,
    ]);

    // Attach the content of the artifacts if the model requests them
    // This only adds the content to the model request, instead of the session
    if (llmRequest.contents && llmRequest.contents.length > 0) {
      const lastContent = llmRequest.contents[llmRequest.contents.length - 1];
      if (lastContent.parts && lastContent.parts.length > 0) {
        const functionResponse = lastContent.parts[0].functionResponse;
        if (functionResponse && functionResponse.name === 'load_artifacts') {
          const response = (functionResponse.response ?? {}) as Record<
            string,
            unknown
          >;
          const requestedArtifactNames =
            (response.artifact_names as string[]) ?? [];

          for (const artifactName of requestedArtifactNames) {
            // Try session-scoped first (default behavior)
            let artifact = await toolContext.loadArtifact(artifactName);

            // If not found and name doesn't already have user: prefix,
            // try cross-session artifacts with user: prefix
            if (!artifact && !artifactName.startsWith('user:')) {
              const prefixedName = `user:${artifactName}`;
              artifact = await toolContext.loadArtifact(prefixedName);
            }

            if (!artifact) {
              logger.warn(`Artifact "${artifactName}" not found, skipping`);
              continue;
            }

            const artifactPart = asSafePartForLlm(artifact, artifactName);
            if (artifactPart !== artifact) {
              const mimeType = artifact.inlineData?.mimeType;
              logger.debug(
                `Converted artifact "${artifactName}" (mimeType=${mimeType}) to text Part`
              );
            }

            // Append the artifact content to the LLM request
            const artifactContent: Content = {
              role: 'user',
              parts: [{text: `Artifact ${artifactName} is:`}, artifactPart],
            };
            llmRequest.contents!.push(artifactContent);
          }
        }
      }
    }
  }
}

/**
 * Singleton instance of LoadArtifactsTool.
 */
export const loadArtifactsTool = new LoadArtifactsTool();
