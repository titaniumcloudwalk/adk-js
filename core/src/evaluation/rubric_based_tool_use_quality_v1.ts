/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rubric-based tool use quality evaluator.
 *
 * Evaluates the quality of tool usage using custom rubrics.
 */

import {type Invocation, getTextFromContent, getToolCalls} from './eval_case.js';
import {RubricBasedEvaluator} from './rubric_based_evaluator.js';
import {type RubricsBasedCriterion} from './eval_metrics.js';
import {PREBUILT_METRIC_NAMES, RUBRIC_TYPES} from './constants.js';

/**
 * Evaluates tool use quality using rubrics.
 *
 * Assesses how well the agent uses tools based on provided rubrics,
 * considering factors like appropriateness, correctness, and efficiency.
 */
export class RubricBasedToolUseQualityV1Evaluator extends RubricBasedEvaluator {
  /**
   * Creates a new RubricBasedToolUseQualityV1Evaluator.
   *
   * @param criterion - The rubrics-based criterion configuration
   * @param threshold - Pass/fail threshold (default 0.5)
   */
  constructor(
    criterion: RubricsBasedCriterion,
    threshold: number = 0.5
  ) {
    super(
      PREBUILT_METRIC_NAMES.RUBRIC_BASED_TOOL_USE_QUALITY_V1,
      criterion.rubrics.filter(
        (r) => !r.type || r.type === RUBRIC_TYPES.TOOL_USE_QUALITY
      ),
      criterion.judgeModelOptions,
      threshold
    );
  }

  formatAutoRaterPrompt(
    actualInvocation: Invocation,
    _expectedInvocation?: Invocation
  ): string {
    const userQuery = getTextFromContent(actualInvocation.userContent);
    const actualResponse = getTextFromContent(actualInvocation.finalResponse);
    const toolCalls = getToolCalls(actualInvocation);

    const toolCallsText = toolCalls.length > 0
      ? toolCalls.map((tc, i) =>
          `${i + 1}. ${tc.toolName}(${JSON.stringify(tc.args ?? {})})`
        ).join('\n')
      : '(No tools called)';

    const rubricsSection = this.formatRubricsForPrompt();

    return `You are an expert evaluator assessing the quality of an AI assistant's tool usage.

## Task
Evaluate the Tool Usage Quality based on the provided rubrics.

## User Query
${userQuery}

## Tools Called
${toolCallsText}

## Final Response
${actualResponse || '(No response provided)'}

${rubricsSection}

## Instructions
For each rubric, evaluate how well the agent used tools and provide:

[rubric_id]: Score: [0.0 to 1.0]. Rationale: [Brief explanation]

Consider:
- Were the right tools chosen for the task?
- Were the arguments correct and appropriate?
- Was tool usage efficient (not redundant)?
- Did tool results contribute to a good final response?

After evaluating all rubrics, provide an overall assessment:

Overall: [Summary of tool use quality]

Be specific and objective in your evaluations.`;
  }
}
