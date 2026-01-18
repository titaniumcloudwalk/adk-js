/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AuthCredential,
  AuthCredentialTypes,
} from '../../../src/auth/auth_credential.js';
import {AuthScheme} from '../../../src/auth/auth_schemes.js';
import {BaseCredentialRefresher} from '../../../src/auth/refresher/base_credential_refresher.js';
import {CredentialRefresherRegistry} from '../../../src/auth/refresher/credential_refresher_registry.js';
import {OAuth2CredentialRefresher} from '../../../src/auth/refresher/oauth2_credential_refresher.js';

// Mock credential refresher for testing
class MockCredentialRefresher implements BaseCredentialRefresher {
  async isRefreshNeeded(
    authCredential: AuthCredential,
    authScheme?: AuthScheme,
  ): Promise<boolean> {
    return false;
  }

  async refresh(
    authCredential: AuthCredential,
    authScheme?: AuthScheme,
  ): Promise<AuthCredential> {
    return authCredential;
  }
}

describe('CredentialRefresherRegistry', () => {
  it('should initialize with an empty refreshers dictionary', () => {
    const registry = new CredentialRefresherRegistry();

    // All credential types should return undefined when registry is empty
    expect(registry.getRefresher(AuthCredentialTypes.OAUTH2)).toBeUndefined();
  });

  it('should register a single refresher', () => {
    const registry = new CredentialRefresherRegistry();
    const mockRefresher = new MockCredentialRefresher();

    registry.register(AuthCredentialTypes.API_KEY, mockRefresher);

    const retrievedRefresher = registry.getRefresher(
      AuthCredentialTypes.API_KEY,
    );
    expect(retrievedRefresher).toBe(mockRefresher);
  });

  it('should register all credential types', () => {
    const registry = new CredentialRefresherRegistry();

    const mockRefresherApiKey = new MockCredentialRefresher();
    const mockRefresherOauth2 = new MockCredentialRefresher();
    const mockRefresherOpenIdConnect = new MockCredentialRefresher();
    const mockRefresherServiceAccount = new MockCredentialRefresher();

    registry.register(AuthCredentialTypes.API_KEY, mockRefresherApiKey);
    registry.register(AuthCredentialTypes.OAUTH2, mockRefresherOauth2);
    registry.register(
      AuthCredentialTypes.OPEN_ID_CONNECT,
      mockRefresherOpenIdConnect,
    );
    registry.register(
      AuthCredentialTypes.SERVICE_ACCOUNT,
      mockRefresherServiceAccount,
    );

    expect(registry.getRefresher(AuthCredentialTypes.API_KEY)).toBe(
      mockRefresherApiKey,
    );
    expect(registry.getRefresher(AuthCredentialTypes.OAUTH2)).toBe(
      mockRefresherOauth2,
    );
    expect(registry.getRefresher(AuthCredentialTypes.OPEN_ID_CONNECT)).toBe(
      mockRefresherOpenIdConnect,
    );
    expect(registry.getRefresher(AuthCredentialTypes.SERVICE_ACCOUNT)).toBe(
      mockRefresherServiceAccount,
    );
  });

  it('should return undefined for an unregistered credential type', () => {
    const registry = new CredentialRefresherRegistry();
    const mockRefresherApiKey = new MockCredentialRefresher();

    registry.register(AuthCredentialTypes.API_KEY, mockRefresherApiKey);

    expect(registry.getRefresher(AuthCredentialTypes.API_KEY)).toBe(
      mockRefresherApiKey,
    );
    expect(registry.getRefresher(AuthCredentialTypes.OAUTH2)).toBeUndefined();
  });
});

describe('OAuth2CredentialRefresher', () => {
  let refresher: OAuth2CredentialRefresher;

  beforeEach(() => {
    refresher = new OAuth2CredentialRefresher();
  });

  it('should detect expired credentials', async () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.OAUTH2,
      oauth2: {
        accessToken: 'test-token',
        expiresAt: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
        expiresIn: 3600,
      },
    };

    const needsRefresh = await refresher.isRefreshNeeded(credential);
    expect(needsRefresh).toBe(true);
  });

  it('should detect non-expired credentials', async () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.OAUTH2,
      oauth2: {
        accessToken: 'test-token',
        expiresAt: Math.floor(Date.now() / 1000) + 3600, // Expires in 1 hour
        expiresIn: 3600,
      },
    };

    const needsRefresh = await refresher.isRefreshNeeded(credential);
    expect(needsRefresh).toBe(false);
  });

  it('should detect soon-to-expire credentials (within 5 minutes)', async () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.OAUTH2,
      oauth2: {
        accessToken: 'test-token',
        expiresAt: Math.floor(Date.now() / 1000) + 200, // Expires in 200 seconds
        expiresIn: 200,
      },
    };

    const needsRefresh = await refresher.isRefreshNeeded(credential);
    expect(needsRefresh).toBe(true);
  });

  it('should return false for credentials without expiry', async () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.OAUTH2,
      oauth2: {
        accessToken: 'test-token',
      },
    };

    const needsRefresh = await refresher.isRefreshNeeded(credential);
    expect(needsRefresh).toBe(false);
  });

  it('should return false for credentials without oauth2', async () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.API_KEY,
      apiKey: {
        apiKey: 'test-key',
        in: 'header',
        name: 'X-API-Key',
      },
    };

    const needsRefresh = await refresher.isRefreshNeeded(credential);
    expect(needsRefresh).toBe(false);
  });

  it('should return original credential if no refresh token', async () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.OAUTH2,
      oauth2: {
        accessToken: 'test-token',
        expiresAt: Math.floor(Date.now() / 1000) - 3600,
        expiresIn: 3600,
      },
    };

    const authScheme: AuthScheme = {
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://auth.example.com/authorize',
          tokenUrl: 'https://auth.example.com/token',
          scopes: {},
        },
      },
    };

    const refreshed = await refresher.refresh(credential, authScheme);
    expect(refreshed).toBe(credential);
  });

  it('should return original credential if not expired', async () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.OAUTH2,
      oauth2: {
        accessToken: 'test-token',
        refreshToken: 'refresh-token',
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
        expiresIn: 3600,
      },
    };

    const authScheme: AuthScheme = {
      type: 'oauth2',
      flows: {
        authorizationCode: {
          authorizationUrl: 'https://auth.example.com/authorize',
          tokenUrl: 'https://auth.example.com/token',
          scopes: {},
        },
      },
    };

    const refreshed = await refresher.refresh(credential, authScheme);
    expect(refreshed).toBe(credential);
  });
});
