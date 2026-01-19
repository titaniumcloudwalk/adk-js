/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {expect} from 'chai';

import {EventActions} from '../../src/events/event_actions.js';
import {ToolContext} from '../../src/tools/tool_context.js';
import {
  transferToAgent,
  TransferToAgentTool,
} from '../../src/tools/transfer_to_agent_tool.js';

describe('transfer_to_agent', () => {
  describe('transferToAgent function', () => {
    it('should set transferToAgent on actions', () => {
      const actions: EventActions = {};
      const toolContext = {actions} as unknown as ToolContext;

      transferToAgent('billing_agent', toolContext);

      expect(actions.transferToAgent).to.equal('billing_agent');
    });

    it('should overwrite existing transferToAgent value', () => {
      const actions: EventActions = {transferToAgent: 'old_agent'};
      const toolContext = {actions} as unknown as ToolContext;

      transferToAgent('new_agent', toolContext);

      expect(actions.transferToAgent).to.equal('new_agent');
    });
  });

  describe('TransferToAgentTool', () => {
    let tool: TransferToAgentTool;

    beforeEach(() => {
      tool = new TransferToAgentTool(['billing_agent', 'support_agent', 'sales_agent']);
    });

    describe('constructor', () => {
      it('should have name "transfer_to_agent"', () => {
        expect(tool.name).to.equal('transfer_to_agent');
      });

      it('should have appropriate description', () => {
        expect(tool.description).to.include('Transfer the question to another agent');
      });
    });

    describe('_getDeclaration', () => {
      it('should return a FunctionDeclaration', () => {
        const declaration = (tool as any)._getDeclaration();
        expect(declaration).to.exist;
        expect(declaration.name).to.equal('transfer_to_agent');
      });

      it('should have parameters with agentName property', () => {
        const declaration = (tool as any)._getDeclaration();
        expect(declaration.parameters).to.exist;
        expect(declaration.parameters.properties).to.have.property('agentName');
      });

      it('should have enum constraint with agent names', () => {
        const declaration = (tool as any)._getDeclaration();
        const agentNameSchema = declaration.parameters.properties.agentName;
        expect(agentNameSchema.enum).to.deep.equal([
          'billing_agent',
          'support_agent',
          'sales_agent',
        ]);
      });

      it('should have agentName as required parameter', () => {
        const declaration = (tool as any)._getDeclaration();
        expect(declaration.parameters.required).to.deep.equal(['agentName']);
      });

      it('should have STRING type for agentName', () => {
        const declaration = (tool as any)._getDeclaration();
        const agentNameSchema = declaration.parameters.properties.agentName;
        expect(agentNameSchema.type).to.equal('STRING');
      });
    });

    describe('runAsync', () => {
      it('should call transferToAgent with the provided agent name', async () => {
        const actions: EventActions = {};
        const toolContext = {actions} as unknown as ToolContext;

        await tool.runAsync({
          args: {agentName: 'billing_agent'},
          toolContext,
        });

        expect(actions.transferToAgent).to.equal('billing_agent');
      });

      it('should work with any agent name (enum constraint is for LLM only)', async () => {
        const actions: EventActions = {};
        const toolContext = {actions} as unknown as ToolContext;

        await tool.runAsync({
          args: {agentName: 'unknown_agent'},
          toolContext,
        });

        expect(actions.transferToAgent).to.equal('unknown_agent');
      });
    });

    describe('with different agent names', () => {
      it('should support single agent name', () => {
        const singleTool = new TransferToAgentTool(['only_agent']);
        const declaration = (singleTool as any)._getDeclaration();
        expect(declaration.parameters.properties.agentName.enum).to.deep.equal([
          'only_agent',
        ]);
      });

      it('should support many agent names', () => {
        const manyTool = new TransferToAgentTool([
          'agent1',
          'agent2',
          'agent3',
          'agent4',
          'agent5',
        ]);
        const declaration = (manyTool as any)._getDeclaration();
        expect(declaration.parameters.properties.agentName.enum).to.have.lengthOf(5);
      });

      it('should support empty agent names array', () => {
        const emptyTool = new TransferToAgentTool([]);
        const declaration = (emptyTool as any)._getDeclaration();
        expect(declaration.parameters.properties.agentName.enum).to.deep.equal([]);
      });
    });
  });
});
