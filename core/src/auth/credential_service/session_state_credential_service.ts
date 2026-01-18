/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {ToolContext} from '../../tools/tool_context.js';
import {AuthCredential} from '../auth_credential.js';
import {AuthConfig} from '../auth_tool.js';

import {BaseCredentialService} from './base_credential_service.js';

/**
 * @experimental (Experimental, subject to change) Class for implementation of
 * credential service using session state as the store.
 *
 * Note: storing credentials in session may not be secure, use at your own risk.
 */
export class SessionStateCredentialService implements BaseCredentialService {
  /**
   * Loads the credential by auth config and current tool context from the
   * session state.
   *
   * @param authConfig The auth config which contains the auth scheme and auth
   *     credential information. authConfig.credentialKey will be used to
   *     build the key to load the credential.
   * @param toolContext The context of the current invocation when the tool is
   *     trying to load the credential.
   * @return A promise that resolves to the credential saved in the state.
   */
  async loadCredential(
    authConfig: AuthConfig,
    toolContext: ToolContext,
  ): Promise<AuthCredential | undefined> {
    return toolContext.state.get<AuthCredential>(authConfig.credentialKey);
  }

  /**
   * Saves the exchangedAuthCredential in auth config to the session state.
   *
   * @param authConfig The auth config which contains the auth scheme and auth
   *     credential information. authConfig.credentialKey will be used to
   *     build the key to save the credential.
   * @param toolContext The context of the current invocation when the tool is
   *     trying to save the credential.
   * @return A promise that resolves when the credential is saved to the state.
   */
  async saveCredential(
    authConfig: AuthConfig,
    toolContext: ToolContext,
  ): Promise<void> {
    if (authConfig.exchangedAuthCredential) {
      toolContext.state.set(
        authConfig.credentialKey,
        authConfig.exchangedAuthCredential,
      );
    }
  }
}
