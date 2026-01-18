/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {AuthorizationCode, ClientCredentials, ModuleOptions} from 'simple-oauth2';
import {OpenAPIV3} from 'openapi-types';

import {
  AuthCredential,
  updateCredentialWithTokens,
} from '../auth_credential.js';
import {
  AuthScheme,
  getOAuthGrantTypeFromFlow,
  OAuthGrantType,
  OpenIdConnectWithConfig,
} from '../auth_schemes.js';

import {
  BaseCredentialExchanger,
  CredentialExchangeError,
  ExchangeResult,
} from './base_credential_exchanger.js';

/**
 * @experimental (Experimental, subject to change) OAuth2 credential exchanger
 * implementation.
 *
 * Exchanges OAuth2 credentials from authorization responses or client
 * credentials.
 */
export class OAuth2CredentialExchanger implements BaseCredentialExchanger {
  /**
   * Exchange OAuth2 credential from authorization response or client
   * credentials.
   *
   * If credential exchange fails, the original credential will be returned
   * with wasExchanged=false.
   *
   * @param authCredential The OAuth2 credential to exchange.
   * @param authScheme The OAuth2 authentication scheme.
   * @returns An ExchangeResult object containing the exchanged credential and a
   *     boolean indicating whether the credential was exchanged.
   * @throws CredentialExchangeError if auth_scheme is missing.
   */
  async exchange(
    authCredential: AuthCredential,
    authScheme?: AuthScheme,
  ): Promise<ExchangeResult> {
    if (!authScheme) {
      throw new CredentialExchangeError(
        'authScheme is required for OAuth2 credential exchange',
      );
    }

    // If already has access token, no need to exchange
    if (authCredential.oauth2?.accessToken) {
      return {credential: authCredential, wasExchanged: false};
    }

    // Determine grant type from auth_scheme
    const grantType = this.determineGrantType(authScheme);

    if (grantType === OAuthGrantType.CLIENT_CREDENTIALS) {
      return await this.exchangeClientCredentials(authCredential, authScheme);
    } else if (grantType === OAuthGrantType.AUTHORIZATION_CODE) {
      return await this.exchangeAuthorizationCode(authCredential, authScheme);
    } else {
      console.warn(`Unsupported OAuth2 grant type: ${grantType}`);
      return {credential: authCredential, wasExchanged: false};
    }
  }

  /**
   * Determine the OAuth2 grant type from the auth scheme.
   */
  private determineGrantType(
    authScheme: AuthScheme,
  ): OAuthGrantType | undefined {
    if (this.isOAuth2Scheme(authScheme) && authScheme.flows) {
      return getOAuthGrantTypeFromFlow(authScheme.flows);
    } else if (this.isOpenIdConnectScheme(authScheme)) {
      // Check supported grant types for OIDC
      if (
        authScheme.grantTypesSupported &&
        authScheme.grantTypesSupported.includes('client_credentials')
      ) {
        return OAuthGrantType.CLIENT_CREDENTIALS;
      } else {
        // Default to authorization code if client credentials not supported
        return OAuthGrantType.AUTHORIZATION_CODE;
      }
    }

    return undefined;
  }

  /**
   * Exchange client credentials for access token.
   */
  private async exchangeClientCredentials(
    authCredential: AuthCredential,
    authScheme: AuthScheme,
  ): Promise<ExchangeResult> {
    const oauth2Config = this.createOAuth2Config(authScheme, authCredential);
    if (!oauth2Config) {
      console.warn(
        'Could not create OAuth2 config for client credentials exchange',
      );
      return {credential: authCredential, wasExchanged: false};
    }

    try {
      const client = new ClientCredentials(oauth2Config);
      const tokenParams = {
        scope: authCredential.oauth2?.scope,
      };

      const accessToken = await client.getToken(tokenParams);
      updateCredentialWithTokens(authCredential, {
        access_token: accessToken.token.access_token as string,
        refresh_token: accessToken.token.refresh_token as string | undefined,
        expires_in: accessToken.token.expires_in as number | undefined,
        token_type: accessToken.token.token_type as string | undefined,
        scope: accessToken.token.scope as string | undefined,
      });

      console.debug('Successfully exchanged client credentials for access token');
      return {credential: authCredential, wasExchanged: true};
    } catch (error) {
      console.error('Failed to exchange client credentials:', error);
      return {credential: authCredential, wasExchanged: false};
    }
  }

  /**
   * Exchange authorization code for access token.
   */
  private async exchangeAuthorizationCode(
    authCredential: AuthCredential,
    authScheme: AuthScheme,
  ): Promise<ExchangeResult> {
    const oauth2Config = this.createOAuth2Config(authScheme, authCredential);
    if (!oauth2Config) {
      console.warn(
        'Could not create OAuth2 config for authorization code exchange',
      );
      return {credential: authCredential, wasExchanged: false};
    }

    if (!authCredential.oauth2?.authCode) {
      console.warn('No authorization code found in credential');
      return {credential: authCredential, wasExchanged: false};
    }

    try {
      const client = new AuthorizationCode(oauth2Config);
      const tokenParams: any = {
        code: authCredential.oauth2.authCode,
        redirect_uri: authCredential.oauth2.redirectUri,
        scope: authCredential.oauth2.scope,
      };

      const accessToken = await client.getToken(tokenParams);
      updateCredentialWithTokens(authCredential, {
        access_token: accessToken.token.access_token as string,
        refresh_token: accessToken.token.refresh_token as string | undefined,
        expires_in: accessToken.token.expires_in as number | undefined,
        token_type: accessToken.token.token_type as string | undefined,
        scope: accessToken.token.scope as string | undefined,
      });

      console.debug('Successfully exchanged authorization code for access token');
      return {credential: authCredential, wasExchanged: true};
    } catch (error) {
      console.error('Failed to exchange authorization code:', error);
      return {credential: authCredential, wasExchanged: false};
    }
  }

  /**
   * Create OAuth2 config for simple-oauth2 client.
   */
  private createOAuth2Config(
    authScheme: AuthScheme,
    authCredential: AuthCredential,
  ): ModuleOptions | undefined {
    if (
      !authCredential.oauth2?.clientId ||
      !authCredential.oauth2?.clientSecret
    ) {
      return undefined;
    }

    let tokenHost: string | undefined;
    let tokenPath: string | undefined;
    let authorizePath: string | undefined;

    if (this.isOpenIdConnectScheme(authScheme)) {
      const tokenUrl = new URL(authScheme.tokenEndpoint);
      tokenHost = `${tokenUrl.protocol}//${tokenUrl.host}`;
      tokenPath = tokenUrl.pathname;

      if (authScheme.authorizationEndpoint) {
        const authUrl = new URL(authScheme.authorizationEndpoint);
        authorizePath = authUrl.pathname;
      }
    } else if (this.isOAuth2Scheme(authScheme) && authScheme.flows) {
      // Support both authorization code and client credentials flows
      if (
        authScheme.flows.authorizationCode &&
        authScheme.flows.authorizationCode.tokenUrl
      ) {
        const tokenUrl = new URL(authScheme.flows.authorizationCode.tokenUrl);
        tokenHost = `${tokenUrl.protocol}//${tokenUrl.host}`;
        tokenPath = tokenUrl.pathname;

        if (authScheme.flows.authorizationCode.authorizationUrl) {
          const authUrl = new URL(
            authScheme.flows.authorizationCode.authorizationUrl,
          );
          authorizePath = authUrl.pathname;
        }
      } else if (
        authScheme.flows.clientCredentials &&
        authScheme.flows.clientCredentials.tokenUrl
      ) {
        const tokenUrl = new URL(authScheme.flows.clientCredentials.tokenUrl);
        tokenHost = `${tokenUrl.protocol}//${tokenUrl.host}`;
        tokenPath = tokenUrl.pathname;
      }
    }

    if (!tokenHost || !tokenPath) {
      return undefined;
    }

    return {
      client: {
        id: authCredential.oauth2.clientId,
        secret: authCredential.oauth2.clientSecret,
      },
      auth: {
        tokenHost,
        tokenPath,
        authorizePath,
      },
      options: {
        authorizationMethod: (authCredential.oauth2.tokenEndpointAuthMethod as 'header' | 'body') || 'body',
      },
    };
  }

  private isOAuth2Scheme(
    authScheme: AuthScheme,
  ): authScheme is OpenAPIV3.OAuth2SecurityScheme {
    return authScheme.type === 'oauth2';
  }

  private isOpenIdConnectScheme(
    authScheme: AuthScheme,
  ): authScheme is OpenIdConnectWithConfig {
    return authScheme.type === 'openIdConnect';
  }
}
