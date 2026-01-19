/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Utility functions for MCP tool authentication.
 */

import {OpenAPIV3} from 'openapi-types';

import {AuthCredential} from '../../auth/auth_credential.js';
import {AuthScheme} from '../../auth/auth_schemes.js';
import {logger} from '../../utils/logger.js';

/**
 * Generates HTTP authentication headers for MCP calls.
 *
 * Supports multiple authentication schemes:
 * - OAuth2: Generates `Authorization: Bearer {access_token}` header
 * - HTTP Bearer: Uses token from credential for Bearer auth
 * - HTTP Basic: Base64 encodes username:password for Basic auth
 * - HTTP Custom: Handles other HTTP schemes if token is present
 * - API Key: Extracts API key and places in custom header (header-based only)
 *
 * @param authScheme The authentication scheme.
 * @param credential The resolved authentication credential.
 * @returns A dictionary of headers, or undefined if no auth is applicable.
 * @throws Error if the auth scheme is unsupported or misconfigured.
 *
 * @example
 * ```typescript
 * const headers = getMcpAuthHeaders(authScheme, credential);
 * if (headers) {
 *   // Use headers for MCP request
 *   await mcpClient.request({ headers });
 * }
 * ```
 */
export function getMcpAuthHeaders(
  authScheme: AuthScheme | undefined,
  credential: AuthCredential | undefined,
): Record<string, string> | undefined {
  if (!credential) {
    return undefined;
  }

  let headers: Record<string, string> | undefined;

  // Handle OAuth2 credentials
  if (credential.oauth2) {
    if (credential.oauth2.accessToken) {
      headers = {Authorization: `Bearer ${credential.oauth2.accessToken}`};
    } else {
      logger.warn('OAuth2 credential provided but access token is missing.');
    }
    return headers;
  }

  // Handle HTTP credentials
  if (credential.http) {
    if (!authScheme || !isHttpSecurityScheme(authScheme)) {
      logger.warn(
        'HTTP credential provided, but authScheme is missing or not HTTP type.',
      );
      return undefined;
    }

    const scheme = authScheme.scheme.toLowerCase();
    if (scheme === 'bearer' && credential.http.credentials?.token) {
      headers = {Authorization: `Bearer ${credential.http.credentials.token}`};
    } else if (scheme === 'basic') {
      if (
        credential.http.credentials?.username &&
        credential.http.credentials?.password
      ) {
        const creds = `${credential.http.credentials.username}:${credential.http.credentials.password}`;
        const encodedCreds = Buffer.from(creds).toString('base64');
        headers = {Authorization: `Basic ${encodedCreds}`};
      } else {
        logger.warn('Basic auth scheme missing username or password.');
      }
    } else if (credential.http.credentials?.token) {
      // Handle other HTTP schemes like Digest, etc. if token is present
      headers = {
        Authorization: `${authScheme.scheme} ${credential.http.credentials.token}`,
      };
    } else {
      logger.warn(`Unsupported or incomplete HTTP auth scheme '${scheme}'.`);
    }
    return headers;
  }

  // Handle API Key credentials
  if (credential.apiKey) {
    if (!authScheme || !isApiKeySecurityScheme(authScheme)) {
      logger.warn(
        'API key credential provided, but authScheme is missing or not APIKey type.',
      );
      return undefined;
    }

    if (authScheme.in !== 'header') {
      const errorMsg =
        'MCP tools only support header-based API key authentication. ' +
        `Configured location: ${authScheme.in}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    headers = {[authScheme.name]: credential.apiKey.apiKey};
    return headers;
  }

  // Handle Service Account credentials
  if (credential.serviceAccount) {
    logger.warn(
      'Service account credentials should be exchanged for an access token ' +
        'before calling getMcpAuthHeaders.',
    );
    return undefined;
  }

  logger.warn(`Unsupported credential type: ${credential.authType}`);
  return undefined;
}

/**
 * Type guard to check if an auth scheme is an HTTP security scheme.
 */
function isHttpSecurityScheme(
  authScheme: AuthScheme,
): authScheme is OpenAPIV3.HttpSecurityScheme {
  return authScheme.type === 'http';
}

/**
 * Type guard to check if an auth scheme is an API Key security scheme.
 */
function isApiKeySecurityScheme(
  authScheme: AuthScheme,
): authScheme is OpenAPIV3.ApiKeySecurityScheme {
  return authScheme.type === 'apiKey';
}
