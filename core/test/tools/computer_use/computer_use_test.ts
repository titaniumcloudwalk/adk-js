/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {describe, it, expect, vi, beforeEach} from 'vitest';

import {
  BaseComputer,
  ComputerEnvironment,
  ComputerState,
  ComputerUseTool,
  ComputerUseToolset,
  EXCLUDED_COMPUTER_METHODS,
  type ScrollDirection,
} from '../../../src/tools/computer_use/index.js';
import {ToolContext} from '../../../src/tools/tool_context.js';
import {LlmRequest} from '../../../src/models/llm_request.js';

/**
 * Mock implementation of BaseComputer for testing.
 */
class MockComputer implements BaseComputer {
  initialized = false;
  closed = false;
  lastAction: {method: string; args?: unknown} | undefined;

  private readonly _screenSize: [number, number];
  private readonly _environment: ComputerEnvironment;

  constructor(
    screenSize: [number, number] = [1920, 1080],
    environment: ComputerEnvironment = ComputerEnvironment.ENVIRONMENT_BROWSER,
  ) {
    this._screenSize = screenSize;
    this._environment = environment;
  }

  async screenSize(): Promise<[number, number]> {
    return this._screenSize;
  }

  async openWebBrowser(): Promise<ComputerState> {
    this.lastAction = {method: 'openWebBrowser'};
    return {url: 'https://example.com'};
  }

  async clickAt(x: number, y: number): Promise<ComputerState> {
    this.lastAction = {method: 'clickAt', args: {x, y}};
    return {
      url: 'https://example.com',
      screenshot: new Uint8Array([137, 80, 78, 71]), // PNG header bytes
    };
  }

  async hoverAt(x: number, y: number): Promise<ComputerState> {
    this.lastAction = {method: 'hoverAt', args: {x, y}};
    return {url: 'https://example.com'};
  }

  async typeTextAt(
    x: number,
    y: number,
    text: string,
    pressEnter = true,
    clearBeforeTyping = true,
  ): Promise<ComputerState> {
    this.lastAction = {
      method: 'typeTextAt',
      args: {x, y, text, pressEnter, clearBeforeTyping},
    };
    return {url: 'https://example.com'};
  }

  async scrollDocument(direction: ScrollDirection): Promise<ComputerState> {
    this.lastAction = {method: 'scrollDocument', args: {direction}};
    return {url: 'https://example.com'};
  }

  async scrollAt(
    x: number,
    y: number,
    direction: ScrollDirection,
    magnitude: number,
  ): Promise<ComputerState> {
    this.lastAction = {method: 'scrollAt', args: {x, y, direction, magnitude}};
    return {url: 'https://example.com'};
  }

  async wait(seconds: number): Promise<ComputerState> {
    this.lastAction = {method: 'wait', args: {seconds}};
    return {url: 'https://example.com'};
  }

  async goBack(): Promise<ComputerState> {
    this.lastAction = {method: 'goBack'};
    return {url: 'https://previous.com'};
  }

  async goForward(): Promise<ComputerState> {
    this.lastAction = {method: 'goForward'};
    return {url: 'https://next.com'};
  }

  async search(): Promise<ComputerState> {
    this.lastAction = {method: 'search'};
    return {url: 'https://google.com'};
  }

  async navigate(url: string): Promise<ComputerState> {
    this.lastAction = {method: 'navigate', args: {url}};
    return {url};
  }

  async keyCombination(keys: string[]): Promise<ComputerState> {
    this.lastAction = {method: 'keyCombination', args: {keys}};
    return {url: 'https://example.com'};
  }

  async dragAndDrop(
    x: number,
    y: number,
    destinationX: number,
    destinationY: number,
  ): Promise<ComputerState> {
    this.lastAction = {
      method: 'dragAndDrop',
      args: {x, y, destinationX, destinationY},
    };
    return {url: 'https://example.com'};
  }

  async currentState(): Promise<ComputerState> {
    this.lastAction = {method: 'currentState'};
    return {
      url: 'https://example.com',
      screenshot: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    };
  }

  async environment(): Promise<ComputerEnvironment> {
    return this._environment;
  }

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

/**
 * Create a mock ToolContext for testing.
 */
function createMockToolContext(): ToolContext {
  return {
    invocationId: 'test-invocation',
    actions: {},
    functionCallId: 'test-function-call',
  } as unknown as ToolContext;
}

/**
 * Create an empty LlmRequest for testing.
 */
function createMockLlmRequest(): LlmRequest {
  return {
    contents: [],
    toolsDict: {},
    liveConnectConfig: {},
  };
}

// =============================================================================
// ComputerEnvironment Tests
// =============================================================================

describe('ComputerEnvironment', () => {
  it('should have correct enum values', () => {
    expect(ComputerEnvironment.ENVIRONMENT_UNSPECIFIED).toBe(
      'ENVIRONMENT_UNSPECIFIED',
    );
    expect(ComputerEnvironment.ENVIRONMENT_BROWSER).toBe('ENVIRONMENT_BROWSER');
  });
});

// =============================================================================
// BaseComputer Interface Tests
// =============================================================================

describe('BaseComputer (MockComputer)', () => {
  let computer: MockComputer;

  beforeEach(() => {
    computer = new MockComputer();
  });

  it('should return screen size', async () => {
    const size = await computer.screenSize();
    expect(size).toEqual([1920, 1080]);
  });

  it('should initialize correctly', async () => {
    expect(computer.initialized).toBe(false);
    await computer.initialize?.();
    expect(computer.initialized).toBe(true);
  });

  it('should close correctly', async () => {
    expect(computer.closed).toBe(false);
    await computer.close?.();
    expect(computer.closed).toBe(true);
  });

  it('should return environment', async () => {
    const env = await computer.environment();
    expect(env).toBe(ComputerEnvironment.ENVIRONMENT_BROWSER);
  });

  it('should click at coordinates', async () => {
    const state = await computer.clickAt(100, 200);
    expect(computer.lastAction).toEqual({
      method: 'clickAt',
      args: {x: 100, y: 200},
    });
    expect(state.url).toBe('https://example.com');
  });

  it('should navigate to URL', async () => {
    const state = await computer.navigate('https://test.com');
    expect(computer.lastAction).toEqual({
      method: 'navigate',
      args: {url: 'https://test.com'},
    });
    expect(state.url).toBe('https://test.com');
  });

  it('should type text at coordinates', async () => {
    const state = await computer.typeTextAt(100, 200, 'Hello World');
    expect(computer.lastAction).toEqual({
      method: 'typeTextAt',
      args: {x: 100, y: 200, text: 'Hello World', pressEnter: true, clearBeforeTyping: true},
    });
    expect(state.url).toBe('https://example.com');
  });

  it('should press key combinations', async () => {
    const state = await computer.keyCombination(['ctrl', 'c']);
    expect(computer.lastAction).toEqual({
      method: 'keyCombination',
      args: {keys: ['ctrl', 'c']},
    });
    expect(state.url).toBe('https://example.com');
  });
});

// =============================================================================
// ComputerUseTool Tests
// =============================================================================

describe('ComputerUseTool', () => {
  describe('constructor', () => {
    it('should create tool with valid options', () => {
      const tool = new ComputerUseTool({
        name: 'test_tool',
        description: 'A test tool',
        execute: async () => ({}),
        screenSize: [1920, 1080],
      });

      expect(tool.name).toBe('test_tool');
      expect(tool.description).toBe('A test tool');
      expect(tool.screenSize).toEqual([1920, 1080]);
      expect(tool.virtualScreenSize).toEqual([1000, 1000]);
    });

    it('should use custom virtual screen size', () => {
      const tool = new ComputerUseTool({
        name: 'test_tool',
        description: 'A test tool',
        execute: async () => ({}),
        screenSize: [1920, 1080],
        virtualScreenSize: [500, 500],
      });

      expect(tool.virtualScreenSize).toEqual([500, 500]);
    });

    it('should throw error for invalid screen size', () => {
      expect(
        () =>
          new ComputerUseTool({
            name: 'test_tool',
            description: 'A test tool',
            execute: async () => ({}),
            screenSize: [0, 1080] as [number, number],
          }),
      ).toThrow('screenSize must be a tuple of positive [width, height]');
    });

    it('should throw error for invalid virtual screen size', () => {
      expect(
        () =>
          new ComputerUseTool({
            name: 'test_tool',
            description: 'A test tool',
            execute: async () => ({}),
            screenSize: [1920, 1080],
            virtualScreenSize: [-1, 1000] as [number, number],
          }),
      ).toThrow('virtualScreenSize must be a tuple of positive [width, height]');
    });
  });

  describe('coordinate normalization', () => {
    it('should normalize coordinates from virtual to actual screen', async () => {
      const executeFn = vi.fn().mockResolvedValue({url: 'https://example.com'});

      const tool = new ComputerUseTool({
        name: 'click_at',
        description: 'Click at coordinates',
        execute: executeFn,
        screenSize: [1920, 1080],
        virtualScreenSize: [1000, 1000],
      });

      const toolContext = createMockToolContext();

      await tool.runAsync({
        args: {x: 500, y: 500},
        toolContext,
      });

      // Virtual 500/1000 should normalize to actual 960 (for width 1920)
      // Virtual 500/1000 should normalize to actual 540 (for height 1080)
      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({x: 960, y: 540}),
        toolContext,
      );
    });

    it('should clamp coordinates to screen bounds', async () => {
      const executeFn = vi.fn().mockResolvedValue({url: 'https://example.com'});

      const tool = new ComputerUseTool({
        name: 'click_at',
        description: 'Click at coordinates',
        execute: executeFn,
        screenSize: [1920, 1080],
        virtualScreenSize: [1000, 1000],
      });

      const toolContext = createMockToolContext();

      // Use coordinates beyond virtual screen size
      await tool.runAsync({
        args: {x: 2000, y: 2000},
        toolContext,
      });

      // Should be clamped to max screen bounds (1919, 1079)
      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({x: 1919, y: 1079}),
        toolContext,
      );
    });

    it('should handle negative coordinates by clamping to 0', async () => {
      const executeFn = vi.fn().mockResolvedValue({url: 'https://example.com'});

      const tool = new ComputerUseTool({
        name: 'click_at',
        description: 'Click at coordinates',
        execute: executeFn,
        screenSize: [1920, 1080],
        virtualScreenSize: [1000, 1000],
      });

      const toolContext = createMockToolContext();

      await tool.runAsync({
        args: {x: -100, y: -100},
        toolContext,
      });

      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({x: 0, y: 0}),
        toolContext,
      );
    });

    it('should normalize destination coordinates for drag and drop', async () => {
      const executeFn = vi.fn().mockResolvedValue({url: 'https://example.com'});

      const tool = new ComputerUseTool({
        name: 'drag_and_drop',
        description: 'Drag and drop',
        execute: executeFn,
        screenSize: [1920, 1080],
        virtualScreenSize: [1000, 1000],
      });

      const toolContext = createMockToolContext();

      await tool.runAsync({
        args: {x: 100, y: 100, destination_x: 900, destination_y: 900},
        toolContext,
      });

      // Note: 900/1000 * 1920 = 1728
      expect(executeFn).toHaveBeenCalledWith(
        expect.objectContaining({
          x: 192,
          y: 108,
          destination_x: 1728,
          destination_y: 972,
        }),
        toolContext,
      );
    });
  });

  describe('result processing', () => {
    it('should convert ComputerState to response format', async () => {
      const screenshot = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const executeFn = vi.fn().mockResolvedValue({
        screenshot,
        url: 'https://example.com',
      } as ComputerState);

      const tool = new ComputerUseTool({
        name: 'current_state',
        description: 'Get current state',
        execute: executeFn,
        screenSize: [1920, 1080],
      });

      const toolContext = createMockToolContext();
      const result = await tool.runAsync({args: {}, toolContext});

      expect(result).toEqual({
        image: {
          mimetype: 'image/png',
          data: expect.any(String), // base64 encoded
        },
        url: 'https://example.com',
      });
    });

    it('should handle state without screenshot', async () => {
      const executeFn = vi.fn().mockResolvedValue({
        url: 'https://example.com',
      } as ComputerState);

      const tool = new ComputerUseTool({
        name: 'navigate',
        description: 'Navigate to URL',
        execute: executeFn,
        screenSize: [1920, 1080],
      });

      const toolContext = createMockToolContext();
      const result = await tool.runAsync({
        args: {url: 'https://test.com'},
        toolContext,
      });

      expect(result).toEqual({
        image: undefined,
        url: 'https://example.com',
      });
    });

    it('should pass through non-ComputerState results', async () => {
      const executeFn = vi.fn().mockResolvedValue({
        customField: 'value',
      });

      const tool = new ComputerUseTool({
        name: 'custom_tool',
        description: 'Custom tool',
        execute: executeFn,
        screenSize: [1920, 1080],
      });

      const toolContext = createMockToolContext();
      const result = await tool.runAsync({args: {}, toolContext});

      expect(result).toEqual({customField: 'value'});
    });
  });
});

// =============================================================================
// ComputerUseToolset Tests
// =============================================================================

describe('ComputerUseToolset', () => {
  describe('constructor', () => {
    it('should create toolset with computer', () => {
      const computer = new MockComputer();
      const toolset = new ComputerUseToolset({computer});

      expect(toolset).toBeDefined();
    });

    it('should use custom virtual screen size', () => {
      const computer = new MockComputer();
      const toolset = new ComputerUseToolset({
        computer,
        virtualScreenSize: [500, 500],
      });

      expect(toolset).toBeDefined();
    });
  });

  describe('getTools', () => {
    it('should return all computer tools', async () => {
      const computer = new MockComputer();
      const toolset = new ComputerUseToolset({computer});

      const tools = await toolset.getTools();

      // Should have tools for all public methods (excluding screenSize, environment, close, initialize)
      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('open_web_browser');
      expect(toolNames).toContain('click_at');
      expect(toolNames).toContain('hover_at');
      expect(toolNames).toContain('type_text_at');
      expect(toolNames).toContain('scroll_document');
      expect(toolNames).toContain('scroll_at');
      expect(toolNames).toContain('wait');
      expect(toolNames).toContain('go_back');
      expect(toolNames).toContain('go_forward');
      expect(toolNames).toContain('search');
      expect(toolNames).toContain('navigate');
      expect(toolNames).toContain('key_combination');
      expect(toolNames).toContain('drag_and_drop');
      expect(toolNames).toContain('current_state');

      // Should not include excluded methods
      expect(toolNames).not.toContain('screen_size');
      expect(toolNames).not.toContain('environment');
      expect(toolNames).not.toContain('close');
      expect(toolNames).not.toContain('initialize');
    });

    it('should initialize computer on first getTools call', async () => {
      const computer = new MockComputer();
      const toolset = new ComputerUseToolset({computer});

      expect(computer.initialized).toBe(false);
      await toolset.getTools();
      expect(computer.initialized).toBe(true);
    });

    it('should cache tools after first call', async () => {
      const computer = new MockComputer();
      const toolset = new ComputerUseToolset({computer});

      const tools1 = await toolset.getTools();
      const tools2 = await toolset.getTools();

      expect(tools1).toBe(tools2);
    });

    it('should filter tools when toolFilter is provided', async () => {
      const computer = new MockComputer();
      const toolset = new ComputerUseToolset({
        computer,
        toolFilter: ['click_at', 'navigate'],
      });

      const tools = await toolset.getTools();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toEqual(['click_at', 'navigate']);
    });
  });

  describe('close', () => {
    it('should close computer', async () => {
      const computer = new MockComputer();
      const toolset = new ComputerUseToolset({computer});

      await toolset.getTools(); // Initialize
      expect(computer.closed).toBe(false);

      await toolset.close();
      expect(computer.closed).toBe(true);
    });

    it('should reset tools cache after close', async () => {
      const computer = new MockComputer();
      const toolset = new ComputerUseToolset({computer});

      const tools1 = await toolset.getTools();
      await toolset.close();

      // Reset the mock for re-initialization
      computer.initialized = false;
      computer.closed = false;

      const tools2 = await toolset.getTools();
      expect(tools1).not.toBe(tools2);
    });
  });

  describe('processLlmRequest', () => {
    it('should add tools to LLM request', async () => {
      const computer = new MockComputer();
      const toolset = new ComputerUseToolset({computer});
      const llmRequest = createMockLlmRequest();
      const toolContext = createMockToolContext();

      await toolset.processLlmRequest(toolContext, llmRequest);

      // Should have tools in toolsDict
      expect(Object.keys(llmRequest.toolsDict).length).toBeGreaterThan(0);
      expect(llmRequest.toolsDict['click_at']).toBeDefined();
    });

    it('should add computer use configuration to LLM request', async () => {
      const computer = new MockComputer();
      const toolset = new ComputerUseToolset({computer});
      const llmRequest = createMockLlmRequest();
      const toolContext = createMockToolContext();

      await toolset.processLlmRequest(toolContext, llmRequest);

      // Should have computer use tool in config.tools
      expect(llmRequest.config?.tools).toBeDefined();
      expect(llmRequest.config!.tools!.length).toBeGreaterThan(0);

      const computerUseTool = llmRequest.config!.tools!.find(
        (t) => typeof t === 'object' && 'computerUse' in t,
      );
      expect(computerUseTool).toBeDefined();
    });

    it('should not duplicate computer use configuration', async () => {
      const computer = new MockComputer();
      const toolset = new ComputerUseToolset({computer});
      const llmRequest = createMockLlmRequest();
      const toolContext = createMockToolContext();

      // Call twice
      await toolset.processLlmRequest(toolContext, llmRequest);
      await toolset.processLlmRequest(toolContext, llmRequest);

      // Should only have one computer use configuration
      const computerUseTools = llmRequest.config!.tools!.filter(
        (t) => typeof t === 'object' && 'computerUse' in t,
      );
      expect(computerUseTools.length).toBe(1);
    });
  });

  describe('adaptComputerUseTool', () => {
    it('should adapt a tool with new function', async () => {
      const computer = new MockComputer();
      const toolset = new ComputerUseToolset({computer});
      const llmRequest = createMockLlmRequest();
      const toolContext = createMockToolContext();

      await toolset.processLlmRequest(toolContext, llmRequest);

      // Original wait tool
      expect(llmRequest.toolsDict['wait']).toBeDefined();

      // Adapt the wait tool
      await ComputerUseToolset.adaptComputerUseTool(
        'wait',
        (originalFunc) => {
          async function custom_wait(seconds: number) {
            console.log(`Waiting ${seconds} seconds`);
            return originalFunc(seconds);
          }
          return custom_wait;
        },
        llmRequest,
      );

      // Should have new tool name
      expect(llmRequest.toolsDict['custom_wait']).toBeDefined();
      expect(llmRequest.toolsDict['wait']).toBeUndefined();
    });

    it('should warn for excluded methods', async () => {
      const llmRequest = createMockLlmRequest();
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await ComputerUseToolset.adaptComputerUseTool(
        'screenSize',
        (originalFunc) => originalFunc,
        llmRequest,
      );

      // The method should have been rejected (no change to toolsDict)
      consoleSpy.mockRestore();
    });

    it('should warn for missing tool', async () => {
      const llmRequest = createMockLlmRequest();

      // Try to adapt a non-existent tool
      await ComputerUseToolset.adaptComputerUseTool(
        'non_existent',
        (originalFunc) => originalFunc,
        llmRequest,
      );

      // Should not throw, just warn
    });
  });
});

// =============================================================================
// EXCLUDED_COMPUTER_METHODS Tests
// =============================================================================

describe('EXCLUDED_COMPUTER_METHODS', () => {
  it('should contain screenSize', () => {
    expect(EXCLUDED_COMPUTER_METHODS.has('screenSize')).toBe(true);
  });

  it('should contain environment', () => {
    expect(EXCLUDED_COMPUTER_METHODS.has('environment')).toBe(true);
  });

  it('should contain close', () => {
    expect(EXCLUDED_COMPUTER_METHODS.has('close')).toBe(true);
  });

  it('should contain initialize', () => {
    expect(EXCLUDED_COMPUTER_METHODS.has('initialize')).toBe(true);
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Computer Use Integration', () => {
  it('should execute click action with coordinate normalization', async () => {
    const computer = new MockComputer([1920, 1080]);
    const toolset = new ComputerUseToolset({
      computer,
      virtualScreenSize: [1000, 1000],
    });
    const toolContext = createMockToolContext();

    const tools = await toolset.getTools();
    const clickTool = tools.find((t) => t.name === 'click_at');
    expect(clickTool).toBeDefined();

    // Execute click at virtual coordinates (500, 500)
    await clickTool!.runAsync({
      args: {x: 500, y: 500},
      toolContext,
    });

    // Should have clicked at normalized coordinates (960, 540)
    expect(computer.lastAction).toEqual({
      method: 'clickAt',
      args: {x: 960, y: 540},
    });
  });

  it('should execute full workflow', async () => {
    const computer = new MockComputer();
    const toolset = new ComputerUseToolset({computer});
    const toolContext = createMockToolContext();

    const tools = await toolset.getTools();

    // Open browser
    const openTool = tools.find((t) => t.name === 'open_web_browser');
    await openTool!.runAsync({args: {}, toolContext});
    expect(computer.lastAction?.method).toBe('openWebBrowser');

    // Navigate
    const navTool = tools.find((t) => t.name === 'navigate');
    await navTool!.runAsync({
      args: {url: 'https://test.com'},
      toolContext,
    });
    expect(computer.lastAction?.method).toBe('navigate');

    // Click
    const clickTool = tools.find((t) => t.name === 'click_at');
    await clickTool!.runAsync({args: {x: 100, y: 200}, toolContext});
    expect(computer.lastAction?.method).toBe('clickAt');

    // Close
    await toolset.close();
    expect(computer.closed).toBe(true);
  });
});
