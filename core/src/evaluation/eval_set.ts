/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Evaluation set type definition.
 *
 * An EvalSet is a collection of EvalCases that can be run together
 * for comprehensive agent evaluation.
 */

import {type EvalCase} from './eval_case.js';

/**
 * A collection of evaluation cases.
 *
 * An EvalSet groups related eval cases together for batch evaluation
 * and comparison across different agent versions or configurations.
 */
export interface EvalSet {
  /**
   * Unique identifier for this eval set.
   */
  evalSetId: string;

  /**
   * Optional human-readable name for the eval set.
   */
  name?: string;

  /**
   * Optional description of what this eval set tests.
   */
  description?: string;

  /**
   * The list of evaluation cases in this set.
   */
  evalCases: EvalCase[];

  /**
   * Timestamp when this eval set was created (ms since epoch).
   */
  creationTimestamp: number;
}

/**
 * Creates a new EvalSet instance.
 *
 * @param evalSetId - Unique ID for this eval set
 * @param evalCases - List of eval cases (default empty)
 * @param name - Optional name
 * @param description - Optional description
 * @returns A new EvalSet instance
 */
export function createEvalSet(
  evalSetId: string,
  evalCases: EvalCase[] = [],
  name?: string,
  description?: string
): EvalSet {
  return {
    evalSetId,
    name,
    description,
    evalCases,
    creationTimestamp: Date.now(),
  };
}

/**
 * Adds an eval case to an eval set.
 *
 * @param evalSet - The eval set to modify
 * @param evalCase - The eval case to add
 * @returns A new EvalSet with the case added
 */
export function addEvalCaseToSet(evalSet: EvalSet, evalCase: EvalCase): EvalSet {
  return {
    ...evalSet,
    evalCases: [...evalSet.evalCases, evalCase],
  };
}

/**
 * Removes an eval case from an eval set by ID.
 *
 * @param evalSet - The eval set to modify
 * @param evalCaseId - The ID of the case to remove
 * @returns A new EvalSet with the case removed
 */
export function removeEvalCaseFromSet(evalSet: EvalSet, evalCaseId: string): EvalSet {
  return {
    ...evalSet,
    evalCases: evalSet.evalCases.filter((ec) => ec.evalId !== evalCaseId),
  };
}

/**
 * Finds an eval case by ID within an eval set.
 *
 * @param evalSet - The eval set to search
 * @param evalCaseId - The ID to find
 * @returns The eval case, or undefined if not found
 */
export function findEvalCase(evalSet: EvalSet, evalCaseId: string): EvalCase | undefined {
  return evalSet.evalCases.find((ec) => ec.evalId === evalCaseId);
}

/**
 * Updates an eval case within an eval set.
 *
 * @param evalSet - The eval set to modify
 * @param updatedCase - The updated eval case
 * @returns A new EvalSet with the case updated
 */
export function updateEvalCaseInSet(evalSet: EvalSet, updatedCase: EvalCase): EvalSet {
  return {
    ...evalSet,
    evalCases: evalSet.evalCases.map((ec) =>
      ec.evalId === updatedCase.evalId ? updatedCase : ec
    ),
  };
}

/**
 * Gets the number of eval cases in an eval set.
 *
 * @param evalSet - The eval set to count
 * @returns Number of eval cases
 */
export function getEvalCaseCount(evalSet: EvalSet): number {
  return evalSet.evalCases.length;
}
