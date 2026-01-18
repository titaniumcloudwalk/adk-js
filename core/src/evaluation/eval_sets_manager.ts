/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Abstract interface for managing evaluation sets.
 *
 * EvalSetsManager provides CRUD operations for evaluation sets and cases.
 */

import {type EvalCase} from './eval_case.js';
import {type EvalSet} from './eval_set.js';

/**
 * Abstract manager for evaluation sets.
 *
 * Implementations can store eval sets in memory, local files, GCS, etc.
 */
export abstract class EvalSetsManager {
  /**
   * Gets an eval set by ID.
   *
   * @param appName - The app name context
   * @param evalSetId - The eval set ID to retrieve
   * @returns The eval set, or undefined if not found
   */
  abstract getEvalSet(appName: string, evalSetId: string): Promise<EvalSet | undefined>;

  /**
   * Creates a new eval set.
   *
   * @param appName - The app name context
   * @param evalSetId - The eval set ID to create
   * @param name - Optional human-readable name
   * @param description - Optional description
   * @returns The created eval set
   */
  abstract createEvalSet(
    appName: string,
    evalSetId: string,
    name?: string,
    description?: string
  ): Promise<EvalSet>;

  /**
   * Lists all eval set IDs for an app.
   *
   * @param appName - The app name context
   * @returns Array of eval set IDs
   */
  abstract listEvalSets(appName: string): Promise<string[]>;

  /**
   * Gets a specific eval case from an eval set.
   *
   * @param appName - The app name context
   * @param evalSetId - The eval set ID
   * @param evalCaseId - The eval case ID
   * @returns The eval case, or undefined if not found
   */
  abstract getEvalCase(
    appName: string,
    evalSetId: string,
    evalCaseId: string
  ): Promise<EvalCase | undefined>;

  /**
   * Adds an eval case to an eval set.
   *
   * @param appName - The app name context
   * @param evalSetId - The eval set ID
   * @param evalCase - The eval case to add
   */
  abstract addEvalCase(appName: string, evalSetId: string, evalCase: EvalCase): Promise<void>;

  /**
   * Updates an existing eval case.
   *
   * @param appName - The app name context
   * @param evalSetId - The eval set ID
   * @param updatedEvalCase - The updated eval case
   */
  abstract updateEvalCase(
    appName: string,
    evalSetId: string,
    updatedEvalCase: EvalCase
  ): Promise<void>;

  /**
   * Deletes an eval case from an eval set.
   *
   * @param appName - The app name context
   * @param evalSetId - The eval set ID
   * @param evalCaseId - The eval case ID to delete
   */
  abstract deleteEvalCase(
    appName: string,
    evalSetId: string,
    evalCaseId: string
  ): Promise<void>;

  /**
   * Deletes an entire eval set.
   *
   * @param appName - The app name context
   * @param evalSetId - The eval set ID to delete
   */
  abstract deleteEvalSet(appName: string, evalSetId: string): Promise<void>;
}
