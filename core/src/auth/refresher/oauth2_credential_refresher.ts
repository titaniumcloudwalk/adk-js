/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {AccessToken, AuthorizationCode, ClientCredentials, ModuleOptions} from 'simple-oauth2';
import {OpenAPIV3} from 'openapi-types';

import {
  AuthCredential,
  isOAuth2Expired,
  updateCredentialWithTokens,
} from '../auth_credential.js';
import {AuthScheme, OpenIdConnectWithConfig} from '../auth_schemes.js';

import {BaseCredentialRefresher} from './base_credential_refresher.js';

/**
 * @experimental (Experimental, subject to change) OAuth2 credential refresher
 * implementation.
 *
 * Refreshes OAuth2 credentials using refresh tokens.
 */
export class OAuth2CredentialRefresher implements BaseCredentialRefresher {
  /**
   * Check if the OAuth2 credential needs to be refreshed.
   *
   * @param authCredential The OAuth2 credential to check.
   * @param authScheme The OAuth2 authentication scheme (optional).
   * @returns True if the credential needs to be refreshed, False otherwise.
   */
  async isRefreshNeeded(
    authCredential: AuthCredential,
    authScheme?: AuthScheme,
  ): Promise<boolean> {
    // Check if OAuth2 credential is expired
    if (authCredential.oauth2) {
      return isOAuth2Expired(authCredential.oauth2);
    }

    return false;
  }

  /**
   * Refresh the OAuth2 credential.
   *
   * If refresh fails, returns the original credential.
   *
   * @param authCredential The OAuth2 credential to refresh.
   * @param authScheme The OAuth2 authentication scheme.
   * @returns The refreshed credential.
   */
  async refresh(
    authCredential: AuthCredential,
    authScheme?: AuthScheme,
  ): Promise<AuthCredential> {
    if (!authCredential.oauth2) {
      return authCredential;
    }

    if (!authScheme) {
      console.warn('authScheme is required for OAuth2 credential refresh');
      return authCredential;
    }

    // Check if token is expired
    if (!isOAuth2Expired(authCredential.oauth2)) {
      return authCredential;
    }

    // Check if refresh token is available
    if (!authCredential.oauth2.refreshToken) {
      console.warn('No refresh token available, cannot refresh credential');
      return authCredential;
    }

    const oauth2Config = this.createOAuth2Config(authScheme, authCredential);
    if (!oauth2Config) {
      console.warn('Could not create OAuth2 config for token refresh');
      return authCredential;
    }

    try {
      const client = new AuthorizationCode(oauth2Config);

      // Create an AccessToken object from the existing credential
      const currentToken: AccessToken = client.createToken({
        access_token: authCredential.oauth2.accessToken || '',
        refresh_token: authCredential.oauth2.refreshToken,
        expires_in: authCredential.oauth2.expiresIn,
        expires_at: authCredential.oauth2.expiresAt
          ? new Date(authCredential.oauth2.expiresAt * 1000).toISOString()
          : undefined,
        token_type: authCredential.oauth2.tokenType,
        scope: authCredential.oauth2.scope,
      });

      // Refresh the token
      const refreshedToken = await currentToken.refresh();

      updateCredentialWithTokens(authCredential, {
        access_token: refreshedToken.token.access_token as string,
        refresh_token: refreshedToken.token.refresh_token as string | undefined,
        expires_in: refreshedToken.token.expires_in as number | undefined,
        token_type: refreshedToken.token.token_type as string | undefined,
        scope: refreshedToken.token.scope as string | undefined,
      });

      console.debug('Successfully refreshed OAuth2 tokens');
      return authCredential;
    } catch (error) {
      console.error('Failed to refresh OAuth2 tokens:', error);
      // Return original credential on failure
      return authCredential;
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
