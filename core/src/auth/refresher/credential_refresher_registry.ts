/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {AuthCredentialTypes} from '../auth_credential.js';

import {BaseCredentialRefresher} from './base_credential_refresher.js';

/**
 * @experimental (Experimental, subject to change) Registry for credential
 * refresher instances.
 */
export class CredentialRefresherRegistry {
  private refreshers: Partial<
    Record<AuthCredentialTypes, BaseCredentialRefresher>
  > = {};

  /**
   * Register a refresher instance for a credential type.
   *
   * @param credentialType The credential type to register for.
   * @param refresherInstance The refresher instance to register.
   */
  register(
    credentialType: AuthCredentialTypes,
    refresherInstance: BaseCredentialRefresher,
  ): void {
    this.refreshers[credentialType] = refresherInstance;
  }

  /**
   * Get the refresher instance for a credential type.
   *
   * @param credentialType The credential type to get refresher for.
   * @returns The refresher instance if registered, undefined otherwise.
   */
  getRefresher(
    credentialType: AuthCredentialTypes,
  ): BaseCredentialRefresher | undefined {
    return this.refreshers[credentialType];
  }
}
