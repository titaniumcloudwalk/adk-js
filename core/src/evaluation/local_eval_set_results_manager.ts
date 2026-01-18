/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Local file-based implementation of EvalSetResultsManager.
 *
 * Stores evaluation results as JSON files in a local directory.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {type EvalCaseResult, type EvalSetResult, createEvalSetResult} from './eval_result.js';
import {EvalSetResultsManager} from './eval_set_results_manager.js';

/**
 * Local filesystem implementation of eval set results manager.
 *
 * Directory structure:
 * {baseDir}/{appName}/eval_results/{evalSetResultId}.json
 */
export class LocalEvalSetResultsManager extends EvalSetResultsManager {
  private readonly baseDir: string;

  /**
   * Creates a new LocalEvalSetResultsManager.
   *
   * @param baseDir - Base directory for storing eval results
   */
  constructor(baseDir: string) {
    super();
    this.baseDir = baseDir;
  }

  /**
   * Gets the directory path for an app's eval results.
   */
  private getAppResultsDir(appName: string): string {
    return path.join(this.baseDir, appName, 'eval_results');
  }

  /**
   * Gets the file path for an eval set result.
   */
  private getResultPath(appName: string, evalSetResultId: string): string {
    return path.join(this.getAppResultsDir(appName), `${evalSetResultId}.json`);
  }

  /**
   * Ensures the app's results directory exists.
   */
  private async ensureAppDir(appName: string): Promise<void> {
    await fs.mkdir(this.getAppResultsDir(appName), {recursive: true});
  }

  /**
   * Generates a unique result ID.
   */
  private generateResultId(evalSetId: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${evalSetId}_${timestamp}_${random}`;
  }

  async saveEvalSetResult(
    appName: string,
    evalSetId: string,
    evalCaseResults: EvalCaseResult[]
  ): Promise<string> {
    await this.ensureAppDir(appName);

    const evalSetResultId = this.generateResultId(evalSetId);
    const result = createEvalSetResult(evalSetResultId, evalSetId, evalCaseResults);

    const filePath = this.getResultPath(appName, evalSetResultId);
    await fs.writeFile(filePath, JSON.stringify(result, null, 2));

    return evalSetResultId;
  }

  async getEvalSetResult(
    appName: string,
    evalSetResultId: string
  ): Promise<EvalSetResult | undefined> {
    try {
      const filePath = this.getResultPath(appName, evalSetResultId);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as EvalSetResult;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async listEvalSetResults(appName: string): Promise<string[]> {
    try {
      const dir = this.getAppResultsDir(appName);
      const files = await fs.readdir(dir);
      return files
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace('.json', ''));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  async listEvalSetResultsByEvalSet(appName: string, evalSetId: string): Promise<string[]> {
    const allResults = await this.listEvalSetResults(appName);
    // Filter by eval set ID prefix
    return allResults.filter((id) => id.startsWith(`${evalSetId}_`));
  }

  async deleteEvalSetResult(appName: string, evalSetResultId: string): Promise<void> {
    const filePath = this.getResultPath(appName, evalSetResultId);

    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Eval set result '${evalSetResultId}' not found for app '${appName}'`);
      }
      throw error;
    }
  }
}
