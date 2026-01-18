/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {OpenAPIV3} from 'openapi-types';

import {AuthCredential, AuthCredentialTypes} from '../../auth/auth_credential.js';
import {AuthScheme, AuthSchemeType} from '../../auth/auth_schemes.js';

import {ApiParameter, createApiParameter} from './common.js';

/**
 * Converts an AuthCredential to an API parameter and value for use in requests.
 *
 * @param authScheme The authentication scheme
 * @param authCredential The authentication credential
 * @returns A tuple of [ApiParameter, args object] for the auth
 */
export function credentialToParam(
  authScheme: AuthScheme,
  authCredential: AuthCredential
): [ApiParameter, Record<string, unknown>] | undefined {
  if (!authScheme || !authCredential) {
    return undefined;
  }

  const schemeType = getSchemeType(authScheme);

  switch (schemeType) {
    case AuthSchemeType.apiKey:
      return apiKeyCredentialToParam(
        authScheme as OpenAPIV3.ApiKeySecurityScheme,
        authCredential
      );
    case AuthSchemeType.http:
      return httpCredentialToParam(
        authScheme as OpenAPIV3.HttpSecurityScheme,
        authCredential
      );
    case AuthSchemeType.oauth2:
    case AuthSchemeType.openIdConnect:
      return oauth2CredentialToParam(authCredential);
    default:
      return undefined;
  }
}

function apiKeyCredentialToParam(
  authScheme: OpenAPIV3.ApiKeySecurityScheme,
  authCredential: AuthCredential
): [ApiParameter, Record<string, unknown>] | undefined {
  if (!authCredential.apiKey) {
    return undefined;
  }

  const paramLocation = authScheme.in || 'header';
  const paramName = authScheme.name || 'api_key';

  const param = createApiParameter({
    originalName: paramName,
    paramLocation,
    paramSchema: {type: 'string'},
    description: 'API Key',
  });

  const args: Record<string, unknown> = {
    [param.tsName]: authCredential.apiKey.apiKey,
  };

  return [param, args];
}

function httpCredentialToParam(
  authScheme: OpenAPIV3.HttpSecurityScheme,
  authCredential: AuthCredential
): [ApiParameter, Record<string, unknown>] | undefined {
  if (!authCredential.http) {
    return undefined;
  }

  const scheme = authScheme.scheme?.toLowerCase() || 'bearer';
  let headerValue: string;

  if (scheme === 'basic') {
    if (authCredential.http.credentials?.username && authCredential.http.credentials?.password) {
      const credentials = `${authCredential.http.credentials.username}:${authCredential.http.credentials.password}`;
      headerValue = `Basic ${Buffer.from(credentials).toString('base64')}`;
    } else {
      return undefined;
    }
  } else if (scheme === 'bearer') {
    if (authCredential.http.credentials?.token) {
      headerValue = `Bearer ${authCredential.http.credentials.token}`;
    } else {
      return undefined;
    }
  } else {
    // Custom scheme
    if (authCredential.http.credentials?.token) {
      headerValue = `${scheme} ${authCredential.http.credentials.token}`;
    } else {
      return undefined;
    }
  }

  const param = createApiParameter({
    originalName: 'Authorization',
    paramLocation: 'header',
    paramSchema: {type: 'string'},
    description: 'HTTP Authorization header',
  });

  const args: Record<string, unknown> = {
    [param.tsName]: headerValue,
  };

  return [param, args];
}

function oauth2CredentialToParam(
  authCredential: AuthCredential
): [ApiParameter, Record<string, unknown>] | undefined {
  if (!authCredential.oauth2?.accessToken) {
    return undefined;
  }

  const tokenType = authCredential.oauth2.tokenType || 'Bearer';
  const headerValue = `${tokenType} ${authCredential.oauth2.accessToken}`;

  const param = createApiParameter({
    originalName: 'Authorization',
    paramLocation: 'header',
    paramSchema: {type: 'string'},
    description: 'OAuth2 Authorization header',
  });

  const args: Record<string, unknown> = {
    [param.tsName]: headerValue,
  };

  return [param, args];
}

/**
 * Gets the AuthSchemeType from an AuthScheme object.
 */
export function getSchemeType(authScheme: AuthScheme): AuthSchemeType | undefined {
  if (!authScheme) {
    return undefined;
  }

  // Handle OpenAPIV3 SecuritySchemeObject
  if ('type' in authScheme) {
    const type = authScheme.type;
    switch (type) {
      case 'apiKey':
        return AuthSchemeType.apiKey;
      case 'http':
        return AuthSchemeType.http;
      case 'oauth2':
        return AuthSchemeType.oauth2;
      case 'openIdConnect':
        return AuthSchemeType.openIdConnect;
      default:
        return undefined;
    }
  }

  return undefined;
}

/**
 * Converts a dictionary to an AuthScheme object.
 */
export function dictToAuthScheme(dict: Record<string, unknown>): AuthScheme {
  return dict as unknown as AuthScheme;
}

/**
 * Creates an AuthScheme and AuthCredential pair from a token.
 *
 * @param token The access token
 * @param tokenType The token type (default: Bearer)
 * @returns An object with authScheme and authCredential
 */
export function tokenToSchemeCredential(
  token: string,
  tokenType: string = 'Bearer'
): {authScheme: AuthScheme; authCredential: AuthCredential} {
  const authScheme: OpenAPIV3.HttpSecurityScheme = {
    type: 'http',
    scheme: tokenType.toLowerCase(),
  };

  const authCredential: AuthCredential = {
    authType: AuthCredentialTypes.HTTP,
    http: {
      scheme: tokenType.toLowerCase(),
      credentials: {
        token,
      },
    },
  };

  return {authScheme, authCredential};
}

/**
 * Checks if a credential requires external exchange (OAuth2 without access token).
 */
export function externalExchangeRequired(credential: AuthCredential): boolean {
  return (
    (credential.authType === AuthCredentialTypes.OAUTH2 ||
      credential.authType === AuthCredentialTypes.OPEN_ID_CONNECT) &&
    !credential.oauth2?.accessToken
  );
}
