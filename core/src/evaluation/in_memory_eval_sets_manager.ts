/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * In-memory implementation of EvalSetsManager.
 *
 * Stores eval sets in memory - useful for testing and ephemeral use cases.
 */

import {type EvalCase} from './eval_case.js';
import {type EvalSet, createEvalSet} from './eval_set.js';
import {EvalSetsManager} from './eval_sets_manager.js';

/**
 * In-memory implementation of eval sets manager.
 *
 * Data is lost when the process exits.
 */
export class InMemoryEvalSetsManager extends EvalSetsManager {
  /**
   * Storage: Map<appName, Map<evalSetId, EvalSet>>
   */
  private readonly storage: Map<string, Map<string, EvalSet>> = new Map();

  /**
   * Gets the storage map for an app, creating it if needed.
   */
  private getAppStorage(appName: string): Map<string, EvalSet> {
    let appStorage = this.storage.get(appName);
    if (!appStorage) {
      appStorage = new Map();
      this.storage.set(appName, appStorage);
    }
    return appStorage;
  }

  async getEvalSet(appName: string, evalSetId: string): Promise<EvalSet | undefined> {
    const appStorage = this.getAppStorage(appName);
    return appStorage.get(evalSetId);
  }

  async createEvalSet(
    appName: string,
    evalSetId: string,
    name?: string,
    description?: string
  ): Promise<EvalSet> {
    const appStorage = this.getAppStorage(appName);

    if (appStorage.has(evalSetId)) {
      throw new Error(`Eval set '${evalSetId}' already exists for app '${appName}'`);
    }

    const evalSet = createEvalSet(evalSetId, [], name, description);
    appStorage.set(evalSetId, evalSet);
    return evalSet;
  }

  async listEvalSets(appName: string): Promise<string[]> {
    const appStorage = this.getAppStorage(appName);
    return Array.from(appStorage.keys());
  }

  async getEvalCase(
    appName: string,
    evalSetId: string,
    evalCaseId: string
  ): Promise<EvalCase | undefined> {
    const evalSet = await this.getEvalSet(appName, evalSetId);
    if (!evalSet) {
      return undefined;
    }
    return evalSet.evalCases.find((ec) => ec.evalId === evalCaseId);
  }

  async addEvalCase(appName: string, evalSetId: string, evalCase: EvalCase): Promise<void> {
    const appStorage = this.getAppStorage(appName);
    const evalSet = appStorage.get(evalSetId);

    if (!evalSet) {
      throw new Error(`Eval set '${evalSetId}' not found for app '${appName}'`);
    }

    // Check for duplicate
    if (evalSet.evalCases.some((ec) => ec.evalId === evalCase.evalId)) {
      throw new Error(
        `Eval case '${evalCase.evalId}' already exists in eval set '${evalSetId}'`
      );
    }

    evalSet.evalCases.push(evalCase);
  }

  async updateEvalCase(
    appName: string,
    evalSetId: string,
    updatedEvalCase: EvalCase
  ): Promise<void> {
    const appStorage = this.getAppStorage(appName);
    const evalSet = appStorage.get(evalSetId);

    if (!evalSet) {
      throw new Error(`Eval set '${evalSetId}' not found for app '${appName}'`);
    }

    const index = evalSet.evalCases.findIndex((ec) => ec.evalId === updatedEvalCase.evalId);
    if (index === -1) {
      throw new Error(
        `Eval case '${updatedEvalCase.evalId}' not found in eval set '${evalSetId}'`
      );
    }

    evalSet.evalCases[index] = updatedEvalCase;
  }

  async deleteEvalCase(appName: string, evalSetId: string, evalCaseId: string): Promise<void> {
    const appStorage = this.getAppStorage(appName);
    const evalSet = appStorage.get(evalSetId);

    if (!evalSet) {
      throw new Error(`Eval set '${evalSetId}' not found for app '${appName}'`);
    }

    const index = evalSet.evalCases.findIndex((ec) => ec.evalId === evalCaseId);
    if (index === -1) {
      throw new Error(`Eval case '${evalCaseId}' not found in eval set '${evalSetId}'`);
    }

    evalSet.evalCases.splice(index, 1);
  }

  async deleteEvalSet(appName: string, evalSetId: string): Promise<void> {
    const appStorage = this.getAppStorage(appName);

    if (!appStorage.has(evalSetId)) {
      throw new Error(`Eval set '${evalSetId}' not found for app '${appName}'`);
    }

    appStorage.delete(evalSetId);
  }

  /**
   * Clears all data for testing purposes.
   */
  clear(): void {
    this.storage.clear();
  }

  /**
   * Gets the total number of eval sets across all apps.
   */
  getTotalEvalSets(): number {
    let total = 0;
    for (const appStorage of this.storage.values()) {
      total += appStorage.size;
    }
    return total;
  }
}
