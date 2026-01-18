/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {Part} from '@google/genai';

import {CallbackContext} from '../agents/callback_context.js';
import {ReadonlyContext} from '../agents/readonly_context.js';
import {LlmRequest} from '../models/llm_request.js';

import {BasePlanner} from './base_planner.js';

/** Tag marking the planning section in LLM responses */
export const PLANNING_TAG = '/*PLANNING*/';
/** Tag marking the replanning section when revising plans */
export const REPLANNING_TAG = '/*REPLANNING*/';
/** Tag marking reasoning sections between actions */
export const REASONING_TAG = '/*REASONING*/';
/** Tag marking action/tool execution sections */
export const ACTION_TAG = '/*ACTION*/';
/** Tag marking the final answer section */
export const FINAL_ANSWER_TAG = '/*FINAL_ANSWER*/';

/**
 * Plan-Re-Act planner that constrains the LLM response to generate a plan
 * before any action/observation.
 *
 * This planner implements a structured reasoning pattern that guides the model
 * to:
 * 1. First create a plan using available tools
 * 2. Execute the plan with interleaved reasoning and actions
 * 3. Revise the plan if needed based on execution results
 * 4. Provide a final answer
 *
 * The planner uses special tags (PLANNING, REASONING, ACTION, FINAL_ANSWER) to
 * structure the model's output and automatically marks reasoning parts as
 * "thoughts" which can be filtered or displayed differently.
 *
 * Note: This planner does not require the model to support built-in thinking
 * features or setting the thinking config. It works with any model.
 *
 * @example
 * ```typescript
 * const planner = new PlanReActPlanner();
 * const agent = new LlmAgent({
 *   model: new GoogleLLM({model: 'gemini-2.5-flash'}),
 *   instruction: 'You are a helpful assistant',
 *   planner: planner,
 *   tools: [weatherTool, searchTool],
 * });
 *
 * // The model will structure its response like:
 * // /*PLANNING* /
 * // 1. Check the weather using weather tool
 * // 2. Search for related news
 * // 3. Summarize findings
 * //
 * // /*ACTION* /
 * // [calls weather tool]
 * //
 * // /*REASONING* /
 * // The weather is sunny, now I need to search for news...
 * //
 * // /*FINAL_ANSWER* /
 * // Based on the weather and news...
 * ```
 */
export class PlanReActPlanner extends BasePlanner {
  /**
   * Builds the NL planner instruction for the Plan-Re-Act planner.
   *
   * This generates comprehensive instructions that guide the model to:
   * - Create a coherent plan before executing actions
   * - Use structured tags to organize its response
   * - Interleave reasoning with tool calls
   * - Revise plans when initial execution fails
   * - Provide a clear final answer
   *
   * @returns The planning system instruction
   */
  buildPlanningInstruction(
    _readonlyContext: ReadonlyContext,
    _llmRequest: LlmRequest
  ): string {
    return this.buildNlPlannerInstruction();
  }

  /**
   * Processes the LLM response for planning.
   *
   * This method:
   * - Identifies and preserves function calls
   * - Splits text into reasoning and final answer parts using tags
   * - Marks planning/reasoning parts as "thoughts" (not displayed to user)
   * - Filters out empty or invalid function calls
   *
   * @param _callbackContext - The callback context (unused)
   * @param responseParts - The LLM response parts to process
   * @returns The processed response parts, or null if no processing needed
   */
  processPlanningResponse(
    _callbackContext: CallbackContext,
    responseParts: Part[]
  ): Part[] | null {
    if (!responseParts || responseParts.length === 0) {
      return null;
    }

    const preservedParts: Part[] = [];
    let firstFcPartIndex = -1;

    // Process parts until we hit the first function call
    for (let i = 0; i < responseParts.length; i++) {
      const part = responseParts[i];

      // Stop at the first (group of) function calls
      if (part.functionCall) {
        // Ignore and filter out function calls with empty names
        if (!part.functionCall.name) {
          continue;
        }
        preservedParts.push(part);
        firstFcPartIndex = i;
        break;
      }

      // Split the response into reasoning and final answer parts
      this.handleNonFunctionCallParts(part, preservedParts);
    }

    // If we found function calls, collect any remaining function calls that
    // immediately follow
    if (firstFcPartIndex > 0) {
      let j = firstFcPartIndex + 1;
      while (j < responseParts.length) {
        if (responseParts[j].functionCall) {
          preservedParts.push(responseParts[j]);
          j++;
        } else {
          break;
        }
      }
    }

    return preservedParts;
  }

  /**
   * Splits text by the last occurrence of a separator.
   *
   * @param text - The text to split
   * @param separator - The separator to split on
   * @returns A tuple [before, after] containing the text before and after the
   *   last separator
   */
  private splitByLastPattern(text: string, separator: string): [string, string] {
    const index = text.lastIndexOf(separator);
    if (index === -1) {
      return [text, ''];
    }
    return [
      text.substring(0, index + separator.length),
      text.substring(index + separator.length)
    ];
  }

  /**
   * Handles non-function-call parts of the response.
   *
   * This method:
   * - Splits parts containing FINAL_ANSWER_TAG into reasoning and answer
   * - Marks planning/reasoning/action parts as thoughts
   * - Preserves the processed parts in the output list
   *
   * @param responsePart - The response part to handle
   * @param preservedParts - The mutable list to store processed parts
   */
  private handleNonFunctionCallParts(
    responsePart: Part,
    preservedParts: Part[]
  ): void {
    if (responsePart.text && responsePart.text.includes(FINAL_ANSWER_TAG)) {
      // Split at the last FINAL_ANSWER_TAG
      const [reasoningText, finalAnswerText] = this.splitByLastPattern(
        responsePart.text,
        FINAL_ANSWER_TAG
      );

      if (reasoningText) {
        const reasoningPart: Part = {text: reasoningText};
        this.markAsThought(reasoningPart);
        preservedParts.push(reasoningPart);
      }

      if (finalAnswerText) {
        preservedParts.push({text: finalAnswerText});
      }
    } else {
      const responseText = responsePart.text || '';
      // If the part is a text part with a planning/reasoning/action tag,
      // label it as reasoning
      if (
        responseText &&
        (responseText.startsWith(PLANNING_TAG) ||
          responseText.startsWith(REASONING_TAG) ||
          responseText.startsWith(ACTION_TAG) ||
          responseText.startsWith(REPLANNING_TAG))
      ) {
        this.markAsThought(responsePart);
      }
      preservedParts.push(responsePart);
    }
  }

  /**
   * Marks the response part as a thought.
   *
   * Thoughts are internal reasoning steps that may be hidden from the user
   * or displayed differently. This sets the `thought` flag on text parts.
   *
   * @param responsePart - The mutable response part to mark as thought
   */
  private markAsThought(responsePart: Part): void {
    if (responsePart.text) {
      responsePart.thought = true;
    }
  }

  /**
   * Builds the comprehensive NL planner instruction for Plan-Re-Act.
   *
   * This creates detailed instructions covering:
   * - High-level process (plan → execute → final answer)
   * - Formatting requirements using structured tags
   * - Planning requirements (decomposition, tool usage)
   * - Reasoning requirements (summarization, next steps)
   * - Final answer requirements (precision, handling limitations)
   * - Tool code requirements (valid Python, no undefined references)
   *
   * @returns The complete planning instruction string
   */
  private buildNlPlannerInstruction(): string {
    const highLevelPreamble = `
When answering the question, try to leverage the available tools to gather the information instead of your memorized knowledge.

Follow this process when answering the question: (1) first come up with a plan in natural language text format; (2) Then use tools to execute the plan and provide reasoning between tool code snippets to make a summary of current state and next step. Tool code snippets and reasoning should be interleaved with each other. (3) In the end, return one final answer.

Follow this format when answering the question: (1) The planning part should be under ${PLANNING_TAG}. (2) The tool code snippets should be under ${ACTION_TAG}, and the reasoning parts should be under ${REASONING_TAG}. (3) The final answer part should be under ${FINAL_ANSWER_TAG}.
`;

    const planningPreamble = `
Below are the requirements for the planning:
The plan is made to answer the user query if following the plan. The plan is coherent and covers all aspects of information from user query, and only involves the tools that are accessible by the agent. The plan contains the decomposed steps as a numbered list where each step should use one or multiple available tools. By reading the plan, you can intuitively know which tools to trigger or what actions to take.
If the initial plan cannot be successfully executed, you should learn from previous execution results and revise your plan. The revised plan should be be under ${REPLANNING_TAG}. Then use tools to follow the new plan.
`;

    const reasoningPreamble = `
Below are the requirements for the reasoning:
The reasoning makes a summary of the current trajectory based on the user query and tool outputs. Based on the tool outputs and plan, the reasoning also comes up with instructions to the next steps, making the trajectory closer to the final answer.
`;

    const finalAnswerPreamble = `
Below are the requirements for the final answer:
The final answer should be precise and follow query formatting requirements. Some queries may not be answerable with the available tools and information. In those cases, inform the user why you cannot process their query and ask for more information.
`;

    const toolCodeWithoutPythonLibrariesPreamble = `
Below are the requirements for the tool code:

**Custom Tools:** The available tools are described in the context and can be directly used.
- Code must be valid self-contained Python snippets with no imports and no references to tools or Python libraries that are not in the context.
- You cannot use any parameters or fields that are not explicitly defined in the APIs in the context.
- The code snippets should be readable, efficient, and directly relevant to the user query and reasoning steps.
- When using the tools, you should use the library name together with the function name, e.g., vertex_search.search().
- If Python libraries are not provided in the context, NEVER write your own code other than the function calls using the provided tools.
`;

    const userInputPreamble = `
VERY IMPORTANT instruction that you MUST follow in addition to the above instructions:

You should ask for clarification if you need more information to answer the question.
You should prefer using the information available in the context instead of repeated tool use.
`;

    return [
      highLevelPreamble,
      planningPreamble,
      reasoningPreamble,
      finalAnswerPreamble,
      toolCodeWithoutPythonLibrariesPreamble,
      userInputPreamble,
    ].join('\n\n');
  }
}
