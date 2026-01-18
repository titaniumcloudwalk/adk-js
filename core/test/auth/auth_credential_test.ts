/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AuthCredential,
  AuthCredentialTypes,
  isSimpleCredential,
  isOAuth2Expired,
  updateCredentialWithTokens,
} from '../../src/auth/auth_credential.js';

describe('isSimpleCredential', () => {
  it('should return true for API_KEY credentials', () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.API_KEY,
      apiKey: {
        apiKey: 'test-key',
        in: 'header',
        name: 'X-API-Key',
      },
    };

    expect(isSimpleCredential(credential)).toBe(true);
  });

  it('should return true for HTTP credentials', () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.HTTP,
      http: {
        scheme: 'bearer',
        credentials: {
          token: 'test-token',
        },
      },
    };

    expect(isSimpleCredential(credential)).toBe(true);
  });

  it('should return false for OAUTH2 credentials', () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.OAUTH2,
      oauth2: {
        accessToken: 'test-token',
      },
    };

    expect(isSimpleCredential(credential)).toBe(false);
  });

  it('should return false for OPEN_ID_CONNECT credentials', () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.OPEN_ID_CONNECT,
      oauth2: {
        accessToken: 'test-token',
      },
    };

    expect(isSimpleCredential(credential)).toBe(false);
  });

  it('should return false for SERVICE_ACCOUNT credentials', () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.SERVICE_ACCOUNT,
      serviceAccount: {
        useDefaultCredential: true,
      },
    };

    expect(isSimpleCredential(credential)).toBe(false);
  });
});

describe('isOAuth2Expired', () => {
  it('should return true for expired credentials', () => {
    const oauth2 = {
      accessToken: 'test-token',
      expiresAt: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
    };

    expect(isOAuth2Expired(oauth2)).toBe(true);
  });

  it('should return false for valid credentials', () => {
    const oauth2 = {
      accessToken: 'test-token',
      expiresAt: Math.floor(Date.now() / 1000) + 3600, // Expires in 1 hour
    };

    expect(isOAuth2Expired(oauth2)).toBe(false);
  });

  it('should return true for credentials expiring within 5 minutes', () => {
    const oauth2 = {
      accessToken: 'test-token',
      expiresAt: Math.floor(Date.now() / 1000) + 200, // Expires in 200 seconds
    };

    expect(isOAuth2Expired(oauth2)).toBe(true);
  });

  it('should return false for credentials without expiresAt', () => {
    const oauth2 = {
      accessToken: 'test-token',
    };

    expect(isOAuth2Expired(oauth2)).toBe(false);
  });
});

describe('updateCredentialWithTokens', () => {
  it('should update credential with all token fields', () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.OAUTH2,
      oauth2: {},
    };

    const tokens = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'read write',
    };

    updateCredentialWithTokens(credential, tokens);

    expect(credential.oauth2?.accessToken).toBe('new-access-token');
    expect(credential.oauth2?.refreshToken).toBe('new-refresh-token');
    expect(credential.oauth2?.expiresIn).toBe(3600);
    expect(credential.oauth2?.tokenType).toBe('Bearer');
    expect(credential.oauth2?.scope).toBe('read write');
    expect(credential.oauth2?.expiresAt).toBeDefined();
  });

  it('should calculate expiresAt correctly', () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.OAUTH2,
      oauth2: {},
    };

    const now = Math.floor(Date.now() / 1000);
    const tokens = {
      access_token: 'new-access-token',
      expires_in: 3600,
    };

    updateCredentialWithTokens(credential, tokens);

    expect(credential.oauth2?.expiresAt).toBeGreaterThanOrEqual(now + 3600);
    expect(credential.oauth2?.expiresAt).toBeLessThanOrEqual(now + 3601);
  });

  it('should create oauth2 object if not present', () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.OAUTH2,
    };

    const tokens = {
      access_token: 'new-access-token',
    };

    updateCredentialWithTokens(credential, tokens);

    expect(credential.oauth2).toBeDefined();
    expect(credential.oauth2?.accessToken).toBe('new-access-token');
  });

  it('should handle partial token updates', () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.OAUTH2,
      oauth2: {
        refreshToken: 'existing-refresh-token',
      },
    };

    const tokens = {
      access_token: 'new-access-token',
      expires_in: 3600,
    };

    updateCredentialWithTokens(credential, tokens);

    expect(credential.oauth2?.accessToken).toBe('new-access-token');
    expect(credential.oauth2?.refreshToken).toBe('existing-refresh-token');
    expect(credential.oauth2?.expiresIn).toBe(3600);
  });

  it('should overwrite existing token values', () => {
    const credential: AuthCredential = {
      authType: AuthCredentialTypes.OAUTH2,
      oauth2: {
        accessToken: 'old-access-token',
        refreshToken: 'old-refresh-token',
      },
    };

    const tokens = {
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
    };

    updateCredentialWithTokens(credential, tokens);

    expect(credential.oauth2?.accessToken).toBe('new-access-token');
    expect(credential.oauth2?.refreshToken).toBe('new-refresh-token');
  });
});
