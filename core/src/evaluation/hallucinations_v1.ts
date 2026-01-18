/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hallucination detection evaluator.
 *
 * Evaluates whether responses contain hallucinated (fabricated) information.
 */

import {type Invocation, getTextFromContent, getToolCalls} from './eval_case.js';
import {LlmAsJudge, type AutoRaterScore, parseScoreFromText} from './llm_as_judge.js';
import {type HallucinationsCriterion} from './eval_metrics.js';
import {PREBUILT_METRIC_NAMES} from './constants.js';

/**
 * Evaluator for detecting hallucinations in responses.
 *
 * Assesses whether the agent's response contains information
 * that is fabricated or not grounded in the available context.
 */
export class HallucinationsV1Evaluator extends LlmAsJudge {
  private readonly sentenceSegmentation: boolean;

  /**
   * Creates a new HallucinationsV1Evaluator.
   *
   * @param criterion - The hallucinations criterion configuration
   * @param threshold - Pass/fail threshold (default 0.5, higher is better - less hallucination)
   */
  constructor(
    criterion?: HallucinationsCriterion,
    threshold: number = 0.5
  ) {
    super(
      PREBUILT_METRIC_NAMES.HALLUCINATIONS_V1,
      criterion?.judgeModelOptions,
      threshold
    );
    this.sentenceSegmentation = criterion?.sentenceSegmentation ?? true;
  }

  formatAutoRaterPrompt(
    actualInvocation: Invocation,
    _expectedInvocation?: Invocation
  ): string {
    const userQuery = getTextFromContent(actualInvocation.userContent);
    const actualResponse = getTextFromContent(actualInvocation.finalResponse);
    const toolCalls = getToolCalls(actualInvocation);

    // Build context from tool responses
    const toolResponses = actualInvocation.intermediateData?.toolResponses ?? [];
    const contextText = toolResponses.length > 0
      ? toolResponses.map((tr, i) =>
          `[${tr.toolName}]: ${JSON.stringify(tr.response)}`
        ).join('\n')
      : '(No tool context available)';

    const segmentationInstruction = this.sentenceSegmentation
      ? `Analyze the response sentence by sentence to identify hallucinations.`
      : `Analyze the response as a whole to identify hallucinations.`;

    return `You are an expert evaluator detecting hallucinations in AI responses.

## Task
Evaluate whether the Response contains hallucinated (fabricated) information that is NOT supported by the Context.

## Definition of Hallucination
A hallucination is information that:
1. Is not present in the provided context
2. Cannot be reasonably inferred from the context
3. Makes claims about specific facts, numbers, or details not in the context

## User Query
${userQuery}

## Available Context (from tools)
${contextText}

## Response to Evaluate
${actualResponse || '(No response provided)'}

## Instructions
${segmentationInstruction}

For each claim in the response, determine if it is:
- GROUNDED: Supported by the context
- INFERRED: Reasonably inferred from the context
- HALLUCINATED: Not supported by the context

Provide your evaluation in the following format:

Score: [0.0 to 1.0] (where 1.0 = no hallucinations, 0.0 = entirely hallucinated)
Rationale: [Explanation of what is grounded vs hallucinated]

${this.sentenceSegmentation ? `
Sentence Analysis:
- [Sentence 1]: [GROUNDED/INFERRED/HALLUCINATED] - [reason]
- [Sentence 2]: [GROUNDED/INFERRED/HALLUCINATED] - [reason]
...
` : ''}

Be strict in your evaluation - generic knowledge claims without specific context support should be flagged.`;
  }

  convertAutoRaterResponseToScore(response: string): AutoRaterScore {
    const score = parseScoreFromText(response) ?? 0;

    // Extract rationale
    const rationaleMatch = response.match(/rationale[:\s]*(.+?)(?=sentence analysis|$)/is);
    const rationale = rationaleMatch?.[1]?.trim() || 'Hallucination check completed';

    return {
      score,
      rationale,
    };
  }
}
