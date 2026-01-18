/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @experimental (Experimental, subject to change) Implements Metadata
 * discovery for OAuth2 following RFC8414 and RFC9728.
 */

/**
 * Represents the OAuth2 authorization server metadata per RFC8414.
 */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  scopesSupported?: string[];
  registrationEndpoint?: string;
}

/**
 * Represents the OAuth2 protected resource metadata per RFC9728.
 */
export interface ProtectedResourceMetadata {
  resource: string;
  authorizationServers: string[];
}

/**
 * @experimental (Experimental, subject to change) OAuth2 Discovery Manager
 * that implements metadata discovery for OAuth2 following RFC8414 and RFC9728.
 */
export class OAuth2DiscoveryManager {
  /**
   * Discovers the OAuth2 authorization server metadata.
   *
   * @param issuerUrl The issuer URL to discover metadata for.
   * @returns The discovered authorization server metadata, or undefined if
   *     discovery fails.
   */
  async discoverAuthServerMetadata(
    issuerUrl: string,
  ): Promise<AuthorizationServerMetadata | undefined> {
    try {
      const parsedUrl = new URL(issuerUrl);
      const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
      const path = parsedUrl.pathname;

      // Try the standard well-known endpoints in order
      let endpointsToTry: string[];

      if (path && path !== '/') {
        endpointsToTry = [
          // 1. OAuth 2.0 Authorization Server Metadata with path insertion
          `${baseUrl}/.well-known/oauth-authorization-server${path}`,
          // 2. OpenID Connect Discovery 1.0 with path insertion
          `${baseUrl}/.well-known/openid-configuration${path}`,
          // 3. OpenID Connect Discovery 1.0 with path appending
          `${baseUrl}${path}/.well-known/openid-configuration`,
        ];
      } else {
        endpointsToTry = [
          // 1. OAuth 2.0 Authorization Server Metadata
          `${baseUrl}/.well-known/oauth-authorization-server`,
          // 2. OpenID Connect Discovery 1.0
          `${baseUrl}/.well-known/openid-configuration`,
        ];
      }

      for (const endpoint of endpointsToTry) {
        try {
          const response = await fetch(endpoint, {
            method: 'GET',
            headers: {
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(5000),
          });

          if (!response.ok) {
            console.debug(`Failed to fetch metadata from ${endpoint}: ${response.status}`);
            continue;
          }

          const data = await response.json();

          // Validate required fields
          if (
            !data.issuer ||
            !data.authorization_endpoint ||
            !data.token_endpoint
          ) {
            console.debug(`Invalid metadata from ${endpoint}: missing required fields`);
            continue;
          }

          const metadata: AuthorizationServerMetadata = {
            issuer: data.issuer,
            authorizationEndpoint: data.authorization_endpoint,
            tokenEndpoint: data.token_endpoint,
            scopesSupported: data.scopes_supported,
            registrationEndpoint: data.registration_endpoint,
          };

          // Validate issuer to defend against MIX-UP attacks
          if (metadata.issuer === issuerUrl.replace(/\/$/, '')) {
            return metadata;
          } else {
            console.warn(
              `Issuer in metadata ${metadata.issuer} does not match issuerUrl ${issuerUrl}`,
            );
          }
        } catch (error) {
          console.debug(`Failed to fetch metadata from ${endpoint}:`, error);
        }
      }

      return undefined;
    } catch (error) {
      console.warn(`Failed to parse issuerUrl ${issuerUrl}:`, error);
      return undefined;
    }
  }

  /**
   * Discovers the OAuth2 protected resource metadata.
   *
   * @param resourceUrl The resource URL to discover metadata for.
   * @returns The discovered protected resource metadata, or undefined if
   *     discovery fails.
   */
  async discoverResourceMetadata(
    resourceUrl: string,
  ): Promise<ProtectedResourceMetadata | undefined> {
    try {
      const parsedUrl = new URL(resourceUrl);
      const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
      const path = parsedUrl.pathname;

      const wellKnownEndpoint =
        path && path !== '/'
          ? `${baseUrl}/.well-known/oauth-protected-resource${path}`
          : `${baseUrl}/.well-known/oauth-protected-resource`;

      try {
        const response = await fetch(wellKnownEndpoint, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        });

        if (!response.ok) {
          console.debug(
            `Failed to fetch metadata from ${wellKnownEndpoint}: ${response.status}`,
          );
          return undefined;
        }

        const data = await response.json();

        // Validate required fields
        if (!data.resource || !data.authorization_servers) {
          console.debug(
            `Invalid metadata from ${wellKnownEndpoint}: missing required fields`,
          );
          return undefined;
        }

        const metadata: ProtectedResourceMetadata = {
          resource: data.resource,
          authorizationServers: data.authorization_servers,
        };

        // Validate resource to defend against MIX-UP attacks
        if (metadata.resource === resourceUrl.replace(/\/$/, '')) {
          return metadata;
        } else {
          console.warn(
            `Resource in metadata ${metadata.resource} does not match resourceUrl ${resourceUrl}`,
          );
        }
      } catch (error) {
        console.debug(`Failed to fetch metadata from ${wellKnownEndpoint}:`, error);
      }

      return undefined;
    } catch (error) {
      console.warn(`Failed to parse resourceUrl ${resourceUrl}:`, error);
      return undefined;
    }
  }
}
