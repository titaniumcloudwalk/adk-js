/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Final response match evaluator using LLM-as-judge.
 *
 * Evaluates semantic similarity between actual and expected responses
 * using an LLM judge for more nuanced comparison than ROUGE scores.
 */

import {type Invocation, getTextFromContent} from './eval_case.js';
import {LlmAsJudge, type AutoRaterScore, parseScoreFromText} from './llm_as_judge.js';
import {type LlmAsAJudgeCriterion} from './eval_metrics.js';
import {PREBUILT_METRIC_NAMES} from './constants.js';

/**
 * LLM-based evaluator for semantic response matching.
 *
 * Uses an LLM to judge whether the actual response adequately
 * matches the expected response in meaning and content.
 */
export class FinalResponseMatchV2Evaluator extends LlmAsJudge {
  /**
   * Creates a new FinalResponseMatchV2Evaluator.
   *
   * @param criterion - The LLM-as-judge criterion configuration
   * @param threshold - Pass/fail threshold (default 0.5)
   */
  constructor(
    criterion?: LlmAsAJudgeCriterion,
    threshold: number = 0.5
  ) {
    super(
      PREBUILT_METRIC_NAMES.FINAL_RESPONSE_MATCH_V2,
      criterion?.judgeModelOptions,
      threshold
    );
  }

  formatAutoRaterPrompt(
    actualInvocation: Invocation,
    expectedInvocation?: Invocation
  ): string {
    const userQuery = getTextFromContent(actualInvocation.userContent);
    const actualResponse = getTextFromContent(actualInvocation.finalResponse);
    const expectedResponse = expectedInvocation
      ? getTextFromContent(expectedInvocation.finalResponse)
      : '';

    return `You are an expert evaluator comparing AI assistant responses.

## Task
Evaluate how well the Actual Response matches the Expected Response in terms of:
1. Content accuracy - Does it convey the same information?
2. Semantic similarity - Does it mean the same thing?
3. Completeness - Does it cover all the key points?
4. Relevance - Is it appropriately responding to the user's query?

## User Query
${userQuery}

## Expected Response
${expectedResponse || '(No expected response provided)'}

## Actual Response
${actualResponse || '(No response provided)'}

## Instructions
Provide your evaluation in the following format:

Score: [0.0 to 1.0]
Rationale: [Brief explanation of your scoring]

Where:
- 1.0 = Perfect match - responses are semantically equivalent
- 0.8-0.9 = Very good match - minor differences that don't affect meaning
- 0.6-0.7 = Acceptable match - captures main points with some differences
- 0.4-0.5 = Partial match - some overlap but significant differences
- 0.0-0.3 = Poor match - responses convey different information

Focus on semantic meaning rather than exact wording.`;
  }

  convertAutoRaterResponseToScore(response: string): AutoRaterScore {
    const score = parseScoreFromText(response) ?? 0;

    // Extract rationale
    const rationaleMatch = response.match(/rationale[:\s]*(.+)/i);
    const rationale = rationaleMatch?.[1]?.trim() || 'Score extracted from response';

    return {
      score,
      rationale,
    };
  }
}
