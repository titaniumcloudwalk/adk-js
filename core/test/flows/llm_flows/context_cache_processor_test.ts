/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, expect, it, vi} from 'vitest';

import {InvocationContext} from '../../../src/agents/invocation_context.js';
import {LlmAgent} from '../../../src/agents/llm_agent.js';
import {createEvent, Event} from '../../../src/events/event.js';
import {ContextCacheRequestProcessor, contextCacheRequestProcessor} from '../../../src/flows/llm_flows/context_cache_processor.js';
import {CacheMetadata, ContextCacheConfig} from '../../../src/models/cache_metadata.js';
import {LlmRequest} from '../../../src/models/llm_request.js';
import {PluginManager} from '../../../src/plugins/plugin_manager.js';
import {Session} from '../../../src/sessions/session.js';

function createMockInvocationContext(
  overrides: Partial<{
    contextCacheConfig: ContextCacheConfig;
    events: Event[];
    agentName: string;
    invocationId: string;
  }> = {}
): InvocationContext {
  const agentName = overrides.agentName ?? 'test_agent';
  const agent = new LlmAgent({
    name: agentName,
    model: 'gemini-2.0-flash',
  });

  const session: Session = {
    id: 'test-session',
    appName: 'test-app',
    userId: 'test-user',
    state: {},
    events: overrides.events ?? [],
    lastUpdateTime: Date.now(),
  };

  return new InvocationContext({
    invocationId: overrides.invocationId ?? 'test-invocation-1',
    agent,
    session,
    pluginManager: new PluginManager(),
    contextCacheConfig: overrides.contextCacheConfig,
  });
}

function createMockLlmRequest(): LlmRequest {
  return {
    model: 'gemini-2.0-flash',
    contents: [],
    config: {},
    systemInstruction: '',
    tools: [],
    liveConnectConfig: {},
  };
}

describe('ContextCacheRequestProcessor', () => {
  it('should export a module-level processor instance', () => {
    expect(contextCacheRequestProcessor).toBeInstanceOf(
      ContextCacheRequestProcessor
    );
  });

  it('should do nothing when contextCacheConfig is not set', async () => {
    const invocationContext = createMockInvocationContext();
    const llmRequest = createMockLlmRequest();

    const processor = new ContextCacheRequestProcessor();
    const events: Event[] = [];

    for await (const event of processor.runAsync(invocationContext, llmRequest)) {
      events.push(event);
    }

    expect(events).toHaveLength(0);
    expect(llmRequest.cacheConfig).toBeUndefined();
    expect(llmRequest.cacheMetadata).toBeUndefined();
  });

  it('should set cacheConfig on request when contextCacheConfig is present', async () => {
    const cacheConfig: ContextCacheConfig = {
      cacheIntervals: 5,
      ttlSeconds: 600,
      minTokens: 100,
    };

    const invocationContext = createMockInvocationContext({
      contextCacheConfig: cacheConfig,
    });
    const llmRequest = createMockLlmRequest();

    const processor = new ContextCacheRequestProcessor();
    const events: Event[] = [];

    for await (const event of processor.runAsync(invocationContext, llmRequest)) {
      events.push(event);
    }

    expect(events).toHaveLength(0);
    expect(llmRequest.cacheConfig).toEqual(cacheConfig);
  });

  it('should find and set cache metadata from previous events', async () => {
    const cacheConfig: ContextCacheConfig = {cacheIntervals: 10};
    const previousCacheMetadata: CacheMetadata = {
      cacheName: 'cache_abc123',
      fingerprint: 'abc123fingerprint',
      contentsCount: 5,
      invocationsUsed: 2,
      expireTime: Date.now() + 3600000, // 1 hour from now
      createdAt: Date.now() - 1800000, // 30 mins ago
    };

    const events: Event[] = [
      createEvent({
        invocationId: 'previous-invocation',
        author: 'test_agent',
        content: {role: 'model', parts: [{text: 'Previous response'}]},
        cacheMetadata: previousCacheMetadata,
        usageMetadata: {promptTokenCount: 1000},
      }),
    ];

    const invocationContext = createMockInvocationContext({
      contextCacheConfig: cacheConfig,
      events,
      invocationId: 'current-invocation',
    });
    const llmRequest = createMockLlmRequest();

    const processor = new ContextCacheRequestProcessor();

    for await (const event of processor.runAsync(invocationContext, llmRequest)) {
      // No events expected
    }

    // Should have incremented invocationsUsed since it's a different invocation
    expect(llmRequest.cacheMetadata).toBeDefined();
    expect(llmRequest.cacheMetadata?.cacheName).toBe('cache_abc123');
    expect(llmRequest.cacheMetadata?.invocationsUsed).toBe(3); // 2 + 1
    expect(llmRequest.cacheableContentsTokenCount).toBe(1000);
  });

  it('should not increment invocationsUsed for same invocation', async () => {
    const cacheConfig: ContextCacheConfig = {cacheIntervals: 10};
    const previousCacheMetadata: CacheMetadata = {
      cacheName: 'cache_abc123',
      fingerprint: 'abc123fingerprint',
      contentsCount: 5,
      invocationsUsed: 2,
      expireTime: Date.now() + 3600000,
      createdAt: Date.now() - 1800000,
    };

    const events: Event[] = [
      createEvent({
        invocationId: 'same-invocation',
        author: 'test_agent',
        content: {role: 'model', parts: [{text: 'Previous response'}]},
        cacheMetadata: previousCacheMetadata,
        usageMetadata: {promptTokenCount: 500},
      }),
    ];

    const invocationContext = createMockInvocationContext({
      contextCacheConfig: cacheConfig,
      events,
      invocationId: 'same-invocation', // Same as event
    });
    const llmRequest = createMockLlmRequest();

    const processor = new ContextCacheRequestProcessor();

    for await (const event of processor.runAsync(invocationContext, llmRequest)) {
      // No events expected
    }

    // Should NOT increment since it's the same invocation
    expect(llmRequest.cacheMetadata?.invocationsUsed).toBe(2);
  });

  it('should skip events from other agents', async () => {
    const cacheConfig: ContextCacheConfig = {cacheIntervals: 10};

    const events: Event[] = [
      createEvent({
        invocationId: 'inv-1',
        author: 'other_agent', // Different agent
        content: {role: 'model', parts: [{text: 'Other response'}]},
        cacheMetadata: {
          cacheName: 'cache_other',
          fingerprint: 'other_fingerprint',
          contentsCount: 3,
          invocationsUsed: 5,
        },
        usageMetadata: {promptTokenCount: 2000},
      }),
    ];

    const invocationContext = createMockInvocationContext({
      contextCacheConfig: cacheConfig,
      events,
      agentName: 'test_agent',
      invocationId: 'current-invocation',
    });
    const llmRequest = createMockLlmRequest();

    const processor = new ContextCacheRequestProcessor();

    for await (const event of processor.runAsync(invocationContext, llmRequest)) {
      // No events expected
    }

    // Should not find cache metadata since it's from a different agent
    expect(llmRequest.cacheMetadata).toBeUndefined();
    expect(llmRequest.cacheableContentsTokenCount).toBeUndefined();
  });

  it('should find most recent cache metadata and token count', async () => {
    const cacheConfig: ContextCacheConfig = {cacheIntervals: 10};

    const events: Event[] = [
      createEvent({
        invocationId: 'inv-1',
        author: 'test_agent',
        content: {role: 'model', parts: [{text: 'Old response'}]},
        cacheMetadata: {
          cacheName: 'cache_old',
          fingerprint: 'old_fp',
          contentsCount: 2,
          invocationsUsed: 1,
        },
        usageMetadata: {promptTokenCount: 500},
      }),
      createEvent({
        invocationId: 'inv-2',
        author: 'test_agent',
        content: {role: 'model', parts: [{text: 'New response'}]},
        cacheMetadata: {
          cacheName: 'cache_new',
          fingerprint: 'new_fp',
          contentsCount: 4,
          invocationsUsed: 3,
        },
        usageMetadata: {promptTokenCount: 1500},
      }),
    ];

    const invocationContext = createMockInvocationContext({
      contextCacheConfig: cacheConfig,
      events,
      invocationId: 'current-invocation',
    });
    const llmRequest = createMockLlmRequest();

    const processor = new ContextCacheRequestProcessor();

    for await (const event of processor.runAsync(invocationContext, llmRequest)) {
      // No events expected
    }

    // Should find the most recent (cache_new)
    expect(llmRequest.cacheMetadata?.cacheName).toBe('cache_new');
    expect(llmRequest.cacheMetadata?.invocationsUsed).toBe(4); // 3 + 1
    expect(llmRequest.cacheableContentsTokenCount).toBe(1500);
  });

  it('should not increment invocationsUsed when cacheName is undefined', async () => {
    const cacheConfig: ContextCacheConfig = {cacheIntervals: 10};

    // Cache metadata without cacheName (fingerprint-only state)
    const events: Event[] = [
      createEvent({
        invocationId: 'inv-1',
        author: 'test_agent',
        content: {role: 'model', parts: [{text: 'Response'}]},
        cacheMetadata: {
          fingerprint: 'some_fingerprint',
          contentsCount: 3,
          invocationsUsed: 1,
          // No cacheName - fingerprint-only state
        },
        usageMetadata: {promptTokenCount: 800},
      }),
    ];

    const invocationContext = createMockInvocationContext({
      contextCacheConfig: cacheConfig,
      events,
      invocationId: 'current-invocation',
    });
    const llmRequest = createMockLlmRequest();

    const processor = new ContextCacheRequestProcessor();

    for await (const event of processor.runAsync(invocationContext, llmRequest)) {
      // No events expected
    }

    // Should NOT increment since there's no active cache
    expect(llmRequest.cacheMetadata?.invocationsUsed).toBe(1);
  });
});
