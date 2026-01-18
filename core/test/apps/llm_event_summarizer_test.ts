/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {expect} from 'chai';

import {LlmEventSummarizer} from '../../src/apps/llm_event_summarizer.js';
import {createEvent, Event} from '../../src/events/event.js';
import {BaseLlm} from '../../src/models/base_llm.js';
import {BaseLlmConnection} from '../../src/models/base_llm_connection.js';
import {LlmRequest} from '../../src/models/llm_request.js';
import {LlmResponse} from '../../src/models/llm_response.js';

/**
 * Mock LLM for testing.
 */
class MockLlm extends BaseLlm {
  public lastRequest: LlmRequest | undefined;
  public responseText: string = 'This is a summary of the conversation.';
  public shouldFail = false;

  constructor() {
    super({model: 'mock-model'});
  }

  async *generateContentAsync(llmRequest: LlmRequest): AsyncGenerator<LlmResponse, void> {
    this.lastRequest = llmRequest;

    if (this.shouldFail) {
      throw new Error('LLM call failed');
    }

    yield {
      content: {
        role: 'model',
        parts: [{text: this.responseText}],
      },
    };
  }

  async connect(): Promise<BaseLlmConnection> {
    throw new Error('Not implemented');
  }
}

describe('LlmEventSummarizer', () => {
  let mockLlm: MockLlm;
  let summarizer: LlmEventSummarizer;

  beforeEach(() => {
    mockLlm = new MockLlm();
    summarizer = new LlmEventSummarizer({llm: mockLlm});
  });

  function createTestEvent(author: string, text: string, timestamp = Date.now()): Event {
    return createEvent({
      invocationId: 'test_inv',
      timestamp,
      author,
      content: {
        role: author === 'user' ? 'user' : 'model',
        parts: [{text}],
      },
    });
  }

  describe('maybeSummarizeEvents', () => {
    it('should return undefined for empty events', async () => {
      const result = await summarizer.maybeSummarizeEvents([]);
      expect(result).to.be.undefined;
    });

    it('should return undefined for null events', async () => {
      const result = await summarizer.maybeSummarizeEvents(null as unknown as Event[]);
      expect(result).to.be.undefined;
    });

    it('should summarize events and return compacted event', async () => {
      const events = [
        createTestEvent('user', 'Hello', 1000),
        createTestEvent('assistant', 'Hi there!', 2000),
        createTestEvent('user', 'How are you?', 3000),
      ];

      const result = await summarizer.maybeSummarizeEvents(events);

      expect(result).to.not.be.undefined;
      expect(result!.actions?.compaction).to.not.be.undefined;
      expect(result!.actions?.compaction?.startTimestamp).to.equal(1000);
      expect(result!.actions?.compaction?.endTimestamp).to.equal(3000);
      expect(result!.content?.parts?.[0]?.text).to.equal(mockLlm.responseText);
    });

    it('should call LLM with formatted conversation history', async () => {
      const events = [
        createTestEvent('user', 'Hello', 1000),
        createTestEvent('assistant', 'Hi there!', 2000),
      ];

      await summarizer.maybeSummarizeEvents(events);

      expect(mockLlm.lastRequest).to.not.be.undefined;
      const promptContent = mockLlm.lastRequest!.contents[0].parts?.[0]?.text;
      expect(promptContent).to.include('user: Hello');
      expect(promptContent).to.include('assistant: Hi there!');
    });

    it('should use custom prompt template', async () => {
      const customSummarizer = new LlmEventSummarizer({
        llm: mockLlm,
        promptTemplate: 'Custom prompt: {conversationHistory}',
      });

      const events = [createTestEvent('user', 'Test message', 1000)];
      await customSummarizer.maybeSummarizeEvents(events);

      const promptContent = mockLlm.lastRequest!.contents[0].parts?.[0]?.text;
      expect(promptContent).to.include('Custom prompt:');
      expect(promptContent).to.include('user: Test message');
    });

    it('should return undefined if LLM call fails', async () => {
      mockLlm.shouldFail = true;

      const events = [createTestEvent('user', 'Hello', 1000)];
      const result = await summarizer.maybeSummarizeEvents(events);

      expect(result).to.be.undefined;
    });

    it('should skip compaction events when formatting', async () => {
      const events: Event[] = [
        createTestEvent('user', 'Hello', 1000),
        {
          ...createTestEvent('system', 'Old summary', 1500),
          actions: {
            stateDelta: {},
            artifactDelta: {},
            requestedAuthConfigs: {},
            requestedToolConfirmations: {},
            compaction: {
              startTimestamp: 0,
              endTimestamp: 1000,
              compactedContent: {role: 'model', parts: [{text: 'Old summary'}]},
            },
          },
        },
        createTestEvent('user', 'World', 2000),
      ];

      await summarizer.maybeSummarizeEvents(events);

      const promptContent = mockLlm.lastRequest!.contents[0].parts?.[0]?.text;
      expect(promptContent).to.include('user: Hello');
      expect(promptContent).to.include('user: World');
      expect(promptContent).to.not.include('Old summary');
    });

    it('should return undefined for events with only empty text', async () => {
      const events = [
        createTestEvent('user', '', 1000),
        createEvent({
          invocationId: 'test_inv',
          timestamp: 2000,
          author: 'user',
          content: {
            role: 'user',
            parts: [{functionCall: {name: 'test', args: {}}}],
          },
        }),
      ];

      const result = await summarizer.maybeSummarizeEvents(events);

      // Should return undefined since there's no text content to summarize
      expect(result).to.be.undefined;
    });

    it('should set correct author and timestamps on compacted event', async () => {
      const events = [
        createTestEvent('user', 'First', 1000),
        createTestEvent('assistant', 'Second', 5000),
      ];

      const result = await summarizer.maybeSummarizeEvents(events);

      expect(result!.author).to.equal('system');
      expect(result!.actions?.compaction?.startTimestamp).to.equal(1000);
      expect(result!.actions?.compaction?.endTimestamp).to.equal(5000);
    });
  });
});
