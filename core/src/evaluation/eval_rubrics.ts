/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Rubric types for evaluation.
 *
 * Rubrics define evaluation criteria and scoring guidelines
 * for LLM-based evaluators.
 */

/**
 * Content of a rubric - the actual evaluation criteria text.
 */
export interface RubricContent {
  /**
   * The text property containing the rubric criteria.
   */
  textProperty: string;
}

/**
 * A rubric defines evaluation criteria for a specific aspect of agent behavior.
 *
 * Rubrics are used by rubric-based evaluators to assess agent responses
 * against defined criteria.
 */
export interface Rubric {
  /**
   * Unique identifier for this rubric.
   */
  rubricId: string;

  /**
   * The content defining the evaluation criteria.
   */
  rubricContent: RubricContent;

  /**
   * Optional description of what this rubric measures.
   */
  description?: string;

  /**
   * Optional type designator (e.g., "TOOL_USE_QUALITY", "FINAL_RESPONSE_QUALITY").
   */
  type?: string;
}

/**
 * Score result for a single rubric evaluation.
 *
 * Contains the numeric score and rationale explaining the scoring decision.
 */
export interface RubricScore {
  /**
   * The ID of the rubric that was evaluated.
   */
  rubricId: string;

  /**
   * The numeric score assigned (typically 0-1 or 1-5 scale).
   */
  score?: number;

  /**
   * Explanation of why this score was assigned.
   */
  rationale?: string;
}

/**
 * Creates a new Rubric instance.
 *
 * @param rubricId - Unique identifier for the rubric
 * @param textProperty - The evaluation criteria text
 * @param description - Optional description
 * @param type - Optional type designator
 * @returns A new Rubric instance
 */
export function createRubric(
  rubricId: string,
  textProperty: string,
  description?: string,
  type?: string
): Rubric {
  return {
    rubricId,
    rubricContent: {textProperty},
    description,
    type,
  };
}

/**
 * Creates a new RubricScore instance.
 *
 * @param rubricId - The ID of the rubric that was evaluated
 * @param score - The numeric score
 * @param rationale - Explanation of the scoring
 * @returns A new RubricScore instance
 */
export function createRubricScore(
  rubricId: string,
  score?: number,
  rationale?: string
): RubricScore {
  return {
    rubricId,
    score,
    rationale,
  };
}

/**
 * Utility to aggregate multiple rubric scores into an average.
 *
 * @param scores - Array of RubricScore instances
 * @returns Average score, or undefined if no valid scores
 */
export function aggregateRubricScores(scores: RubricScore[]): number | undefined {
  const validScores = scores.filter((s) => s.score !== undefined);
  if (validScores.length === 0) {
    return undefined;
  }
  const sum = validScores.reduce((acc, s) => acc + (s.score ?? 0), 0);
  return sum / validScores.length;
}
