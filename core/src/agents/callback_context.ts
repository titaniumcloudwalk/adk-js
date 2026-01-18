/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Part} from '@google/genai';

import {ArtifactVersion} from '../artifacts/base_artifact_service.js';
import {createEventActions, EventActions} from '../events/event_actions.js';
import {State} from '../sessions/state.js';

import {InvocationContext} from './invocation_context.js';
import {ReadonlyContext} from './readonly_context.js';

/**
 * The context of various callbacks within an agent run.
 */
export class CallbackContext extends ReadonlyContext {
  private readonly _state: State;

  readonly eventActions: EventActions;

  constructor({invocationContext, eventActions}: {
    invocationContext: InvocationContext,
    eventActions?: EventActions,
  }) {
    super(invocationContext);
    this.eventActions = eventActions || createEventActions();
    this._state = new State(
        invocationContext.session.state,
        this.eventActions.stateDelta,
    );
  }

  /**
   * The delta-aware state of the current session.
   */
  override get state() {
    return this._state;
  }

  /**
   * Loads an artifact attached to the current session.
   *
   * @param filename The filename of the artifact.
   * @param version The version of the artifact. If not provided, the latest
   *     version will be used.
   * @return A promise that resolves to the loaded artifact.
   */
  loadArtifact(filename: string, version?: number): Promise<Part|undefined> {
    if (!this.invocationContext.artifactService) {
      throw new Error('Artifact service is not initialized.');
    }

    return this.invocationContext.artifactService.loadArtifact({
      appName: this.invocationContext.appName,
      userId: this.invocationContext.userId,
      sessionId: this.invocationContext.session.id,
      filename,
      version,
    });
  }

  /**
   * Saves an artifact attached to the current session.
   *
   * @param filename The filename of the artifact.
   * @param artifact The artifact to save.
   * @return A promise that resolves to the version of the saved artifact.
   */
  async saveArtifact(filename: string, artifact: Part): Promise<number> {
    if (!this.invocationContext.artifactService) {
      throw new Error('Artifact service is not initialized.');
    }

    const version = await this.invocationContext.artifactService.saveArtifact({
      appName: this.invocationContext.appName,
      userId: this.invocationContext.userId,
      sessionId: this.invocationContext.session.id,
      filename,
      artifact,
    });
    this.eventActions.artifactDelta[filename] = version;

    return version;
  }

  /**
   * Loads a credential from the credential service.
   *
   * @param authConfig The auth config containing the credential key.
   * @return A promise that resolves to the loaded credential, or undefined if
   *     not found.
   */
  async loadCredential(authConfig: any): Promise<any> {
    if (!this.invocationContext.credentialService) {
      return undefined;
    }

    return await this.invocationContext.credentialService.loadCredential(
      authConfig,
      this as any,
    );
  }

  /**
   * Saves a credential to the credential service.
   *
   * @param authConfig The auth config containing the credential to save.
   * @return A promise that resolves when the credential is saved.
   */
  async saveCredential(authConfig: any): Promise<void> {
    if (!this.invocationContext.credentialService) {
      return;
    }

    await this.invocationContext.credentialService.saveCredential(
      authConfig,
      this as any,
    );
  }

  /**
   * Gets artifact version info.
   *
   * @param filename The filename of the artifact.
   * @param version The version of the artifact. If not provided, the latest
   *     version will be returned.
   * @return A promise that resolves to the artifact version info, or undefined
   *     if not found.
   */
  getArtifactVersion(
      filename: string, version?: number): Promise<ArtifactVersion|undefined> {
    if (!this.invocationContext.artifactService) {
      throw new Error('Artifact service is not initialized.');
    }

    return this.invocationContext.artifactService.getArtifactVersion({
      appName: this.invocationContext.appName,
      userId: this.invocationContext.userId,
      sessionId: this.invocationContext.session.id,
      filename,
      version,
    });
  }

  /**
   * Lists the filenames of the artifacts attached to the current session.
   *
   * @return A promise that resolves to a list of artifact filenames.
   */
  listArtifacts(): Promise<string[]> {
    if (!this.invocationContext.artifactService) {
      throw new Error('Artifact service is not initialized.');
    }

    return this.invocationContext.artifactService.listArtifactKeys({
      appName: this.invocationContext.appName,
      userId: this.invocationContext.userId,
      sessionId: this.invocationContext.session.id,
    });
  }

  /**
   * Triggers memory generation for the current session.
   *
   * This method saves the current session's events to the memory service,
   * enabling the agent to recall information from past interactions.
   *
   * @return A promise that resolves when the session is added to memory.
   *
   * @example
   * ```typescript
   * async function myAfterAgentCallback(callbackContext: CallbackContext) {
   *   // Save conversation to memory at the end of each interaction
   *   await callbackContext.addSessionToMemory();
   * }
   * ```
   */
  async addSessionToMemory(): Promise<void> {
    if (!this.invocationContext.memoryService) {
      throw new Error(
          'Cannot add session to memory: memory service is not available.');
    }

    await this.invocationContext.memoryService.addSessionToMemory(
        this.invocationContext.session);
  }
}
