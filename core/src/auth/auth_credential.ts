/**
 * Copyright 2025 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Credential type enum matching OpenAPI security scheme types
 */
export enum AuthCredentialTypes {
  API_KEY = 'apiKey',
  HTTP = 'http',
  OAUTH2 = 'oauth2',
  OPEN_ID_CONNECT = 'openIdConnect',
  SERVICE_ACCOUNT = 'serviceAccount',
}

/**
 * OAuth2-specific credential fields
 */
export interface OAuth2Auth {
  clientId?: string;
  clientSecret?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  expiresIn?: number;
  authCode?: string;
  redirectUri?: string;
  state?: string;
  tokenEndpointAuthMethod?: string;
  tokenType?: string;
  scope?: string;
  authUri?: string;
  authResponseUri?: string;
  audience?: string;
}

/**
 * HTTP authentication credentials
 */
export interface HttpCredentials {
  token?: string;
  username?: string;
  password?: string;
}

export interface HttpAuth {
  scheme: string;
  credentials?: HttpCredentials;
}

export interface ApiKeyAuth {
  apiKey: string;
  in: 'query' | 'header' | 'cookie';
  name: string;
}

export interface ServiceAccountCredential {
  type: 'service_account';
  projectId: string;
  privateKeyId: string;
  privateKey: string;
  clientEmail: string;
  clientId: string;
  authUri: string;
  tokenUri: string;
  authProviderX509CertUrl: string;
  clientX509CertUrl: string;
  universeDomain?: string;
}

export interface ServiceAccount {
  serviceAccountCredential?: ServiceAccountCredential;
  scopes?: string[];
  useDefaultCredential?: boolean;
  quotaProjectId?: string;
}

export interface AuthCredential {
  authType: AuthCredentialTypes;
  oauth2?: OAuth2Auth;
  http?: HttpAuth;
  apiKey?: ApiKeyAuth;
  serviceAccount?: ServiceAccount;
}

export interface ExchangeResult {
  credential: AuthCredential;
  wasExchanged: boolean;
}

export function isSimpleCredential(credential: AuthCredential): boolean {
  return (
    credential.authType === AuthCredentialTypes.API_KEY ||
    credential.authType === AuthCredentialTypes.HTTP
  );
}

export function isOAuth2Expired(oauth2: OAuth2Auth): boolean {
  if (oauth2.expiresAt) {
    const now = Math.floor(Date.now() / 1000);
    return oauth2.expiresAt <= now + 300;
  }
  return false;
}

export function updateCredentialWithTokens(
  credential: AuthCredential,
  tokens: {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
    scope?: string;
  }
): void {
  if (!credential.oauth2) {
    credential.oauth2 = {};
  }
  if (tokens.access_token) credential.oauth2.accessToken = tokens.access_token;
  if (tokens.refresh_token) credential.oauth2.refreshToken = tokens.refresh_token;
  if (tokens.expires_in !== undefined) {
    const now = Math.floor(Date.now() / 1000);
    credential.oauth2.expiresAt = now + tokens.expires_in;
    credential.oauth2.expiresIn = tokens.expires_in;
  }
  if (tokens.token_type) credential.oauth2.tokenType = tokens.token_type;
  if (tokens.scope) credential.oauth2.scope = tokens.scope;
}
