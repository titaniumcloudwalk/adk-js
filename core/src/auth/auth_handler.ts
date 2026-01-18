/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {OpenAPIV3} from 'openapi-types';
import {AuthorizationCode} from 'simple-oauth2';

import {State} from '../sessions/state.js';

import {AuthCredential, updateCredentialWithTokens} from './auth_credential.js';
import {OpenIdConnectWithConfig} from './auth_schemes.js';
import {AuthConfig} from './auth_tool.js';
import {OAuth2CredentialExchanger} from './exchanger/oauth2_credential_exchanger.js';

/**
 * A handler that handles the auth flow in Agent Development Kit to help
 * orchestrate the credential request and response flow (e.g. OAuth flow)
 * This class should only be used by Agent Development Kit.
 */
export class AuthHandler {
  constructor(private readonly authConfig: AuthConfig) {}

  /**
   * Get the auth credential for the given auth config from state.
   *
   * @param state The state to get the auth credential from.
   * @returns The auth credential for the given auth config.
   */
  getAuthResponse(state: State): AuthCredential | undefined {
    const credentialKey = 'temp:' + this.authConfig.credentialKey;
    return state.get<AuthCredential>(credentialKey);
  }

  /**
   * Parse and store auth response in state.
   *
   * @param state The state to store the auth response in.
   */
  async parseAndStoreAuthResponse(state: State): Promise<void> {
    const credentialKey = 'temp:' + this.authConfig.credentialKey;

    state.set(credentialKey, this.authConfig.exchangedAuthCredential);

    const authSchemeType = this.authConfig.authScheme.type;
    if (!['oauth2', 'openIdConnect'].includes(authSchemeType)) {
      return;
    }

    // Exchange the auth token
    const exchangedCredential = await this.exchangeAuthToken();
    if (exchangedCredential) {
      state.set(credentialKey, exchangedCredential);
    }
  }

  /**
   * Exchange authorization code for access token.
   *
   * @returns The credential with access token.
   */
  async exchangeAuthToken(): Promise<AuthCredential | undefined> {
    if (!this.authConfig.exchangedAuthCredential) {
      return undefined;
    }

    const exchanger = new OAuth2CredentialExchanger();
    const exchangeResult = await exchanger.exchange(
      this.authConfig.exchangedAuthCredential,
      this.authConfig.authScheme,
    );
    return exchangeResult.credential;
  }

  /**
   * Generate auth request with authorization URI.
   *
   * @returns The auth config with authorization URI in exchanged credential.
   */
  generateAuthRequest(): AuthConfig {
    const authSchemeType = this.authConfig.authScheme.type;

    if (!['oauth2', 'openIdConnect'].includes(authSchemeType)) {
      return this.authConfig;
    }

    if (this.authConfig.exchangedAuthCredential?.oauth2?.authUri) {
      return this.authConfig;
    }

    if (!this.authConfig.rawAuthCredential) {
      throw new Error(`Auth Scheme ${authSchemeType} requires authCredential.`);
    }

    if (!this.authConfig.rawAuthCredential.oauth2) {
      throw new Error(
        `Auth Scheme ${authSchemeType} requires oauth2 in authCredential.`,
      );
    }

    if (this.authConfig.rawAuthCredential.oauth2.authUri) {
      return {
        credentialKey: this.authConfig.credentialKey,
        authScheme: this.authConfig.authScheme,
        rawAuthCredential: this.authConfig.rawAuthCredential,
        exchangedAuthCredential: this.authConfig.rawAuthCredential,
      };
    }

    if (
      !this.authConfig.rawAuthCredential.oauth2.clientId ||
      !this.authConfig.rawAuthCredential.oauth2.clientSecret
    ) {
      throw new Error(
        `Auth Scheme ${authSchemeType} requires both clientId and clientSecret in authCredential.oauth2.`,
      );
    }

    return {
      credentialKey: this.authConfig.credentialKey,
      authScheme: this.authConfig.authScheme,
      rawAuthCredential: this.authConfig.rawAuthCredential,
      exchangedAuthCredential: this.generateAuthUri(),
    };
  }

  /**
   * Generates a response containing the auth uri for user to sign in.
   *
   * @returns An AuthCredential object containing the auth URI and state.
   * @throws Error if the authorization endpoint is not configured in the auth
   *     scheme.
   */
  generateAuthUri(): AuthCredential | undefined {
    const authScheme = this.authConfig.authScheme;
    const authCredential = this.authConfig.rawAuthCredential;

    if (!authCredential?.oauth2) {
      return authCredential;
    }

    let authorizationEndpoint: string | undefined;
    let scopes: string[] = [];

    if (this.isOpenIdConnectScheme(authScheme)) {
      authorizationEndpoint = authScheme.authorizationEndpoint;
      scopes = authScheme.scopes || [];
    } else if (this.isOAuth2Scheme(authScheme) && authScheme.flows) {
      const flows = authScheme.flows;

      if (flows.implicit?.authorizationUrl) {
        authorizationEndpoint = flows.implicit.authorizationUrl;
        scopes = flows.implicit.scopes ? Object.keys(flows.implicit.scopes) : [];
      } else if (flows.authorizationCode?.authorizationUrl) {
        authorizationEndpoint = flows.authorizationCode.authorizationUrl;
        scopes = flows.authorizationCode.scopes
          ? Object.keys(flows.authorizationCode.scopes)
          : [];
      } else if (flows.clientCredentials?.tokenUrl) {
        authorizationEndpoint = flows.clientCredentials.tokenUrl;
        scopes = flows.clientCredentials.scopes
          ? Object.keys(flows.clientCredentials.scopes)
          : [];
      } else if (flows.password?.tokenUrl) {
        authorizationEndpoint = flows.password.tokenUrl;
        scopes = flows.password.scopes ? Object.keys(flows.password.scopes) : [];
      }
    }

    if (!authorizationEndpoint) {
      throw new Error(
        'Authorization endpoint not configured in auth scheme',
      );
    }

    try {
      // Generate authorization URL with state
      const state = this.generateRandomState();
      const authUrl = this.buildAuthorizationUrl(
        authorizationEndpoint,
        authCredential.oauth2.clientId!,
        authCredential.oauth2.redirectUri || '',
        scopes,
        state,
        authCredential.oauth2.audience,
      );

      // Create exchanged credential with auth URI and state
      const exchangedCredential: AuthCredential = {
        ...authCredential,
        oauth2: {
          ...authCredential.oauth2,
          authUri: authUrl,
          state,
        },
      };

      return exchangedCredential;
    } catch (error) {
      console.error('Failed to generate authorization URI:', error);
      return authCredential;
    }
  }

  /**
   * Build authorization URL with parameters.
   */
  private buildAuthorizationUrl(
    authorizationEndpoint: string,
    clientId: string,
    redirectUri: string,
    scopes: string[],
    state: string,
    audience?: string,
  ): string {
    const url = new URL(authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('scope', scopes.join(' '));
    url.searchParams.set('state', state);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');

    if (audience) {
      url.searchParams.set('audience', audience);
    }

    return url.toString();
  }

  /**
   * Generate a random state parameter for OAuth2 flow.
   */
  private generateRandomState(): string {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join(
      '',
    );
  }

  private isOAuth2Scheme(
    authScheme: any,
  ): authScheme is OpenAPIV3.OAuth2SecurityScheme {
    return authScheme.type === 'oauth2';
  }

  private isOpenIdConnectScheme(
    authScheme: any,
  ): authScheme is OpenIdConnectWithConfig {
    return authScheme.type === 'openIdConnect';
  }
}
