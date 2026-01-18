/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleAuth, JWT} from 'google-auth-library';
import {OpenAPIV3} from 'openapi-types';

import {
  AuthCredential,
  AuthCredentialTypes,
  updateCredentialWithTokens,
} from '../auth_credential.js';
import {AuthScheme, OpenIdConnectWithConfig} from '../auth_schemes.js';

import {
  BaseCredentialExchanger,
  CredentialExchangeError,
  ExchangeResult,
} from './base_credential_exchanger.js';

/**
 * @experimental (Experimental, subject to change) Service account credential
 * exchanger implementation.
 *
 * Exchanges Google Cloud service account credentials for access tokens using
 * JWT.
 */
export class ServiceAccountCredentialExchanger
  implements BaseCredentialExchanger
{
  /**
   * Exchange service account credential for access token.
   *
   * @param authCredential The service account credential to exchange.
   * @param authScheme The authentication scheme (used to extract scopes).
   * @returns An ExchangeResult object containing the exchanged credential and a
   *     boolean indicating whether the credential was exchanged.
   * @throws CredentialExchangeError if the credential is invalid.
   */
  async exchange(
    authCredential: AuthCredential,
    authScheme?: AuthScheme,
  ): Promise<ExchangeResult> {
    if (authCredential.authType !== AuthCredentialTypes.SERVICE_ACCOUNT) {
      throw new CredentialExchangeError(
        'ServiceAccountCredentialExchanger only supports SERVICE_ACCOUNT credentials',
      );
    }

    if (!authCredential.serviceAccount) {
      throw new CredentialExchangeError(
        'serviceAccount field is required for SERVICE_ACCOUNT credentials',
      );
    }

    try {
      // Extract scopes from auth scheme or credential
      const scopes = this.extractScopes(authScheme, authCredential);

      let accessToken: string;
      let expiresIn: number | undefined;

      if (authCredential.serviceAccount.useDefaultCredential) {
        // Use Application Default Credentials (ADC)
        const auth = new GoogleAuth({
          scopes,
          projectId: authCredential.serviceAccount.quotaProjectId,
        });

        const client = await auth.getClient();
        const tokenResponse = await client.getAccessToken();

        if (!tokenResponse.token) {
          throw new Error('Failed to get access token from default credentials');
        }

        accessToken = tokenResponse.token;
        // Default credentials don't provide expires_in directly
        expiresIn = 3600; // Default to 1 hour
      } else if (authCredential.serviceAccount.serviceAccountCredential) {
        // Use service account JSON key
        const saCredential =
          authCredential.serviceAccount.serviceAccountCredential;

        const jwtClient = new JWT({
          email: saCredential.clientEmail,
          key: saCredential.privateKey,
          scopes,
          subject: undefined, // Can be used for domain-wide delegation
        });

        const tokenResponse = await jwtClient.getAccessToken();

        if (!tokenResponse.token) {
          throw new Error('Failed to get access token from service account');
        }

        accessToken = tokenResponse.token;
        expiresIn = 3600; // JWT tokens typically expire in 1 hour
      } else {
        throw new CredentialExchangeError(
          'Either useDefaultCredential or serviceAccountCredential must be provided',
        );
      }

      // Create new credential with OAuth2 access token
      const exchangedCredential: AuthCredential = {
        authType: AuthCredentialTypes.OAUTH2,
        oauth2: {
          accessToken,
          expiresIn,
          expiresAt: expiresIn
            ? Math.floor(Date.now() / 1000) + expiresIn
            : undefined,
          tokenType: 'Bearer',
          scope: scopes?.join(' '),
        },
      };

      console.debug('Successfully exchanged service account for access token');
      return {credential: exchangedCredential, wasExchanged: true};
    } catch (error) {
      console.error('Failed to exchange service account credential:', error);
      throw new CredentialExchangeError(
        `Service account exchange failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Extract scopes from auth scheme or credential.
   */
  private extractScopes(
    authScheme: AuthScheme | undefined,
    authCredential: AuthCredential,
  ): string[] | undefined {
    // First try to get scopes from credential
    if (authCredential.serviceAccount?.scopes) {
      return authCredential.serviceAccount.scopes;
    }

    // Then try to get scopes from auth scheme
    if (!authScheme) {
      return undefined;
    }

    if (this.isOpenIdConnectScheme(authScheme)) {
      return authScheme.scopes;
    } else if (this.isOAuth2Scheme(authScheme) && authScheme.flows) {
      // Try to extract scopes from any available flow
      const flows = authScheme.flows;
      if (flows.authorizationCode?.scopes) {
        return Object.keys(flows.authorizationCode.scopes);
      }
      if (flows.clientCredentials?.scopes) {
        return Object.keys(flows.clientCredentials.scopes);
      }
      if (flows.implicit?.scopes) {
        return Object.keys(flows.implicit.scopes);
      }
      if (flows.password?.scopes) {
        return Object.keys(flows.password.scopes);
      }
    }

    return undefined;
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
