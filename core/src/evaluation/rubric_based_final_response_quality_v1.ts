/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rubric-based final response quality evaluator.
 *
 * Evaluates response quality using custom rubrics.
 */

import {type Invocation, getTextFromContent} from './eval_case.js';
import {RubricBasedEvaluator} from './rubric_based_evaluator.js';
import {type RubricsBasedCriterion} from './eval_metrics.js';
import {PREBUILT_METRIC_NAMES, RUBRIC_TYPES} from './constants.js';

/**
 * Evaluates final response quality using rubrics.
 *
 * Assesses responses against provided quality rubrics,
 * returning detailed scores and rationales for each rubric.
 */
export class RubricBasedFinalResponseQualityV1Evaluator extends RubricBasedEvaluator {
  /**
   * Creates a new RubricBasedFinalResponseQualityV1Evaluator.
   *
   * @param criterion - The rubrics-based criterion configuration
   * @param threshold - Pass/fail threshold (default 0.5)
   */
  constructor(
    criterion: RubricsBasedCriterion,
    threshold: number = 0.5
  ) {
    super(
      PREBUILT_METRIC_NAMES.RUBRIC_BASED_FINAL_RESPONSE_QUALITY_V1,
      criterion.rubrics.filter(
        (r) => !r.type || r.type === RUBRIC_TYPES.FINAL_RESPONSE_QUALITY
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

    const rubricsSection = this.formatRubricsForPrompt();

    return `You are an expert evaluator assessing the quality of an AI assistant's response.

## Task
Evaluate the Response Quality based on the provided rubrics.

## User Query
${userQuery}

## Response to Evaluate
${actualResponse || '(No response provided)'}

${rubricsSection}

## Instructions
For each rubric, provide your evaluation in the following format:

[rubric_id]: Score: [0.0 to 1.0]. Rationale: [Brief explanation]

After evaluating all rubrics, provide an overall assessment:

Overall: [Summary of the response quality]

Be specific and objective in your evaluations.`;
  }
}
