/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {expect} from 'chai';

import {
  AuthCredential,
  AuthCredentialTypes,
} from '../../../src/auth/auth_credential.js';
import {AuthScheme} from '../../../src/auth/auth_schemes.js';
import {getMcpAuthHeaders} from '../../../src/tools/mcp/mcp_auth_utils.js';

describe('getMcpAuthHeaders', () => {
  describe('OAuth2 credentials', () => {
    it('should generate Bearer token header for OAuth2 credential with access token', () => {
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.OAUTH2,
        oauth2: {
          accessToken: 'test-access-token',
        },
      };

      const headers = getMcpAuthHeaders(undefined, credential);

      expect(headers).to.deep.equal({
        Authorization: 'Bearer test-access-token',
      });
    });

    it('should return undefined for OAuth2 credential without access token', () => {
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.OAUTH2,
        oauth2: {},
      };

      const headers = getMcpAuthHeaders(undefined, credential);

      expect(headers).to.be.undefined;
    });
  });

  describe('HTTP credentials', () => {
    it('should generate Bearer token header for HTTP bearer scheme', () => {
      const authScheme: AuthScheme = {
        type: 'http',
        scheme: 'bearer',
      };
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.HTTP,
        http: {
          scheme: 'bearer',
          credentials: {
            token: 'http-bearer-token',
          },
        },
      };

      const headers = getMcpAuthHeaders(authScheme, credential);

      expect(headers).to.deep.equal({
        Authorization: 'Bearer http-bearer-token',
      });
    });

    it('should generate Basic auth header for HTTP basic scheme', () => {
      const authScheme: AuthScheme = {
        type: 'http',
        scheme: 'basic',
      };
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.HTTP,
        http: {
          scheme: 'basic',
          credentials: {
            username: 'testuser',
            password: 'testpass',
          },
        },
      };

      const headers = getMcpAuthHeaders(authScheme, credential);

      // Base64 of "testuser:testpass"
      const expectedEncoded = Buffer.from('testuser:testpass').toString('base64');
      expect(headers).to.deep.equal({
        Authorization: `Basic ${expectedEncoded}`,
      });
    });

    it('should return undefined for basic auth without username', () => {
      const authScheme: AuthScheme = {
        type: 'http',
        scheme: 'basic',
      };
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.HTTP,
        http: {
          scheme: 'basic',
          credentials: {
            password: 'testpass',
          },
        },
      };

      const headers = getMcpAuthHeaders(authScheme, credential);

      expect(headers).to.be.undefined;
    });

    it('should return undefined for basic auth without password', () => {
      const authScheme: AuthScheme = {
        type: 'http',
        scheme: 'basic',
      };
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.HTTP,
        http: {
          scheme: 'basic',
          credentials: {
            username: 'testuser',
          },
        },
      };

      const headers = getMcpAuthHeaders(authScheme, credential);

      expect(headers).to.be.undefined;
    });

    it('should handle custom HTTP schemes with token', () => {
      const authScheme: AuthScheme = {
        type: 'http',
        scheme: 'Digest',
      };
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.HTTP,
        http: {
          scheme: 'digest',
          credentials: {
            token: 'digest-token',
          },
        },
      };

      const headers = getMcpAuthHeaders(authScheme, credential);

      expect(headers).to.deep.equal({
        Authorization: 'Digest digest-token',
      });
    });

    it('should return undefined for HTTP credential without auth scheme', () => {
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.HTTP,
        http: {
          scheme: 'bearer',
          credentials: {
            token: 'test-token',
          },
        },
      };

      const headers = getMcpAuthHeaders(undefined, credential);

      expect(headers).to.be.undefined;
    });

    it('should return undefined for HTTP credential with non-HTTP auth scheme', () => {
      const authScheme: AuthScheme = {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      };
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.HTTP,
        http: {
          scheme: 'bearer',
          credentials: {
            token: 'test-token',
          },
        },
      };

      const headers = getMcpAuthHeaders(authScheme, credential);

      expect(headers).to.be.undefined;
    });
  });

  describe('API Key credentials', () => {
    it('should generate custom header for API key in header', () => {
      const authScheme: AuthScheme = {
        type: 'apiKey',
        in: 'header',
        name: 'X-API-Key',
      };
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.API_KEY,
        apiKey: {
          apiKey: 'my-api-key',
          in: 'header',
          name: 'X-API-Key',
        },
      };

      const headers = getMcpAuthHeaders(authScheme, credential);

      expect(headers).to.deep.equal({
        'X-API-Key': 'my-api-key',
      });
    });

    it('should throw error for API key in query', () => {
      const authScheme: AuthScheme = {
        type: 'apiKey',
        in: 'query',
        name: 'api_key',
      };
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.API_KEY,
        apiKey: {
          apiKey: 'my-api-key',
          in: 'query',
          name: 'api_key',
        },
      };

      expect(() => getMcpAuthHeaders(authScheme, credential)).to.throw(
        'MCP tools only support header-based API key authentication',
      );
    });

    it('should throw error for API key in cookie', () => {
      const authScheme: AuthScheme = {
        type: 'apiKey',
        in: 'cookie',
        name: 'session',
      };
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.API_KEY,
        apiKey: {
          apiKey: 'my-api-key',
          in: 'cookie',
          name: 'session',
        },
      };

      expect(() => getMcpAuthHeaders(authScheme, credential)).to.throw(
        'MCP tools only support header-based API key authentication',
      );
    });

    it('should return undefined for API key credential without auth scheme', () => {
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.API_KEY,
        apiKey: {
          apiKey: 'my-api-key',
          in: 'header',
          name: 'X-API-Key',
        },
      };

      const headers = getMcpAuthHeaders(undefined, credential);

      expect(headers).to.be.undefined;
    });

    it('should return undefined for API key credential with non-apiKey auth scheme', () => {
      const authScheme: AuthScheme = {
        type: 'http',
        scheme: 'bearer',
      };
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.API_KEY,
        apiKey: {
          apiKey: 'my-api-key',
          in: 'header',
          name: 'X-API-Key',
        },
      };

      const headers = getMcpAuthHeaders(authScheme, credential);

      expect(headers).to.be.undefined;
    });
  });

  describe('Service Account credentials', () => {
    it('should return undefined and warn for service account credentials', () => {
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.SERVICE_ACCOUNT,
        serviceAccount: {
          useDefaultCredential: true,
        },
      };

      const headers = getMcpAuthHeaders(undefined, credential);

      expect(headers).to.be.undefined;
    });
  });

  describe('Edge cases', () => {
    it('should return undefined for undefined credential', () => {
      const headers = getMcpAuthHeaders(undefined, undefined);

      expect(headers).to.be.undefined;
    });

    it('should return undefined for credential with no recognized type', () => {
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.HTTP,
        // Missing http field
      };

      const headers = getMcpAuthHeaders(undefined, credential);

      expect(headers).to.be.undefined;
    });

    it('should handle case-insensitive bearer scheme', () => {
      const authScheme: AuthScheme = {
        type: 'http',
        scheme: 'BEARER',
      };
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.HTTP,
        http: {
          scheme: 'BEARER',
          credentials: {
            token: 'test-token',
          },
        },
      };

      const headers = getMcpAuthHeaders(authScheme, credential);

      expect(headers).to.deep.equal({
        Authorization: 'Bearer test-token',
      });
    });

    it('should handle case-insensitive basic scheme', () => {
      const authScheme: AuthScheme = {
        type: 'http',
        scheme: 'BASIC',
      };
      const credential: AuthCredential = {
        authType: AuthCredentialTypes.HTTP,
        http: {
          scheme: 'BASIC',
          credentials: {
            username: 'user',
            password: 'pass',
          },
        },
      };

      const headers = getMcpAuthHeaders(authScheme, credential);

      const expectedEncoded = Buffer.from('user:pass').toString('base64');
      expect(headers).to.deep.equal({
        Authorization: `Basic ${expectedEncoded}`,
      });
    });
  });
});
