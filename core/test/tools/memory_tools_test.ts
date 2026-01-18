/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Content, FunctionDeclaration, Type} from '@google/genai';
import {beforeEach, describe, expect, it, vi} from 'vitest';

import {InvocationContext} from '../../src/agents/invocation_context.js';
import {EventActions} from '../../src/events/event_actions.js';
import {BaseMemoryService, SearchMemoryRequest, SearchMemoryResponse} from '../../src/memory/base_memory_service.js';
import {MemoryEntry} from '../../src/memory/memory_entry.js';
import {LlmRequest} from '../../src/models/llm_request.js';
import {Session} from '../../src/sessions/session.js';
import {State} from '../../src/sessions/state.js';
import {LoadMemoryTool, LoadMemoryResponse, loadMemoryTool} from '../../src/tools/load_memory_tool.js';
import {extractText} from '../../src/tools/memory_entry_utils.js';
import {PreloadMemoryTool, preloadMemoryTool} from '../../src/tools/preload_memory_tool.js';
import {ToolContext} from '../../src/tools/tool_context.js';

// Mock memory service
class MockMemoryService implements BaseMemoryService {
  private memories: MemoryEntry[] = [];

  setMemories(memories: MemoryEntry[]) {
    this.memories = memories;
  }

  async addSessionToMemory(session: Session): Promise<void> {
    // Not used in these tests
  }

  async searchMemory(request: SearchMemoryRequest): Promise<SearchMemoryResponse> {
    return {memories: this.memories};
  }
}

// Helper to create a mock InvocationContext
function createMockInvocationContext(
    memoryService?: BaseMemoryService,
    userContent?: Content,
): InvocationContext {
  const session: Session = {
    id: 'test-session-id',
    appName: 'test-app',
    userId: 'test-user',
    state: {},
    events: [],
    lastUpdateTime: 0,
  };

  return {
    session,
    sessionService: undefined,
    artifactService: undefined,
    memoryService,
    userContent,
    invocationId: 'test-invocation-id',
    agent: {} as any,
    branch: undefined,
    runConfig: {} as any,
    endInvocation: false,
    live: false,
    pluginManager: undefined,
    credentialService: undefined,
  } as InvocationContext;
}

// Helper to create a ToolContext
function createToolContext(
    memoryService?: BaseMemoryService,
    userContent?: Content,
): ToolContext {
  const invocationContext = createMockInvocationContext(memoryService, userContent);
  const eventActions: EventActions = {
    stateDelta: {},
    artifactDelta: {},
    requestedAuthConfigs: {},
    requestedToolConfirmations: {},
  };
  return new ToolContext({
    invocationContext,
    eventActions,
    functionCallId: 'test-function-call-id',
  });
}

// Helper to create a mock LlmRequest
function createMockLlmRequest(): LlmRequest {
  return {
    contents: [],
    toolsDict: {},
    liveConnectConfig: {},
    config: {},
  };
}

describe('extractText', () => {
  it('should extract text from memory with single text part', () => {
    const memory: MemoryEntry = {
      content: {
        role: 'user',
        parts: [{text: 'Hello world'}],
      },
    };
    expect(extractText(memory)).toBe('Hello world');
  });

  it('should extract and join text from memory with multiple text parts', () => {
    const memory: MemoryEntry = {
      content: {
        role: 'user',
        parts: [{text: 'Hello'}, {text: 'world'}],
      },
    };
    expect(extractText(memory)).toBe('Hello world');
  });

  it('should use custom splitter', () => {
    const memory: MemoryEntry = {
      content: {
        role: 'user',
        parts: [{text: 'Hello'}, {text: 'world'}],
      },
    };
    expect(extractText(memory, ', ')).toBe('Hello, world');
  });

  it('should return empty string for memory without parts', () => {
    const memory: MemoryEntry = {
      content: {
        role: 'user',
        parts: undefined as any,
      },
    };
    expect(extractText(memory)).toBe('');
  });

  it('should filter out non-text parts', () => {
    const memory: MemoryEntry = {
      content: {
        role: 'user',
        parts: [
          {text: 'Hello'},
          {inlineData: {mimeType: 'image/png', data: 'base64data'}} as any,
          {text: 'world'},
        ],
      },
    };
    expect(extractText(memory)).toBe('Hello world');
  });

  it('should return empty string for memory with empty parts array', () => {
    const memory: MemoryEntry = {
      content: {
        role: 'user',
        parts: [],
      },
    };
    expect(extractText(memory)).toBe('');
  });
});

describe('LoadMemoryTool', () => {
  let mockMemoryService: MockMemoryService;
  let toolContext: ToolContext;

  beforeEach(() => {
    mockMemoryService = new MockMemoryService();
    toolContext = createToolContext(mockMemoryService);
  });

  it('should have correct name and description', () => {
    const tool = new LoadMemoryTool();
    expect(tool.name).toBe('load_memory');
    expect(tool.description).toBe('Loads the memory for the current user.');
  });

  it('should provide correct function declaration', () => {
    const tool = new LoadMemoryTool();
    const declaration = tool._getDeclaration();

    expect(declaration).toBeDefined();
    expect(declaration!.name).toBe('load_memory');
    expect(declaration!.parameters).toEqual({
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
        },
      },
      required: ['query'],
    });
  });

  it('should return memories from runAsync', async () => {
    const memories: MemoryEntry[] = [
      {
        content: {role: 'user', parts: [{text: 'Previous conversation'}]},
        author: 'user',
        timestamp: '2024-01-01T00:00:00Z',
      },
    ];
    mockMemoryService.setMemories(memories);

    const tool = new LoadMemoryTool();
    const result = await tool.runAsync({
      args: {query: 'test query'},
      toolContext,
    });

    expect(result).toEqual({memories});
  });

  it('should return empty memories array when no matches', async () => {
    mockMemoryService.setMemories([]);

    const tool = new LoadMemoryTool();
    const result = await tool.runAsync({
      args: {query: 'test query'},
      toolContext,
    });

    expect(result).toEqual({memories: []});
  });

  it('should append memory instructions to LLM request', async () => {
    const tool = new LoadMemoryTool();
    const llmRequest = createMockLlmRequest();

    await tool.processLlmRequest({toolContext, llmRequest});

    expect(llmRequest.config?.systemInstruction).toContain('You have memory');
    expect(llmRequest.config?.systemInstruction).toContain('load_memory function');
  });

  it('should add function declaration to LLM request tools', async () => {
    const tool = new LoadMemoryTool();
    const llmRequest = createMockLlmRequest();

    await tool.processLlmRequest({toolContext, llmRequest});

    expect(llmRequest.toolsDict['load_memory']).toBe(tool);
    expect(llmRequest.config?.tools).toBeDefined();
    expect(llmRequest.config?.tools?.length).toBeGreaterThan(0);
  });

  it('singleton instance should work correctly', () => {
    expect(loadMemoryTool).toBeInstanceOf(LoadMemoryTool);
    expect(loadMemoryTool.name).toBe('load_memory');
  });
});

describe('PreloadMemoryTool', () => {
  let mockMemoryService: MockMemoryService;

  beforeEach(() => {
    mockMemoryService = new MockMemoryService();
  });

  it('should have correct name and description', () => {
    const tool = new PreloadMemoryTool();
    expect(tool.name).toBe('preload_memory');
    expect(tool.description).toBe('preload_memory');
  });

  it('should not provide function declaration', () => {
    const tool = new PreloadMemoryTool();
    expect(tool._getDeclaration()).toBeUndefined();
  });

  it('should throw error when runAsync is called directly', async () => {
    const tool = new PreloadMemoryTool();
    const toolContext = createToolContext(mockMemoryService);

    await expect(
        tool.runAsync({args: {}, toolContext}),
    ).rejects.toThrow('PreloadMemoryTool should not be called directly');
  });

  it('should inject memory context into system instructions', async () => {
    const memories: MemoryEntry[] = [
      {
        content: {role: 'user', parts: [{text: 'I like pizza'}]},
        author: 'user',
        timestamp: '2024-01-01T00:00:00Z',
      },
    ];
    mockMemoryService.setMemories(memories);

    const userContent: Content = {
      role: 'user',
      parts: [{text: 'What food do I like?'}],
    };
    const toolContext = createToolContext(mockMemoryService, userContent);
    const llmRequest = createMockLlmRequest();

    const tool = new PreloadMemoryTool();
    await tool.processLlmRequest({toolContext, llmRequest});

    expect(llmRequest.config?.systemInstruction).toContain('PAST_CONVERSATIONS');
    expect(llmRequest.config?.systemInstruction).toContain('I like pizza');
    expect(llmRequest.config?.systemInstruction).toContain('Time: 2024-01-01T00:00:00Z');
    expect(llmRequest.config?.systemInstruction).toContain('user: I like pizza');
  });

  it('should include author in memory text when available', async () => {
    const memories: MemoryEntry[] = [
      {
        content: {role: 'model', parts: [{text: 'You mentioned you like pasta'}]},
        author: 'assistant',
      },
    ];
    mockMemoryService.setMemories(memories);

    const userContent: Content = {
      role: 'user',
      parts: [{text: 'What food do I like?'}],
    };
    const toolContext = createToolContext(mockMemoryService, userContent);
    const llmRequest = createMockLlmRequest();

    const tool = new PreloadMemoryTool();
    await tool.processLlmRequest({toolContext, llmRequest});

    expect(llmRequest.config?.systemInstruction).toContain('assistant: You mentioned you like pasta');
  });

  it('should not modify request when user content is empty', async () => {
    mockMemoryService.setMemories([
      {content: {role: 'user', parts: [{text: 'Some memory'}]}},
    ]);

    const toolContext = createToolContext(mockMemoryService, undefined);
    const llmRequest = createMockLlmRequest();

    const tool = new PreloadMemoryTool();
    await tool.processLlmRequest({toolContext, llmRequest});

    expect(llmRequest.config?.systemInstruction).toBeUndefined();
  });

  it('should not modify request when user content has no text', async () => {
    mockMemoryService.setMemories([
      {content: {role: 'user', parts: [{text: 'Some memory'}]}},
    ]);

    const userContent: Content = {
      role: 'user',
      parts: [{inlineData: {mimeType: 'image/png', data: 'base64'}} as any],
    };
    const toolContext = createToolContext(mockMemoryService, userContent);
    const llmRequest = createMockLlmRequest();

    const tool = new PreloadMemoryTool();
    await tool.processLlmRequest({toolContext, llmRequest});

    expect(llmRequest.config?.systemInstruction).toBeUndefined();
  });

  it('should not modify request when no memories found', async () => {
    mockMemoryService.setMemories([]);

    const userContent: Content = {
      role: 'user',
      parts: [{text: 'What is my name?'}],
    };
    const toolContext = createToolContext(mockMemoryService, userContent);
    const llmRequest = createMockLlmRequest();

    const tool = new PreloadMemoryTool();
    await tool.processLlmRequest({toolContext, llmRequest});

    expect(llmRequest.config?.systemInstruction).toBeUndefined();
  });

  it('should handle memory search failure gracefully', async () => {
    const failingMemoryService: BaseMemoryService = {
      addSessionToMemory: async () => {},
      searchMemory: async () => {
        throw new Error('Memory service error');
      },
    };

    const userContent: Content = {
      role: 'user',
      parts: [{text: 'Test query'}],
    };
    const toolContext = createToolContext(failingMemoryService, userContent);
    const llmRequest = createMockLlmRequest();

    const tool = new PreloadMemoryTool();
    // Should not throw, just log a warning
    await tool.processLlmRequest({toolContext, llmRequest});

    expect(llmRequest.config?.systemInstruction).toBeUndefined();
  });

  it('should handle multiple memories correctly', async () => {
    const memories: MemoryEntry[] = [
      {
        content: {role: 'user', parts: [{text: 'First memory'}]},
        author: 'user',
        timestamp: '2024-01-01T00:00:00Z',
      },
      {
        content: {role: 'model', parts: [{text: 'Second memory'}]},
        author: 'assistant',
        timestamp: '2024-01-02T00:00:00Z',
      },
    ];
    mockMemoryService.setMemories(memories);

    const userContent: Content = {
      role: 'user',
      parts: [{text: 'Tell me about our previous conversations'}],
    };
    const toolContext = createToolContext(mockMemoryService, userContent);
    const llmRequest = createMockLlmRequest();

    const tool = new PreloadMemoryTool();
    await tool.processLlmRequest({toolContext, llmRequest});

    expect(llmRequest.config?.systemInstruction).toContain('First memory');
    expect(llmRequest.config?.systemInstruction).toContain('Second memory');
    expect(llmRequest.config?.systemInstruction).toContain('2024-01-01');
    expect(llmRequest.config?.systemInstruction).toContain('2024-01-02');
  });

  it('should skip memories without extractable text', async () => {
    const memories: MemoryEntry[] = [
      {
        content: {role: 'user', parts: []},
        author: 'user',
      },
      {
        content: {role: 'model', parts: [{text: 'Valid memory'}]},
        author: 'assistant',
      },
    ];
    mockMemoryService.setMemories(memories);

    const userContent: Content = {
      role: 'user',
      parts: [{text: 'Test query'}],
    };
    const toolContext = createToolContext(mockMemoryService, userContent);
    const llmRequest = createMockLlmRequest();

    const tool = new PreloadMemoryTool();
    await tool.processLlmRequest({toolContext, llmRequest});

    expect(llmRequest.config?.systemInstruction).toContain('Valid memory');
    // Should not contain empty lines for the memory without text
  });

  it('singleton instance should work correctly', () => {
    expect(preloadMemoryTool).toBeInstanceOf(PreloadMemoryTool);
    expect(preloadMemoryTool.name).toBe('preload_memory');
  });
});
