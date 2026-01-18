/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {AuthCredential, AuthCredentialTypes, isOAuth2Expired} from '../../auth/auth_credential.js';
import {AuthScheme, AuthSchemeType} from '../../auth/auth_schemes.js';
import {OAuth2CredentialRefresher} from '../../auth/refresher/oauth2_credential_refresher.js';
import {ToolContext} from '../tool_context.js';

import {externalExchangeRequired, getSchemeType} from './auth_helpers.js';

/**
 * State of the authentication preparation process.
 */
export type AuthPreparationState = 'pending' | 'done';

/**
 * Result of the credential preparation process.
 */
export interface AuthPreparationResult {
  state: AuthPreparationState;
  authScheme?: AuthScheme;
  authCredential?: AuthCredential;
}

/**
 * Handles storage and retrieval of credentials within a ToolContext.
 */
export class ToolContextCredentialStore {
  constructor(private readonly toolContext: ToolContext) {}

  /**
   * Generates a unique key for the given auth scheme and credential.
   */
  getCredentialKey(
    authScheme?: AuthScheme,
    authCredential?: AuthCredential
  ): string {
    const schemeName = authScheme
      ? `${getSchemeType(authScheme) || 'unknown'}_${JSON.stringify(authScheme)}`
      : '';
    const credentialName = authCredential
      ? `${authCredential.authType}_${JSON.stringify(authCredential)}`
      : '';

    return `${schemeName}_${credentialName}_existing_exchanged_credential`;
  }

  /**
   * Gets a stored credential from the tool context state.
   */
  getCredential(
    authScheme?: AuthScheme,
    authCredential?: AuthCredential
  ): AuthCredential | undefined {
    if (!this.toolContext) {
      return undefined;
    }

    const tokenKey = this.getCredentialKey(authScheme, authCredential);
    const serializedCredential = this.toolContext.state.get(tokenKey) as
      | AuthCredential
      | undefined;

    return serializedCredential;
  }

  /**
   * Stores a credential in the tool context state.
   */
  storeCredential(key: string, authCredential: AuthCredential): void {
    if (this.toolContext) {
      this.toolContext.state.set(key, authCredential);
    }
  }

  /**
   * Removes a credential from the tool context state.
   */
  removeCredential(key: string): void {
    this.toolContext.state.set(key, undefined);
  }
}

/**
 * Handles the preparation and exchange of authentication credentials for tools.
 */
export class ToolAuthHandler {
  private readonly toolContext: ToolContext;
  private readonly authScheme?: AuthScheme;
  private readonly authCredential?: AuthCredential;
  private readonly credentialStore?: ToolContextCredentialStore;
  private readonly credentialRefresher: OAuth2CredentialRefresher;

  constructor(params: {
    toolContext: ToolContext;
    authScheme?: AuthScheme;
    authCredential?: AuthCredential;
    credentialStore?: ToolContextCredentialStore;
  }) {
    this.toolContext = params.toolContext;
    this.authScheme = params.authScheme ? {...params.authScheme} : undefined;
    this.authCredential = params.authCredential
      ? {...params.authCredential}
      : undefined;
    this.credentialStore = params.credentialStore;
    this.credentialRefresher = new OAuth2CredentialRefresher();
  }

  /**
   * Creates a ToolAuthHandler from a ToolContext.
   */
  static fromToolContext(
    toolContext: ToolContext,
    authScheme?: AuthScheme,
    authCredential?: AuthCredential
  ): ToolAuthHandler {
    const credentialStore = new ToolContextCredentialStore(toolContext);
    return new ToolAuthHandler({
      toolContext,
      authScheme,
      authCredential,
      credentialStore,
    });
  }

  /**
   * Checks for and returns an existing, exchanged credential.
   */
  private async getExistingCredential(): Promise<AuthCredential | undefined> {
    if (!this.credentialStore) {
      return undefined;
    }

    const existingCredential = this.credentialStore.getCredential(
      this.authScheme,
      this.authCredential
    );

    if (!existingCredential) {
      return undefined;
    }

    // Check if OAuth2 credential needs refresh
    if (existingCredential.oauth2) {
      if (isOAuth2Expired(existingCredential.oauth2)) {
        try {
          const refreshed = await this.credentialRefresher.refresh(
            existingCredential,
            this.authScheme
          );
          return refreshed;
        } catch {
          // If refresh fails, return undefined to trigger new auth
          return undefined;
        }
      }
    }

    return existingCredential;
  }

  /**
   * Stores the auth credential.
   */
  private storeCredential(authCredential: AuthCredential): void {
    if (this.credentialStore) {
      const key = this.credentialStore.getCredentialKey(
        this.authScheme,
        this.authCredential
      );
      this.credentialStore.storeCredential(key, authCredential);
    }
  }

  /**
   * Generates a unique credential key for storing/retrieving credentials.
   */
  private getCredentialKey(): string {
    const schemeStr = this.authScheme ? JSON.stringify(this.authScheme) : '';
    const credStr = this.authCredential ? JSON.stringify(this.authCredential) : '';
    return `openapi_auth_${schemeStr}_${credStr}`;
  }

  /**
   * Requests a credential from the tool context.
   */
  private requestCredential(): void {
    if (!this.authScheme) {
      return;
    }

    const schemeType = getSchemeType(this.authScheme);

    if (
      schemeType === AuthSchemeType.openIdConnect ||
      schemeType === AuthSchemeType.oauth2
    ) {
      if (!this.authCredential?.oauth2) {
        throw new Error(
          `auth_credential is empty for scheme ${schemeType}. Please create AuthCredential using OAuth2Auth.`
        );
      }

      if (!this.authCredential.oauth2.clientId) {
        throw new Error('OAuth2 credentials client_id is missing.');
      }

      if (!this.authCredential.oauth2.clientSecret) {
        throw new Error('OAuth2 credentials client_secret is missing.');
      }
    }

    this.toolContext.requestCredential({
      authScheme: this.authScheme,
      rawAuthCredential: this.authCredential,
      credentialKey: this.getCredentialKey(),
    });
  }

  /**
   * Gets the auth response from the tool context.
   */
  private getAuthResponse(): AuthCredential | undefined {
    if (!this.authScheme) {
      return undefined;
    }

    return this.toolContext.getAuthResponse({
      authScheme: this.authScheme,
      rawAuthCredential: this.authCredential,
      credentialKey: this.getCredentialKey(),
    });
  }

  /**
   * Prepares authentication credentials, handling exchange and user interaction.
   */
  async prepareAuthCredentials(): Promise<AuthPreparationResult> {
    // No auth is needed
    if (!this.authScheme) {
      return {state: 'done'};
    }

    // Check for existing credential
    const existingCredential = await this.getExistingCredential();

    let credential = existingCredential || this.authCredential;

    // Check if external exchange is needed (OAuth2/OIDC without access token)
    if (!credential || externalExchangeRequired(credential)) {
      credential = this.getAuthResponse();

      if (credential) {
        this.storeCredential(credential);
      } else {
        this.requestCredential();
        return {
          state: 'pending',
          authScheme: this.authScheme,
          authCredential: this.authCredential,
        };
      }
    }

    return {
      state: 'done',
      authScheme: this.authScheme,
      authCredential: credential,
    };
  }
}
