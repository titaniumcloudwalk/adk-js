/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {OpenAPIV3} from 'openapi-types';

import {ToolContext} from '../tools/tool_context.js';

import {AuthCredential, AuthCredentialTypes, isSimpleCredential} from './auth_credential.js';
import {AuthScheme, OpenIdConnectWithConfig} from './auth_schemes.js';
import {AuthConfig} from './auth_tool.js';
import {CredentialExchangerRegistry} from './exchanger/credential_exchanger_registry.js';
import {OAuth2CredentialExchanger} from './exchanger/oauth2_credential_exchanger.js';
import {ServiceAccountCredentialExchanger} from './exchanger/service_account_exchanger.js';
import {OAuth2DiscoveryManager} from './oauth2_discovery.js';
import {CredentialRefresherRegistry} from './refresher/credential_refresher_registry.js';
import {OAuth2CredentialRefresher} from './refresher/oauth2_credential_refresher.js';

/**
 * @experimental (Experimental, subject to change) Manages authentication
 * credentials through a structured workflow.
 *
 * The CredentialManager orchestrates the complete lifecycle of authentication
 * credentials, from initial loading to final preparation for use. It provides
 * a centralized interface for handling various credential types and
 * authentication schemes while maintaining proper credential hygiene (refresh,
 * exchange, caching).
 *
 * This class is only for use by Agent Development Kit.
 *
 * Example:
 * ```typescript
 * const manager = new CredentialManager(authConfig);
 *
 * // Register custom exchanger if needed
 * manager.registerCredentialExchanger(
 *   AuthCredentialTypes.CUSTOM_TYPE,
 *   customExchanger
 * );
 *
 * // Load and prepare credential
 * const credential = await manager.getAuthCredential(toolContext);
 * ```
 */
export class CredentialManager {
  private readonly authConfig: AuthConfig;
  private readonly exchangerRegistry: CredentialExchangerRegistry;
  private readonly refresherRegistry: CredentialRefresherRegistry;
  private readonly discoveryManager: OAuth2DiscoveryManager;

  constructor(authConfig: AuthConfig) {
    this.authConfig = authConfig;
    this.exchangerRegistry = new CredentialExchangerRegistry();
    this.refresherRegistry = new CredentialRefresherRegistry();
    this.discoveryManager = new OAuth2DiscoveryManager();

    // Register default exchangers and refreshers
    const oauth2Exchanger = new OAuth2CredentialExchanger();
    this.exchangerRegistry.register(AuthCredentialTypes.OAUTH2, oauth2Exchanger);
    this.exchangerRegistry.register(
      AuthCredentialTypes.OPEN_ID_CONNECT,
      oauth2Exchanger,
    );
    this.exchangerRegistry.register(
      AuthCredentialTypes.SERVICE_ACCOUNT,
      new ServiceAccountCredentialExchanger(),
    );

    const oauth2Refresher = new OAuth2CredentialRefresher();
    this.refresherRegistry.register(AuthCredentialTypes.OAUTH2, oauth2Refresher);
    this.refresherRegistry.register(
      AuthCredentialTypes.OPEN_ID_CONNECT,
      oauth2Refresher,
    );
  }

  /**
   * Register a credential exchanger for a credential type.
   *
   * @param credentialType The credential type to register for.
   * @param exchangerInstance The exchanger instance to register.
   */
  registerCredentialExchanger(
    credentialType: AuthCredentialTypes,
    exchangerInstance: any,
  ): void {
    this.exchangerRegistry.register(credentialType, exchangerInstance);
  }

  /**
   * Register a credential refresher for a credential type.
   *
   * @param credentialType The credential type to register for.
   * @param refresherInstance The refresher instance to register.
   */
  registerCredentialRefresher(
    credentialType: AuthCredentialTypes,
    refresherInstance: any,
  ): void {
    this.refresherRegistry.register(credentialType, refresherInstance);
  }

  /**
   * Request credential from the client.
   */
  async requestCredential(toolContext: ToolContext): Promise<void> {
    toolContext.requestCredential(this.authConfig);
  }

  /**
   * Load and prepare authentication credential through a structured workflow.
   *
   * Implements the 8-step workflow:
   * 1. Validate credential configuration
   * 2. Check if credential is already ready (no processing needed)
   * 3. Try to load existing processed credential
   * 4. If no existing credential, load from auth response
   * 5. If still no credential, check if client credentials flow
   * 6. Exchange credential if needed
   * 7. Refresh credential if expired
   * 8. Save credential if it was modified
   *
   * @param toolContext The tool context for credential operations.
   * @returns The prepared authentication credential, or undefined if not
   *     available.
   */
  async getAuthCredential(
    toolContext: ToolContext,
  ): Promise<AuthCredential | undefined> {
    // Step 1: Validate credential configuration
    await this.validateCredential();

    // Step 2: Check if credential is already ready (no processing needed)
    if (this.isCredentialReady()) {
      return this.authConfig.rawAuthCredential;
    }

    // Step 3: Try to load existing processed credential
    let credential = await this.loadExistingCredential(toolContext);

    // Step 4: If no existing credential, load from auth response
    let wasFromAuthResponse = false;
    if (!credential) {
      credential = await this.loadFromAuthResponse(toolContext);
      wasFromAuthResponse = !!credential;
    }

    // Step 5: If still no credential available, check if client credentials
    if (!credential) {
      // For client credentials flow, use raw credentials directly
      if (this.isClientCredentialsFlow()) {
        credential = this.authConfig.rawAuthCredential;
      } else {
        // For authorization code flow, return undefined to trigger user authorization
        return undefined;
      }
    }

    // Step 6: Exchange credential if needed (e.g., service account to access token)
    let wasExchanged = false;
    if (credential) {
      const exchangeResult = await this.exchangeCredential(credential);
      credential = exchangeResult.credential;
      wasExchanged = exchangeResult.wasExchanged;
    }

    // Step 7: Refresh credential if expired
    let wasRefreshed = false;
    if (credential && !wasExchanged) {
      const refreshResult = await this.refreshCredential(credential);
      credential = refreshResult.credential;
      wasRefreshed = refreshResult.wasRefreshed;
    }

    // Step 8: Save credential if it was modified
    if (credential && (wasFromAuthResponse || wasExchanged || wasRefreshed)) {
      await this.saveCredential(toolContext, credential);
    }

    return credential;
  }

  /**
   * Load existing credential from credential service.
   */
  private async loadExistingCredential(
    toolContext: ToolContext,
  ): Promise<AuthCredential | undefined> {
    return await this.loadFromCredentialService(toolContext);
  }

  /**
   * Load credential from credential service if available.
   */
  private async loadFromCredentialService(
    toolContext: ToolContext,
  ): Promise<AuthCredential | undefined> {
    const credentialService =
      toolContext.invocationContext.credentialService;
    if (credentialService) {
      return await credentialService.loadCredential(
        this.authConfig,
        toolContext,
      );
    }
    return undefined;
  }

  /**
   * Load credential from auth response in tool context.
   */
  private async loadFromAuthResponse(
    toolContext: ToolContext,
  ): Promise<AuthCredential | undefined> {
    return toolContext.getAuthResponse(this.authConfig);
  }

  /**
   * Exchange credential if needed.
   */
  private async exchangeCredential(
    credential: AuthCredential,
  ): Promise<{credential: AuthCredential; wasExchanged: boolean}> {
    const exchanger = this.exchangerRegistry.getExchanger(credential.authType);
    if (!exchanger) {
      return {credential, wasExchanged: false};
    }

    const exchangeResult = await exchanger.exchange(
      credential,
      this.authConfig.authScheme,
    );
    return {
      credential: exchangeResult.credential,
      wasExchanged: exchangeResult.wasExchanged,
    };
  }

  /**
   * Refresh credential if expired.
   */
  private async refreshCredential(
    credential: AuthCredential,
  ): Promise<{credential: AuthCredential; wasRefreshed: boolean}> {
    const refresher = this.refresherRegistry.getRefresher(credential.authType);
    if (!refresher) {
      return {credential, wasRefreshed: false};
    }

    const needsRefresh = await refresher.isRefreshNeeded(
      credential,
      this.authConfig.authScheme,
    );
    if (needsRefresh) {
      const refreshedCredential = await refresher.refresh(
        credential,
        this.authConfig.authScheme,
      );
      return {credential: refreshedCredential, wasRefreshed: true};
    }

    return {credential, wasRefreshed: false};
  }

  /**
   * Check if credential is ready to use without further processing.
   */
  private isCredentialReady(): boolean {
    const rawCredential = this.authConfig.rawAuthCredential;
    if (!rawCredential) {
      return false;
    }

    // Simple credentials that don't need exchange or refresh
    return isSimpleCredential(rawCredential);
  }

  /**
   * Validate credential configuration and raise errors if invalid.
   */
  private async validateCredential(): Promise<void> {
    if (!this.authConfig.rawAuthCredential) {
      const schemeType = this.authConfig.authScheme.type;
      if (schemeType === 'oauth2' || schemeType === 'openIdConnect') {
        throw new Error(
          `rawAuthCredential is required for auth scheme type ${schemeType}`,
        );
      }
    }

    const rawCredential = this.authConfig.rawAuthCredential;
    if (rawCredential) {
      if (
        (rawCredential.authType === AuthCredentialTypes.OAUTH2 ||
          rawCredential.authType === AuthCredentialTypes.OPEN_ID_CONNECT) &&
        !rawCredential.oauth2
      ) {
        throw new Error(
          `oauth2 field is required for credential type ${rawCredential.authType}`,
        );
      }
    }

    if (this.missingOAuthInfo() && !(await this.populateAuthScheme())) {
      throw new Error(
        'OAuth scheme info is missing, and auto-discovery has failed to fill them in.',
      );
    }
  }

  /**
   * Save credential to credential service if available.
   */
  private async saveCredential(
    toolContext: ToolContext,
    credential: AuthCredential,
  ): Promise<void> {
    // Update the exchanged credential in config
    this.authConfig.exchangedAuthCredential = credential;

    const credentialService =
      toolContext.invocationContext.credentialService;
    if (credentialService) {
      await credentialService.saveCredential(this.authConfig, toolContext);
    }
  }

  /**
   * Auto-discover server metadata and populate missing auth scheme info.
   *
   * @returns True if auto-discovery was successful, False otherwise.
   */
  private async populateAuthScheme(): Promise<boolean> {
    const authScheme = this.authConfig.authScheme;

    // Check if this is an ExtendedOAuth2 with issuer_url
    if (
      this.isOAuth2Scheme(authScheme) &&
      (authScheme as any).issuerUrl
    ) {
      const issuerUrl = (authScheme as any).issuerUrl;
      const metadata =
        await this.discoveryManager.discoverAuthServerMetadata(issuerUrl);

      if (!metadata) {
        console.warn('Auto-discovery has failed to populate OAuth scheme info.');
        return false;
      }

      const flows = authScheme.flows;
      if (!flows) {
        return false;
      }

      if (flows.implicit && !flows.implicit.authorizationUrl) {
        flows.implicit.authorizationUrl = metadata.authorizationEndpoint;
      }
      if (flows.password && !flows.password.tokenUrl) {
        flows.password.tokenUrl = metadata.tokenEndpoint;
      }
      if (flows.clientCredentials && !flows.clientCredentials.tokenUrl) {
        flows.clientCredentials.tokenUrl = metadata.tokenEndpoint;
      }
      if (flows.authorizationCode && !flows.authorizationCode.authorizationUrl) {
        flows.authorizationCode.authorizationUrl = metadata.authorizationEndpoint;
      }
      if (flows.authorizationCode && !flows.authorizationCode.tokenUrl) {
        flows.authorizationCode.tokenUrl = metadata.tokenEndpoint;
      }

      return true;
    }

    console.warn('No issuerUrl was provided for auto-discovery.');
    return false;
  }

  /**
   * Check if we are missing auth/token URLs needed for OAuth.
   */
  private missingOAuthInfo(): boolean {
    const authScheme = this.authConfig.authScheme;
    if (this.isOAuth2Scheme(authScheme)) {
      const flows = authScheme.flows;
      if (!flows) {
        return false;
      }

      return (
        (!!flows.implicit && !flows.implicit.authorizationUrl) ||
        (!!flows.password && !flows.password.tokenUrl) ||
        (!!flows.clientCredentials && !flows.clientCredentials.tokenUrl) ||
        (!!flows.authorizationCode &&
          !flows.authorizationCode.authorizationUrl) ||
        (!!flows.authorizationCode && !flows.authorizationCode.tokenUrl)
      );
    }
    return false;
  }

  /**
   * Check if the auth scheme uses client credentials flow.
   */
  private isClientCredentialsFlow(): boolean {
    const authScheme = this.authConfig.authScheme;

    // Check OAuth2 schemes
    if (this.isOAuth2Scheme(authScheme) && authScheme.flows) {
      return !!authScheme.flows.clientCredentials;
    }

    // Check OIDC schemes
    if (this.isOpenIdConnectScheme(authScheme)) {
      return (
        !!authScheme.grantTypesSupported &&
        authScheme.grantTypesSupported.includes('client_credentials')
      );
    }

    return false;
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
