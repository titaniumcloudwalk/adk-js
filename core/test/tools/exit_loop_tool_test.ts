/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {expect} from 'chai';

import {EventActions} from '../../src/events/event_actions.js';
import {ToolContext} from '../../src/tools/tool_context.js';
import {exitLoop} from '../../src/tools/exit_loop_tool.js';

describe('exitLoop', () => {
  it('should set escalate to true', () => {
    const actions: EventActions = {};
    const toolContext = {actions} as unknown as ToolContext;

    exitLoop(toolContext);

    expect(actions.escalate).to.be.true;
  });

  it('should set skipSummarization to true', () => {
    const actions: EventActions = {};
    const toolContext = {actions} as unknown as ToolContext;

    exitLoop(toolContext);

    expect(actions.skipSummarization).to.be.true;
  });

  it('should set both escalate and skipSummarization to true', () => {
    const actions: EventActions = {};
    const toolContext = {actions} as unknown as ToolContext;

    exitLoop(toolContext);

    expect(actions.escalate).to.be.true;
    expect(actions.skipSummarization).to.be.true;
  });

  it('should overwrite existing escalate value', () => {
    const actions: EventActions = {escalate: false};
    const toolContext = {actions} as unknown as ToolContext;

    exitLoop(toolContext);

    expect(actions.escalate).to.be.true;
  });

  it('should overwrite existing skipSummarization value', () => {
    const actions: EventActions = {skipSummarization: false};
    const toolContext = {actions} as unknown as ToolContext;

    exitLoop(toolContext);

    expect(actions.skipSummarization).to.be.true;
  });

  it('should work with pre-populated actions', () => {
    const actions: EventActions = {
      stateDelta: {key: 'value'},
      transferToAgent: 'some_agent',
    };
    const toolContext = {actions} as unknown as ToolContext;

    exitLoop(toolContext);

    expect(actions.escalate).to.be.true;
    expect(actions.skipSummarization).to.be.true;
    // Original values should still exist
    expect(actions.stateDelta).to.deep.equal({key: 'value'});
    expect(actions.transferToAgent).to.equal('some_agent');
  });
});
