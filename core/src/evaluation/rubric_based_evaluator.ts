/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rubric-based evaluator.
 *
 * Base class for evaluators that use rubrics to assess responses.
 */

import {type Invocation, getTextFromContent} from './eval_case.js';
import {LlmAsJudge, type AutoRaterScore, parseScoreFromText} from './llm_as_judge.js';
import {type JudgeModelOptions} from './eval_metrics.js';
import {type Rubric, type RubricScore} from './eval_rubrics.js';

/**
 * Base class for rubric-based evaluation.
 *
 * Uses an LLM to evaluate responses against provided rubrics,
 * returning scores and rationales for each rubric.
 */
export abstract class RubricBasedEvaluator extends LlmAsJudge {
  protected readonly rubrics: Rubric[];

  /**
   * Creates a new RubricBasedEvaluator.
   *
   * @param name - Name of this evaluator
   * @param rubrics - List of rubrics to evaluate against
   * @param judgeModelOptions - Configuration for the judge model
   * @param threshold - Pass/fail threshold
   */
  constructor(
    name: string,
    rubrics: Rubric[],
    judgeModelOptions?: JudgeModelOptions,
    threshold: number = 0.5
  ) {
    super(name, judgeModelOptions, threshold);
    this.rubrics = rubrics;
  }

  /**
   * Formats the rubrics section for the prompt.
   */
  protected formatRubricsForPrompt(): string {
    if (this.rubrics.length === 0) {
      return '';
    }

    const rubricTexts = this.rubrics.map((r, i) => {
      const desc = r.description ? ` (${r.description})` : '';
      return `${i + 1}. [${r.rubricId}]${desc}: ${r.rubricContent.textProperty}`;
    });

    return `
## Evaluation Rubrics

Evaluate the response using the following rubrics. For each rubric, provide a score from 0 to 1 and a brief rationale.

${rubricTexts.join('\n')}
`;
  }

  /**
   * Parses rubric scores from the LLM response.
   *
   * Expected format:
   * [rubric_id]: Score: 0.8. Rationale: The response addresses the key points.
   *
   * @param response - The LLM response text
   * @returns Array of rubric scores
   */
  protected parseRubricScores(response: string): RubricScore[] {
    const scores: RubricScore[] = [];

    for (const rubric of this.rubrics) {
      // Look for the rubric ID in the response
      const rubricPattern = new RegExp(
        `\\[?${rubric.rubricId}\\]?[:\\s]*(Score[:\\s]*)?([0-9]*\\.?[0-9]+)(?:[.\\s]*(Rationale[:\\s]*)?(.+?)(?=\\[|$))?`,
        'is'
      );
      const match = response.match(rubricPattern);

      if (match) {
        const score = parseFloat(match[2]);
        // Normalize to 0-1 if needed
        const normalizedScore = score > 1 ? score / 5 : score;
        const rationale = match[4]?.trim();

        scores.push({
          rubricId: rubric.rubricId,
          score: normalizedScore,
          rationale,
        });
      } else {
        // Try simpler pattern
        const simplePattern = new RegExp(`${rubric.rubricId}[^0-9]*([0-9]*\\.?[0-9]+)`, 'i');
        const simpleMatch = response.match(simplePattern);

        if (simpleMatch) {
          const score = parseFloat(simpleMatch[1]);
          const normalizedScore = score > 1 ? score / 5 : score;

          scores.push({
            rubricId: rubric.rubricId,
            score: normalizedScore,
          });
        }
      }
    }

    return scores;
  }

  convertAutoRaterResponseToScore(response: string): AutoRaterScore {
    const rubricScores = this.parseRubricScores(response);

    // Calculate overall score from rubric scores
    const validScores = rubricScores.filter((s) => s.score !== undefined);
    const overallScore = validScores.length > 0
      ? validScores.reduce((sum, s) => sum + (s.score ?? 0), 0) / validScores.length
      : parseScoreFromText(response) ?? 0;

    // Extract overall rationale if present
    const rationaleMatch = response.match(/overall[:\s]*(.+?)(?=\[|$)/i);
    const rationale = rationaleMatch?.[1]?.trim() ||
      (rubricScores.length > 0
        ? `Evaluated against ${rubricScores.length} rubrics`
        : 'Evaluation completed');

    return {
      score: overallScore,
      rationale,
      rubricScores,
    };
  }
}
