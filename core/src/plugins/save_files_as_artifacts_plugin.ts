/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, FileData, Part} from '@google/genai';

import {InvocationContext} from '../agents/invocation_context.js';
import {logger} from '../utils/logger.js';

import {BasePlugin} from './base_plugin.js';

/**
 * URI schemes that are accessible to the model for file references.
 * Vertex AI exposes `gs://` while hosted endpoints use HTTPS.
 */
const MODEL_ACCESSIBLE_URI_SCHEMES = new Set(['gs', 'https', 'http']);

/**
 * Checks if a URI is accessible to the model.
 *
 * @param uri The URI to check.
 * @returns True if the URI scheme is model-accessible.
 */
function isModelAccessibleUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    return MODEL_ACCESSIBLE_URI_SCHEMES.has(url.protocol.replace(':', '').toLowerCase());
  } catch {
    return false;
  }
}

/**
 * Configuration options for SaveFilesAsArtifactsPlugin.
 */
export interface SaveFilesAsArtifactsPluginOptions {
  /**
   * The name of the plugin instance.
   * @default 'save_files_as_artifacts_plugin'
   */
  name?: string;
}

/**
 * A plugin that saves files embedded in user messages as artifacts.
 *
 * This is useful to allow users to upload files in the chat experience and have
 * those files available to the agent within the current session.
 *
 * The plugin uses Blob.display_name to determine the file name. By default,
 * artifacts are session-scoped. For cross-session persistence, prefix the
 * filename with "user:".
 *
 * Artifacts with the same name will be overwritten. A placeholder with the
 * artifact name will be put in place of the embedded file in the user message
 * so the model knows where to find the file. You may want to add a
 * load_artifacts tool to the agent, or load the artifacts in your own tool to
 * use the files.
 *
 * @example
 * ```typescript
 * const plugin = new SaveFilesAsArtifactsPlugin();
 *
 * const runner = new Runner({
 *   agent: myAgent,
 *   plugins: [plugin],
 * });
 * ```
 */
export class SaveFilesAsArtifactsPlugin extends BasePlugin {
  /**
   * Creates a new SaveFilesAsArtifactsPlugin instance.
   *
   * @param options Configuration options for the plugin.
   */
  constructor(options: SaveFilesAsArtifactsPluginOptions = {}) {
    super(options.name ?? 'save_files_as_artifacts_plugin');
  }

  /**
   * Process user message and save any attached files as artifacts.
   *
   * This callback is executed when a user message is received before an
   * invocation starts. It detects any inline_data parts in the message,
   * saves them as artifacts, and replaces them with placeholders and
   * file references.
   *
   * @param invocationContext The context for the entire invocation.
   * @param userMessage The message content input by user.
   * @returns A modified Content if files were saved, undefined otherwise.
   */
  override async onUserMessageCallback({
    invocationContext,
    userMessage,
  }: {
    invocationContext: InvocationContext;
    userMessage: Content;
  }): Promise<Content | undefined> {
    if (!invocationContext.artifactService) {
      logger.warn(
        'Artifact service is not set. SaveFilesAsArtifactsPlugin will not be enabled.'
      );
      return undefined;
    }

    if (!userMessage.parts || userMessage.parts.length === 0) {
      return undefined;
    }

    const newParts: Part[] = [];
    let modified = false;

    for (let i = 0; i < userMessage.parts.length; i++) {
      const part = userMessage.parts[i];

      if (!part.inlineData) {
        newParts.push(part);
        continue;
      }

      try {
        const inlineData = part.inlineData;

        // Use display_name if available, otherwise generate a filename
        let fileName = inlineData.displayName;
        if (!fileName) {
          fileName = `artifact_${invocationContext.invocationId}_${i}`;
          logger.info(
            `No display_name found, using generated filename: ${fileName}`
          );
        }

        // Store original filename for display to user/placeholder
        const displayName = fileName;

        // Create a copy to stop mutation of the saved artifact if the
        // original part is modified
        const artifactPart: Part = {
          inlineData: {
            mimeType: inlineData.mimeType,
            data: inlineData.data,
            displayName: inlineData.displayName,
          },
        };

        const version = await invocationContext.artifactService.saveArtifact({
          appName: invocationContext.appName,
          userId: invocationContext.userId,
          sessionId: invocationContext.session.id,
          filename: fileName,
          artifact: artifactPart,
        });

        // Add a placeholder text part so the model knows where to find the file
        const placeholderPart: Part = {
          text: `[Uploaded Artifact: "${displayName}"]`,
        };
        newParts.push(placeholderPart);

        // Try to build a file reference part if the artifact URI is
        // model-accessible
        const filePart = await this.buildFileReferencePart({
          invocationContext,
          filename: fileName,
          version,
          mimeType: inlineData.mimeType,
          displayName,
        });
        if (filePart) {
          newParts.push(filePart);
        }

        modified = true;
        logger.info(`Successfully saved artifact: ${fileName}`);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        logger.error(`Failed to save artifact for part ${i}: ${errorMessage}`);
        // Keep the original part if saving fails
        newParts.push(part);
      }
    }

    if (modified) {
      return {role: userMessage.role, parts: newParts};
    }

    return undefined;
  }

  /**
   * Constructs a file reference part if the artifact URI is model-accessible.
   *
   * @param params Parameters for building the file reference.
   * @returns A Part with file_data if the URI is accessible, undefined otherwise.
   */
  private async buildFileReferencePart({
    invocationContext,
    filename,
    version,
    mimeType,
    displayName,
  }: {
    invocationContext: InvocationContext;
    filename: string;
    version: number;
    mimeType?: string;
    displayName: string;
  }): Promise<Part | undefined> {
    const artifactService = invocationContext.artifactService;
    if (!artifactService) {
      return undefined;
    }

    try {
      const artifactVersion = await artifactService.getArtifactVersion({
        appName: invocationContext.appName,
        userId: invocationContext.userId,
        sessionId: invocationContext.session.id,
        filename,
        version,
      });

      if (
        !artifactVersion ||
        !artifactVersion.canonicalUri ||
        !isModelAccessibleUri(artifactVersion.canonicalUri)
      ) {
        return undefined;
      }

      const fileData: FileData = {
        fileUri: artifactVersion.canonicalUri,
        mimeType: mimeType ?? artifactVersion.mimeType,
        displayName,
      };

      return {fileData};
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.warn(
        `Failed to resolve artifact version for ${filename}: ${errorMessage}`
      );
      return undefined;
    }
  }
}
