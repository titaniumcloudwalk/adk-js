/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BaseTool,
  GLOBAL_SCOPE_KEY,
  REFLECT_AND_RETRY_RESPONSE_TYPE,
  ReflectAndRetryToolPlugin,
  ToolContext,
  TrackingScope,
} from '@google/adk';

/**
 * Mock tool for testing purposes.
 */
class MockTool extends BaseTool {
  constructor(name: string = 'mock_tool') {
    super({name, description: `Mock tool named ${name}`});
  }

  override async runAsync(): Promise<unknown> {
    return 'mock result';
  }
}

/**
 * Custom plugin for testing error extraction from tool responses.
 */
class CustomErrorExtractionPlugin extends ReflectAndRetryToolPlugin {
  private errorCondition?: (result: unknown) => unknown | undefined;

  setErrorCondition(conditionFunc: (result: unknown) => unknown | undefined) {
    this.errorCondition = conditionFunc;
  }

  override async extractErrorFromResult({
    result,
  }: {
    tool: BaseTool;
    toolArgs: Record<string, unknown>;
    toolContext: ToolContext;
    result: unknown;
  }): Promise<unknown | undefined> {
    if (this.errorCondition) {
      return this.errorCondition(result);
    }
    return undefined;
  }
}

/**
 * Creates a mock ToolContext for testing.
 */
function createMockToolContext(
  invocationId: string = 'test-invocation-id',
): ToolContext {
  return {
    invocationId,
    invocationContext: {
      invocationId,
    },
  } as ToolContext;
}

describe('ReflectAndRetryToolPlugin', () => {
  describe('initialization', () => {
    it('should initialize with default parameters', () => {
      const plugin = new ReflectAndRetryToolPlugin();

      expect(plugin.name).toEqual('reflect_retry_tool_plugin');
      expect(plugin.maxRetries).toEqual(3);
      expect(plugin.throwExceptionIfRetryExceeded).toBe(true);
      expect(plugin.trackingScope).toEqual(TrackingScope.INVOCATION);
    });

    it('should initialize with custom parameters', () => {
      const plugin = new ReflectAndRetryToolPlugin({
        name: 'custom_name',
        maxRetries: 10,
        throwExceptionIfRetryExceeded: false,
        trackingScope: TrackingScope.GLOBAL,
      });

      expect(plugin.name).toEqual('custom_name');
      expect(plugin.maxRetries).toEqual(10);
      expect(plugin.throwExceptionIfRetryExceeded).toBe(false);
      expect(plugin.trackingScope).toEqual(TrackingScope.GLOBAL);
    });

    it('should throw error for negative maxRetries', () => {
      expect(() => {
        new ReflectAndRetryToolPlugin({maxRetries: -1});
      }).toThrow('maxRetries must be a non-negative integer.');
    });

    it('should allow maxRetries of 0', () => {
      const plugin = new ReflectAndRetryToolPlugin({maxRetries: 0});
      expect(plugin.maxRetries).toEqual(0);
    });
  });

  describe('afterToolCallback - successful calls', () => {
    it('should return undefined for successful tool call', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();
      const result = {success: true, data: 'test_data'};

      const callbackResult = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {param1: 'value1'},
        toolContext: mockToolContext,
        result,
      });

      expect(callbackResult).toBeUndefined();
    });

    it('should ignore retry responses to prevent infinite loops', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();
      const retryResult = {
        responseType: REFLECT_AND_RETRY_RESPONSE_TYPE,
        errorType: 'Error',
        errorDetails: 'test',
        retryCount: 1,
        reflectionGuidance: 'test guidance',
      };

      const callbackResult = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        result: retryResult,
      });

      expect(callbackResult).toBeUndefined();
    });

    it('should handle undefined result gracefully', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();

      const callbackResult = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        result: undefined as unknown as Record<string, unknown>,
      });

      expect(callbackResult).toBeUndefined();
    });

    it('should handle null result gracefully', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();

      const callbackResult = await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        result: null as unknown as Record<string, unknown>,
      });

      expect(callbackResult).toBeUndefined();
    });
  });

  describe('onToolErrorCallback - error handling', () => {
    it('should return reflection response on first failure', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();
      const error = new Error('Test error message');

      const result = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {param1: 'value1'},
        toolContext: mockToolContext,
        error,
      });

      expect(result).toBeDefined();
      expect(result!.responseType).toEqual(REFLECT_AND_RETRY_RESPONSE_TYPE);
      expect(result!.errorType).toEqual('Error');
      expect(result!.errorDetails).toContain('Test error message');
      expect(result!.retryCount).toEqual(1);
      expect(result!.reflectionGuidance).toContain('test_tool');
      expect(result!.reflectionGuidance).toContain('Test error message');
    });

    it('should throw immediately when maxRetries is 0', async () => {
      const plugin = new ReflectAndRetryToolPlugin({maxRetries: 0});
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();
      const error = new Error('Test error');

      await expect(
        plugin.onToolErrorCallback({
          tool: mockTool,
          toolArgs: {},
          toolContext: mockToolContext,
          error,
        }),
      ).rejects.toThrow('Test error');
    });

    it('should return guidance when maxRetries is 0 and throwExceptionIfRetryExceeded is false', async () => {
      const plugin = new ReflectAndRetryToolPlugin({
        maxRetries: 0,
        throwExceptionIfRetryExceeded: false,
      });
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();
      const error = new Error('Test error');

      const result = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });

      expect(result).toBeDefined();
      expect(result!.responseType).toEqual(REFLECT_AND_RETRY_RESPONSE_TYPE);
      expect(result!.reflectionGuidance).toContain(
        'the retry limit has been exceeded',
      );
    });
  });

  describe('retry count progression', () => {
    it('should increment retry count with consecutive failures', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();
      const error = new Error('Test error');

      // First failure
      const result1 = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });
      expect(result1!.retryCount).toEqual(1);

      // Second failure
      const result2 = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });
      expect(result2!.retryCount).toEqual(2);

      // Third failure
      const result3 = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });
      expect(result3!.retryCount).toEqual(3);
    });

    it('should reset retry count on successful call', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();
      const error = new Error('Test error');

      // First failure
      const result1 = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });
      expect(result1!.retryCount).toEqual(1);

      // Successful call
      await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        result: {success: true},
      });

      // Next failure should restart from 1
      const result2 = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });
      expect(result2!.retryCount).toEqual(1);
    });
  });

  describe('max retries exceeded', () => {
    it('should throw exception when max retries exceeded', async () => {
      const plugin = new ReflectAndRetryToolPlugin({
        maxRetries: 2,
        throwExceptionIfRetryExceeded: true,
      });
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();
      const error = new Error('Test error');

      // First and second calls succeed with retry response
      await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });
      await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });

      // Third call should throw
      await expect(
        plugin.onToolErrorCallback({
          tool: mockTool,
          toolArgs: {},
          toolContext: mockToolContext,
          error,
        }),
      ).rejects.toThrow('Test error');
    });

    it('should return guidance when max retries exceeded and throwExceptionIfRetryExceeded is false', async () => {
      const plugin = new ReflectAndRetryToolPlugin({
        maxRetries: 2,
        throwExceptionIfRetryExceeded: false,
      });
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();
      const error = new Error('Test error');

      // Exhaust retries
      await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });
      await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });

      // Third call should return guidance, not throw
      const result = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });

      expect(result).toBeDefined();
      expect(result!.responseType).toEqual(REFLECT_AND_RETRY_RESPONSE_TYPE);
      expect(result!.reflectionGuidance).toContain(
        'the retry limit has been exceeded',
      );
      expect(result!.reflectionGuidance).toContain(
        'Do not attempt to use the',
      );
    });
  });

  describe('per-tool tracking', () => {
    it('should track failures independently per tool', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockToolContext = createMockToolContext();
      const tool1 = new MockTool('tool1');
      const tool2 = new MockTool('tool2');
      const error = new Error('Test error');

      // Failure on tool1
      const result1 = await plugin.onToolErrorCallback({
        tool: tool1,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });
      expect(result1!.retryCount).toEqual(1);

      // Failure on tool2 should start at 1, not 2
      const result2 = await plugin.onToolErrorCallback({
        tool: tool2,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });
      expect(result2!.retryCount).toEqual(1);

      // tool1 should still be at 2
      const result3 = await plugin.onToolErrorCallback({
        tool: tool1,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });
      expect(result3!.retryCount).toEqual(2);
    });

    it('should reset only the specific tool counter on success', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockToolContext = createMockToolContext();
      const tool1 = new MockTool('tool1');
      const tool2 = new MockTool('tool2');
      const error = new Error('Test error');

      // Failures on both tools
      await plugin.onToolErrorCallback({
        tool: tool1,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });
      await plugin.onToolErrorCallback({
        tool: tool2,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });

      // Success on tool1 only
      await plugin.afterToolCallback({
        tool: tool1,
        toolArgs: {},
        toolContext: mockToolContext,
        result: {success: true},
      });

      // tool1 should restart at 1
      const result1 = await plugin.onToolErrorCallback({
        tool: tool1,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });
      expect(result1!.retryCount).toEqual(1);

      // tool2 should continue at 2
      const result2 = await plugin.onToolErrorCallback({
        tool: tool2,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });
      expect(result2!.retryCount).toEqual(2);
    });
  });

  describe('tracking scope', () => {
    it('should track failures per invocation by default', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const tool = new MockTool('test_tool');
      const error = new Error('Test error');

      const context1 = createMockToolContext('invocation-1');
      const context2 = createMockToolContext('invocation-2');

      // Failure in invocation 1
      const result1 = await plugin.onToolErrorCallback({
        tool,
        toolArgs: {},
        toolContext: context1,
        error,
      });
      expect(result1!.retryCount).toEqual(1);

      // Failure in invocation 2 should start at 1
      const result2 = await plugin.onToolErrorCallback({
        tool,
        toolArgs: {},
        toolContext: context2,
        error,
      });
      expect(result2!.retryCount).toEqual(1);

      // invocation 1 should continue at 2
      const result3 = await plugin.onToolErrorCallback({
        tool,
        toolArgs: {},
        toolContext: context1,
        error,
      });
      expect(result3!.retryCount).toEqual(2);
    });

    it('should track failures globally when scope is GLOBAL', async () => {
      const plugin = new ReflectAndRetryToolPlugin({
        trackingScope: TrackingScope.GLOBAL,
      });
      const tool = new MockTool('test_tool');
      const error = new Error('Test error');

      const context1 = createMockToolContext('invocation-1');
      const context2 = createMockToolContext('invocation-2');

      // Failure across different invocations should accumulate
      const result1 = await plugin.onToolErrorCallback({
        tool,
        toolArgs: {},
        toolContext: context1,
        error,
      });
      expect(result1!.retryCount).toEqual(1);

      const result2 = await plugin.onToolErrorCallback({
        tool,
        toolArgs: {},
        toolContext: context2,
        error,
      });
      expect(result2!.retryCount).toEqual(2);

      const result3 = await plugin.onToolErrorCallback({
        tool,
        toolArgs: {},
        toolContext: context1,
        error,
      });
      expect(result3!.retryCount).toEqual(3);
    });
  });

  describe('custom error extraction', () => {
    it('should call extractErrorFromResult to detect errors in successful responses', async () => {
      const customPlugin = new CustomErrorExtractionPlugin({maxRetries: 3});
      customPlugin.setErrorCondition((result) => {
        if (
          result &&
          typeof result === 'object' &&
          (result as {status?: string}).status === 'error'
        ) {
          return result;
        }
        return undefined;
      });

      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();

      // Error result detected
      const errorResult = {status: 'error', message: 'Something went wrong'};
      const callbackResult = await customPlugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        result: errorResult,
      });

      expect(callbackResult).toBeDefined();
      expect(callbackResult!.responseType).toEqual(
        REFLECT_AND_RETRY_RESPONSE_TYPE,
      );
      expect(callbackResult!.retryCount).toEqual(1);
    });

    it('should handle success after custom error detection', async () => {
      const customPlugin = new CustomErrorExtractionPlugin({maxRetries: 3});
      customPlugin.setErrorCondition((result) => {
        if (
          result &&
          typeof result === 'object' &&
          (result as {failed?: boolean}).failed
        ) {
          return result;
        }
        return undefined;
      });

      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();

      // Error result
      const errorResult = {failed: true, reason: 'Network timeout'};
      const result1 = await customPlugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        result: errorResult,
      });
      expect(result1!.retryCount).toEqual(1);

      // Success should reset
      const successResult = {result: 'success'};
      const result2 = await customPlugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        result: successResult,
      });
      expect(result2).toBeUndefined();

      // Next error should start fresh
      const result3 = await customPlugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        result: errorResult,
      });
      expect(result3!.retryCount).toEqual(1);
    });

    it('should default extractErrorFromResult to return undefined', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();

      const error = await plugin.extractErrorFromResult({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        result: {status: 'success', data: 'some data'},
      });

      expect(error).toBeUndefined();
    });
  });

  describe('reflection response content', () => {
    it('should include tool name in reflection guidance', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockTool = new MockTool('my_special_tool');
      const mockToolContext = createMockToolContext();
      const error = new Error('Test error');

      const result = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });

      expect(result!.reflectionGuidance).toContain('my_special_tool');
    });

    it('should include tool arguments in reflection guidance', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();
      const toolArgs = {param1: 'value1', param2: 42};
      const error = new Error('Test error');

      const result = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs,
        toolContext: mockToolContext,
        error,
      });

      expect(result!.reflectionGuidance).toContain('param1');
      expect(result!.reflectionGuidance).toContain('value1');
      expect(result!.reflectionGuidance).toContain('param2');
      expect(result!.reflectionGuidance).toContain('42');
    });

    it('should include retry count info in reflection guidance', async () => {
      const plugin = new ReflectAndRetryToolPlugin({maxRetries: 5});
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();
      const error = new Error('Test error');

      const result = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });

      expect(result!.reflectionGuidance).toContain('retry attempt');
      expect(result!.reflectionGuidance).toContain('1 of 5');
    });

    it('should include five-point guidance list', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();
      const error = new Error('Test error');

      const result = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });

      expect(result!.reflectionGuidance).toContain('Invalid Parameters');
      expect(result!.reflectionGuidance).toContain('State or Preconditions');
      expect(result!.reflectionGuidance).toContain('Alternative Approach');
      expect(result!.reflectionGuidance).toContain('Simplify the Task');
      expect(result!.reflectionGuidance).toContain('Wrong Function Name');
    });

    it('should handle empty tool args', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();
      const error = new Error('Test error');

      const result = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error,
      });

      expect(result).toBeDefined();
      expect(result!.reflectionGuidance).toContain('{}');
    });
  });

  describe('error types', () => {
    it('should preserve error type name for standard errors', async () => {
      const plugin = new ReflectAndRetryToolPlugin();
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();

      // Test with TypeError
      const typeError = new TypeError('Type mismatch');
      const result1 = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error: typeError,
      });
      expect(result1!.errorType).toEqual('TypeError');

      // Reset for next test
      await plugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        result: {success: true},
      });

      // Test with RangeError
      const rangeError = new RangeError('Out of range');
      const result2 = await plugin.onToolErrorCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        error: rangeError,
      });
      expect(result2!.errorType).toEqual('RangeError');
    });

    it('should use ToolError for non-Error objects', async () => {
      const customPlugin = new CustomErrorExtractionPlugin();
      customPlugin.setErrorCondition((result) => {
        if (
          result &&
          typeof result === 'object' &&
          (result as {error?: boolean}).error
        ) {
          return result;
        }
        return undefined;
      });

      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();

      const result = await customPlugin.afterToolCallback({
        tool: mockTool,
        toolArgs: {},
        toolContext: mockToolContext,
        result: {error: true, message: 'Custom error'},
      });

      expect(result!.errorType).toEqual('ToolError');
    });
  });

  describe('constants', () => {
    it('should export correct response type constant', () => {
      expect(REFLECT_AND_RETRY_RESPONSE_TYPE).toEqual(
        'ERROR_HANDLED_BY_REFLECT_AND_RETRY_PLUGIN',
      );
    });

    it('should export correct global scope key constant', () => {
      expect(GLOBAL_SCOPE_KEY).toEqual('__global_reflect_and_retry_scope__');
    });
  });

  describe('concurrent execution safety', () => {
    it('should handle concurrent tool errors safely', async () => {
      const plugin = new ReflectAndRetryToolPlugin({maxRetries: 10});
      const mockTool = new MockTool('test_tool');
      const mockToolContext = createMockToolContext();
      const error = new Error('Test error');

      // Simulate concurrent calls
      const promises = Array.from({length: 5}, () =>
        plugin.onToolErrorCallback({
          tool: mockTool,
          toolArgs: {},
          toolContext: mockToolContext,
          error,
        }),
      );

      const results = await Promise.all(promises);

      // All results should be defined
      expect(results.every((r) => r !== undefined)).toBe(true);

      // Retry counts should be 1, 2, 3, 4, 5 (in some order)
      const retryCounts = results.map((r) => r!.retryCount).sort();
      expect(retryCounts).toEqual([1, 2, 3, 4, 5]);
    });
  });
});
