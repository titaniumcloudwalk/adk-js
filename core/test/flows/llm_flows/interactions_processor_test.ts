/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {beforeAll, describe, expect, it} from 'vitest';

import {InvocationContext} from '../../../src/agents/invocation_context.js';

// Set a mock API key for tests
beforeAll(() => {
  process.env.GOOGLE_GENAI_API_KEY = 'test-api-key';
});
import {LlmAgent} from '../../../src/agents/llm_agent.js';
import {createEvent, Event} from '../../../src/events/event.js';
import {InteractionsRequestProcessor, interactionsRequestProcessor} from '../../../src/flows/llm_flows/interactions_processor.js';
import {LlmRequest} from '../../../src/models/llm_request.js';
import {PluginManager} from '../../../src/plugins/plugin_manager.js';
import {Session} from '../../../src/sessions/session.js';

function createMockInvocationContext(
  overrides: Partial<{
    events: Event[];
    agentName: string;
    branch: string;
  }> = {}
): InvocationContext {
  const agentName = overrides.agentName ?? 'test_agent';

  // Create LlmAgent with string model (not Gemini instance)
  // This means isUsingInteractionsApi check will fail since model is not Gemini
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
    invocationId: 'test-invocation',
    agent,
    session,
    branch: overrides.branch,
    pluginManager: new PluginManager(),
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

describe('InteractionsRequestProcessor', () => {
  it('should export a module-level processor instance', () => {
    expect(interactionsRequestProcessor).toBeInstanceOf(
      InteractionsRequestProcessor
    );
  });

  it('should do nothing when model is not a Gemini instance', async () => {
    // When using string model 'gemini-2.0-flash', it's not a Gemini instance
    // so the processor should return early
    const events: Event[] = [
      createEvent({
        invocationId: 'inv-1',
        author: 'test_agent',
        content: {role: 'model', parts: [{text: 'Response'}]},
        interactionId: 'interaction-123',
      }),
    ];

    const invocationContext = createMockInvocationContext({events});
    const llmRequest = createMockLlmRequest();

    const processor = new InteractionsRequestProcessor();
    const generatedEvents: Event[] = [];

    for await (const event of processor.runAsync(invocationContext, llmRequest)) {
      generatedEvents.push(event);
    }

    // Should not yield any events
    expect(generatedEvents).toHaveLength(0);
    // Should not set previousInteractionId since model is not Gemini
    expect(llmRequest.previousInteractionId).toBeUndefined();
  });

  it('should be an async generator that yields no events', async () => {
    const invocationContext = createMockInvocationContext();
    const llmRequest = createMockLlmRequest();

    const processor = new InteractionsRequestProcessor();

    // Verify it's an async generator
    const generator = processor.runAsync(invocationContext, llmRequest);
    expect(typeof generator[Symbol.asyncIterator]).toBe('function');

    const events: Event[] = [];
    for await (const event of generator) {
      events.push(event);
    }

    // Should not yield any events
    expect(events).toHaveLength(0);
  });
});

describe('InteractionsRequestProcessor - Branch Filtering Logic', () => {
  // Test the internal branch filtering logic by checking the processor class
  // Since we can't easily test with a real Gemini instance, we test the class exists
  // and has the expected structure

  it('should have runAsync method', () => {
    const processor = new InteractionsRequestProcessor();
    expect(typeof processor.runAsync).toBe('function');
  });

  it('should be a subclass of BaseLlmRequestProcessor', async () => {
    const {BaseLlmRequestProcessor} = await import(
      '../../../src/agents/base_llm_processor.js'
    );
    const processor = new InteractionsRequestProcessor();
    expect(processor).toBeInstanceOf(BaseLlmRequestProcessor);
  });
});
