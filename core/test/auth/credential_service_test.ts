/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  AuthCredential,
  AuthCredentialTypes,
} from '../../src/auth/auth_credential.js';
import {AuthConfig} from '../../src/auth/auth_tool.js';
import {InMemoryCredentialService} from '../../src/auth/credential_service/in_memory_credential_service.js';
import {SessionStateCredentialService} from '../../src/auth/credential_service/session_state_credential_service.js';
import {ToolContext} from '../../src/tools/tool_context.js';
import {State} from '../../src/sessions/state.js';
import {InvocationContext} from '../../src/agents/invocation_context.js';

// Create a minimal mock ToolContext for testing
function createMockToolContext(
  appName: string = 'test-app',
  userId: string = 'test-user',
  state: State = new State({}, {}),
): ToolContext {
  const invocationContext = {
    session: {
      appName,
      userId,
      id: 'test-session',
      state: {},
    },
    appName,
    userId,
  } as unknown as InvocationContext;

  const toolContext = new ToolContext({
    invocationContext,
    functionCallId: 'test-function-call',
  });

  // Override state for testing
  (toolContext as any)._state = state;

  return toolContext;
}

describe('InMemoryCredentialService', () => {
  let service: InMemoryCredentialService;
  let authConfig: AuthConfig;
  let credential: AuthCredential;

  beforeEach(() => {
    service = new InMemoryCredentialService();
    authConfig = {
      authScheme: {type: 'apiKey'} as any,
      credentialKey: 'test-key',
    };
    credential = {
      authType: AuthCredentialTypes.API_KEY,
      apiKey: {
        apiKey: 'test-api-key',
        in: 'header',
        name: 'X-API-Key',
      },
    };
  });

  it('should return undefined for non-existent credential', async () => {
    const toolContext = createMockToolContext();
    const result = await service.loadCredential(authConfig, toolContext);
    expect(result).toBeUndefined();
  });

  it('should save and load credential', async () => {
    const toolContext = createMockToolContext();
    authConfig.exchangedAuthCredential = credential;

    await service.saveCredential(authConfig, toolContext);
    const loaded = await service.loadCredential(authConfig, toolContext);

    expect(loaded).toEqual(credential);
  });

  it('should isolate credentials by app name', async () => {
    const toolContext1 = createMockToolContext('app1', 'user1');
    const toolContext2 = createMockToolContext('app2', 'user1');

    authConfig.exchangedAuthCredential = credential;

    await service.saveCredential(authConfig, toolContext1);

    const loaded1 = await service.loadCredential(authConfig, toolContext1);
    const loaded2 = await service.loadCredential(authConfig, toolContext2);

    expect(loaded1).toEqual(credential);
    expect(loaded2).toBeUndefined();
  });

  it('should isolate credentials by user ID', async () => {
    const toolContext1 = createMockToolContext('app1', 'user1');
    const toolContext2 = createMockToolContext('app1', 'user2');

    authConfig.exchangedAuthCredential = credential;

    await service.saveCredential(authConfig, toolContext1);

    const loaded1 = await service.loadCredential(authConfig, toolContext1);
    const loaded2 = await service.loadCredential(authConfig, toolContext2);

    expect(loaded1).toEqual(credential);
    expect(loaded2).toBeUndefined();
  });

  it('should overwrite existing credential with same key', async () => {
    const toolContext = createMockToolContext();
    const credential1 = {...credential};
    const credential2: AuthCredential = {
      authType: AuthCredentialTypes.API_KEY,
      apiKey: {
        apiKey: 'new-api-key',
        in: 'header',
        name: 'X-API-Key',
      },
    };

    authConfig.exchangedAuthCredential = credential1;
    await service.saveCredential(authConfig, toolContext);

    authConfig.exchangedAuthCredential = credential2;
    await service.saveCredential(authConfig, toolContext);

    const loaded = await service.loadCredential(authConfig, toolContext);
    expect(loaded).toEqual(credential2);
  });
});

describe('SessionStateCredentialService', () => {
  let service: SessionStateCredentialService;
  let authConfig: AuthConfig;
  let credential: AuthCredential;

  beforeEach(() => {
    service = new SessionStateCredentialService();
    authConfig = {
      authScheme: {type: 'apiKey'} as any,
      credentialKey: 'test-key',
    };
    credential = {
      authType: AuthCredentialTypes.API_KEY,
      apiKey: {
        apiKey: 'test-api-key',
        in: 'header',
        name: 'X-API-Key',
      },
    };
  });

  it('should return undefined for non-existent credential', async () => {
    const state = new State({}, {});
    const toolContext = createMockToolContext('app1', 'user1', state);

    const result = await service.loadCredential(authConfig, toolContext);
    expect(result).toBeUndefined();
  });

  it('should save and load credential from state', async () => {
    const state = new State({}, {});
    const toolContext = createMockToolContext('app1', 'user1', state);

    authConfig.exchangedAuthCredential = credential;

    await service.saveCredential(authConfig, toolContext);
    const loaded = await service.loadCredential(authConfig, toolContext);

    expect(loaded).toEqual(credential);
  });

  it('should store credential in state with correct key', async () => {
    const state = new State({}, {});
    const toolContext = createMockToolContext('app1', 'user1', state);

    authConfig.exchangedAuthCredential = credential;

    await service.saveCredential(authConfig, toolContext);

    // Check that the credential is in the state
    const stateValue = state.get<AuthCredential>(authConfig.credentialKey);
    expect(stateValue).toEqual(credential);
  });
});
