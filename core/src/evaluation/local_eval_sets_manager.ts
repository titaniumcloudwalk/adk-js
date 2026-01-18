/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Local file-based implementation of EvalSetsManager.
 *
 * Stores eval sets as JSON files in a local directory.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {type EvalCase} from './eval_case.js';
import {type EvalSet, createEvalSet} from './eval_set.js';
import {EvalSetsManager} from './eval_sets_manager.js';

/**
 * Local filesystem implementation of eval sets manager.
 *
 * Directory structure:
 * {baseDir}/{appName}/eval_sets/{evalSetId}.json
 */
export class LocalEvalSetsManager extends EvalSetsManager {
  private readonly baseDir: string;

  /**
   * Creates a new LocalEvalSetsManager.
   *
   * @param baseDir - Base directory for storing eval sets
   */
  constructor(baseDir: string) {
    super();
    this.baseDir = baseDir;
  }

  /**
   * Gets the directory path for an app's eval sets.
   */
  private getAppEvalSetsDir(appName: string): string {
    return path.join(this.baseDir, appName, 'eval_sets');
  }

  /**
   * Gets the file path for an eval set.
   */
  private getEvalSetPath(appName: string, evalSetId: string): string {
    return path.join(this.getAppEvalSetsDir(appName), `${evalSetId}.json`);
  }

  /**
   * Ensures the app's eval sets directory exists.
   */
  private async ensureAppDir(appName: string): Promise<void> {
    await fs.mkdir(this.getAppEvalSetsDir(appName), {recursive: true});
  }

  async getEvalSet(appName: string, evalSetId: string): Promise<EvalSet | undefined> {
    try {
      const filePath = this.getEvalSetPath(appName, evalSetId);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as EvalSet;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return undefined;
      }
      throw error;
    }
  }

  async createEvalSet(
    appName: string,
    evalSetId: string,
    name?: string,
    description?: string
  ): Promise<EvalSet> {
    await this.ensureAppDir(appName);
    const filePath = this.getEvalSetPath(appName, evalSetId);

    // Check if exists
    try {
      await fs.access(filePath);
      throw new Error(`Eval set '${evalSetId}' already exists for app '${appName}'`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }

    const evalSet = createEvalSet(evalSetId, [], name, description);
    await fs.writeFile(filePath, JSON.stringify(evalSet, null, 2));
    return evalSet;
  }

  async listEvalSets(appName: string): Promise<string[]> {
    try {
      const dir = this.getAppEvalSetsDir(appName);
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
    const evalSet = await this.getEvalSet(appName, evalSetId);

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
    const filePath = this.getEvalSetPath(appName, evalSetId);
    await fs.writeFile(filePath, JSON.stringify(evalSet, null, 2));
  }

  async updateEvalCase(
    appName: string,
    evalSetId: string,
    updatedEvalCase: EvalCase
  ): Promise<void> {
    const evalSet = await this.getEvalSet(appName, evalSetId);

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
    const filePath = this.getEvalSetPath(appName, evalSetId);
    await fs.writeFile(filePath, JSON.stringify(evalSet, null, 2));
  }

  async deleteEvalCase(appName: string, evalSetId: string, evalCaseId: string): Promise<void> {
    const evalSet = await this.getEvalSet(appName, evalSetId);

    if (!evalSet) {
      throw new Error(`Eval set '${evalSetId}' not found for app '${appName}'`);
    }

    const index = evalSet.evalCases.findIndex((ec) => ec.evalId === evalCaseId);
    if (index === -1) {
      throw new Error(`Eval case '${evalCaseId}' not found in eval set '${evalSetId}'`);
    }

    evalSet.evalCases.splice(index, 1);
    const filePath = this.getEvalSetPath(appName, evalSetId);
    await fs.writeFile(filePath, JSON.stringify(evalSet, null, 2));
  }

  async deleteEvalSet(appName: string, evalSetId: string): Promise<void> {
    const filePath = this.getEvalSetPath(appName, evalSetId);

    try {
      await fs.unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Eval set '${evalSetId}' not found for app '${appName}'`);
      }
      throw error;
    }
  }
}
