/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Abstract interface for managing evaluation results.
 *
 * EvalSetResultsManager provides operations for storing and retrieving
 * evaluation results.
 */

import {type EvalCaseResult, type EvalSetResult} from './eval_result.js';

/**
 * Abstract manager for evaluation results.
 *
 * Implementations can store results in local files, GCS, databases, etc.
 */
export abstract class EvalSetResultsManager {
  /**
   * Saves evaluation results for an eval set.
   *
   * @param appName - The app name context
   * @param evalSetId - The eval set ID that was evaluated
   * @param evalCaseResults - Results for each eval case
   * @returns The created eval set result ID
   */
  abstract saveEvalSetResult(
    appName: string,
    evalSetId: string,
    evalCaseResults: EvalCaseResult[]
  ): Promise<string>;

  /**
   * Gets an eval set result by ID.
   *
   * @param appName - The app name context
   * @param evalSetResultId - The eval set result ID
   * @returns The eval set result, or undefined if not found
   */
  abstract getEvalSetResult(
    appName: string,
    evalSetResultId: string
  ): Promise<EvalSetResult | undefined>;

  /**
   * Lists all eval set result IDs for an app.
   *
   * @param appName - The app name context
   * @returns Array of eval set result IDs
   */
  abstract listEvalSetResults(appName: string): Promise<string[]>;

  /**
   * Lists eval set results for a specific eval set.
   *
   * @param appName - The app name context
   * @param evalSetId - The eval set ID
   * @returns Array of eval set result IDs for this eval set
   */
  abstract listEvalSetResultsByEvalSet(appName: string, evalSetId: string): Promise<string[]>;

  /**
   * Deletes an eval set result.
   *
   * @param appName - The app name context
   * @param evalSetResultId - The eval set result ID to delete
   */
  abstract deleteEvalSetResult(appName: string, evalSetResultId: string): Promise<void>;
}
