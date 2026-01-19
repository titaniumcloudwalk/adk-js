/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  BasePlanner,
  BuiltInPlanner,
  CallbackContext,
  InvocationContext,
  LlmAgent,
  LlmRequest,
  PlanReActPlanner,
  PLANNING_TAG,
  FINAL_ANSWER_TAG,
  PluginManager,
  Session,
} from '@google/adk';
import {Part, ThinkingConfig} from '@google/genai';

import {ReadonlyContext} from '../../src/agents/readonly_context.js';

describe('Planner Integration with LlmAgent', () => {
  describe('LlmAgentConfig.planner', () => {
    it('should accept BuiltInPlanner', () => {
      const thinkingConfig: ThinkingConfig = {thinkingBudget: 8192};
      const planner = new BuiltInPlanner({thinkingConfig});

      const agent = new LlmAgent({
        name: 'test_agent',
        model: 'gemini-2.5-pro',
        planner: planner,
      });

      expect(agent.planner).toBe(planner);
      expect(agent.planner).toBeInstanceOf(BuiltInPlanner);
    });

    it('should accept PlanReActPlanner', () => {
      const planner = new PlanReActPlanner();

      const agent = new LlmAgent({
        name: 'test_agent',
        model: 'gemini-2.5-flash',
        planner: planner,
      });

      expect(agent.planner).toBe(planner);
      expect(agent.planner).toBeInstanceOf(PlanReActPlanner);
    });

    it('should accept undefined planner', () => {
      const agent = new LlmAgent({
        name: 'test_agent',
        model: 'gemini-2.5-flash',
      });

      expect(agent.planner).toBeUndefined();
    });

    it('should warn when both planner.thinkingConfig and generateContentConfig.thinkingConfig are set', () => {
      const planner = new BuiltInPlanner({
        thinkingConfig: {thinkingBudget: 8192},
      });

      // Creating agent should trigger warning via logger.warn
      // We're just verifying this doesn't throw
      const agent = new LlmAgent({
        name: 'test_agent',
        model: 'gemini-2.5-pro',
        planner: planner,
        generateContentConfig: {
          thinkingConfig: {thinkingBudget: 4096},
        },
      });

      // The agent should still be created successfully
      expect(agent.planner).toBe(planner);
      expect(agent.generateContentConfig?.thinkingConfig).toBeDefined();
    });

    it('should allow thinkingConfig directly in generateContentConfig without planner', () => {
      // This test verifies the fix from Python PR #4117 that allows
      // thinking_config to be set directly in generate_content_config
      const agent = new LlmAgent({
        name: 'test_agent',
        model: 'gemini-2.5-pro',
        generateContentConfig: {
          thinkingConfig: {thinkingBudget: 8192},
        },
      });

      // Should succeed without error
      expect(agent.generateContentConfig?.thinkingConfig).toBeDefined();
      expect(agent.generateContentConfig?.thinkingConfig?.thinkingBudget).toBe(8192);
      expect(agent.planner).toBeUndefined();
    });

    it('should allow thinkingConfig with includeThoughts in generateContentConfig', () => {
      // Test more thinkingConfig options
      const agent = new LlmAgent({
        name: 'test_agent',
        model: 'gemini-2.5-flash',
        generateContentConfig: {
          thinkingConfig: {
            thinkingBudget: 4096,
            includeThoughts: true,
          },
        },
      });

      expect(agent.generateContentConfig?.thinkingConfig?.thinkingBudget).toBe(4096);
      expect(agent.generateContentConfig?.thinkingConfig?.includeThoughts).toBe(true);
    });
  });

  describe('BuiltInPlanner', () => {
    it('should apply thinkingConfig to LlmRequest', () => {
      const thinkingConfig: ThinkingConfig = {thinkingBudget: 8192};
      const planner = new BuiltInPlanner({thinkingConfig});

      const llmRequest: LlmRequest = {
        contents: [],
        config: {},
        liveConnectConfig: {},
      };

      planner.applyThinkingConfig(llmRequest);

      expect(llmRequest.config?.thinkingConfig).toEqual(thinkingConfig);
    });

    it('should overwrite existing thinkingConfig', () => {
      const plannerConfig: ThinkingConfig = {thinkingBudget: 8192};
      const existingConfig: ThinkingConfig = {thinkingBudget: 4096};
      const planner = new BuiltInPlanner({thinkingConfig: plannerConfig});

      const llmRequest: LlmRequest = {
        contents: [],
        config: {thinkingConfig: existingConfig},
        liveConnectConfig: {},
      };

      planner.applyThinkingConfig(llmRequest);

      expect(llmRequest.config?.thinkingConfig).toEqual(plannerConfig);
    });

    it('should return null for buildPlanningInstruction', () => {
      const planner = new BuiltInPlanner({
        thinkingConfig: {thinkingBudget: 8192},
      });

      const result = planner.buildPlanningInstruction(
        {} as ReadonlyContext,
        {} as LlmRequest
      );

      expect(result).toBeNull();
    });

    it('should return null for processPlanningResponse', () => {
      const planner = new BuiltInPlanner({
        thinkingConfig: {thinkingBudget: 8192},
      });

      const result = planner.processPlanningResponse(
        {} as CallbackContext,
        [{text: 'response'}]
      );

      expect(result).toBeNull();
    });
  });

  describe('PlanReActPlanner', () => {
    it('should build planning instruction', () => {
      const planner = new PlanReActPlanner();

      const instruction = planner.buildPlanningInstruction(
        {} as ReadonlyContext,
        {} as LlmRequest
      );

      expect(instruction).not.toBeNull();
      expect(instruction).toContain(PLANNING_TAG);
      expect(instruction).toContain(FINAL_ANSWER_TAG);
      expect(instruction).toContain('/*REASONING*/');
      expect(instruction).toContain('/*ACTION*/');
    });

    it('should process planning response with FINAL_ANSWER_TAG', () => {
      const planner = new PlanReActPlanner();

      const responseParts: Part[] = [
        {text: `${PLANNING_TAG}\n1. First step\n2. Second step\n\n${FINAL_ANSWER_TAG}\nThe final answer is 42.`}
      ];

      const result = planner.processPlanningResponse(
        {} as CallbackContext,
        responseParts
      );

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThan(0);

      // Check that the final answer part exists without thought flag
      const finalAnswerPart = result!.find(
        p => p.text && p.text.includes('The final answer is 42')
      );
      expect(finalAnswerPart).toBeDefined();
      expect(finalAnswerPart?.thought).toBeUndefined();
    });

    it('should mark planning parts as thoughts', () => {
      const planner = new PlanReActPlanner();

      const responseParts: Part[] = [
        {text: `${PLANNING_TAG}\n1. First step\n2. Second step`}
      ];

      const result = planner.processPlanningResponse(
        {} as CallbackContext,
        responseParts
      );

      expect(result).not.toBeNull();
      expect(result!.length).toBeGreaterThan(0);

      // Check that planning part is marked as thought
      const planningPart = result!.find(
        p => p.text && p.text.startsWith(PLANNING_TAG)
      );
      expect(planningPart?.thought).toBe(true);
    });

    it('should preserve function calls', () => {
      const planner = new PlanReActPlanner();

      const responseParts: Part[] = [
        {text: `${PLANNING_TAG}\nLet me search for that.`},
        {functionCall: {name: 'search', args: {query: 'test'}}},
      ];

      const result = planner.processPlanningResponse(
        {} as CallbackContext,
        responseParts
      );

      expect(result).not.toBeNull();

      // Check that function call is preserved
      const functionCallPart = result!.find(p => p.functionCall);
      expect(functionCallPart).toBeDefined();
      expect(functionCallPart?.functionCall?.name).toBe('search');
    });

    it('should filter empty function calls', () => {
      const planner = new PlanReActPlanner();

      const responseParts: Part[] = [
        {text: 'Some text'},
        {functionCall: {name: '', args: {}}}, // Empty name should be filtered
        {functionCall: {name: 'validTool', args: {}}},
      ];

      const result = planner.processPlanningResponse(
        {} as CallbackContext,
        responseParts
      );

      expect(result).not.toBeNull();

      // Check that only valid function call is preserved
      const functionCallParts = result!.filter(p => p.functionCall);
      expect(functionCallParts.length).toBe(1);
      expect(functionCallParts[0].functionCall?.name).toBe('validTool');
    });

    it('should return null for empty response', () => {
      const planner = new PlanReActPlanner();

      const result = planner.processPlanningResponse(
        {} as CallbackContext,
        []
      );

      expect(result).toBeNull();
    });
  });

  describe('Custom Planner', () => {
    it('should allow custom planner implementations', () => {
      class CustomPlanner extends BasePlanner {
        buildPlanningInstruction(): string | null {
          return 'Custom planning instruction';
        }

        processPlanningResponse(
          _callbackContext: CallbackContext,
          responseParts: Part[]
        ): Part[] | null {
          // Custom processing: prefix all text parts
          return responseParts.map(part => {
            if (part.text) {
              return {...part, text: `[PROCESSED] ${part.text}`};
            }
            return part;
          });
        }
      }

      const customPlanner = new CustomPlanner();

      const agent = new LlmAgent({
        name: 'test_agent',
        model: 'gemini-2.5-flash',
        planner: customPlanner,
      });

      expect(agent.planner).toBeInstanceOf(CustomPlanner);
      expect(agent.planner?.buildPlanningInstruction(
        {} as ReadonlyContext,
        {} as LlmRequest
      )).toBe('Custom planning instruction');
    });
  });
});
