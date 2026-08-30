import { createLogger } from '../../observability/logger';
import { eventEngine } from '../../events';
import { stateEngine } from '../../state';
import { securityEngine } from '../../security';

const log = createLogger('WorkflowService');

export interface WorkflowTransition {
  from: string | string[];
  to: string;
  action: string;
  requiredRole?: string;
  conditionRuleId?: string; // Links to RulesService
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  entityType: string;
  initialState: string;
  transitions: WorkflowTransition[];
}

export class WorkflowService {
  private workflows: Map<string, WorkflowDefinition> = new Map();

  public registerWorkflow(workflow: WorkflowDefinition) {
    this.workflows.set(workflow.entityType, workflow);
    log.debug(`Registered workflow for entity: ${workflow.entityType}`);
  }

  public async transition(entityId: string, entityType: string, action: string, payload?: any): Promise<void> {
    const workflow = this.workflows.get(entityType);
    if (!workflow) {
      throw new Error(`No workflow registered for entity type: ${entityType}`);
    }

    // 1. Get Current State
    const state = await stateEngine.query(entityType, entityId);
    const currentStateStr = state ? state.status : workflow.initialState;

    // 2. Find Valid Transition
    const transition = workflow.transitions.find(t => 
      t.action === action && 
      (Array.isArray(t.from) ? t.from.includes(currentStateStr) : t.from === currentStateStr)
    );

    if (!transition) {
      throw new Error(`Invalid transition '${action}' from state '${currentStateStr}' for entity '${entityType}'`);
    }

    // 3. Check Security / Roles
    if (transition.requiredRole) {
      // Re-use SecurityEngine for action evaluation
      await securityEngine.enforce(action, entityType);
    }

    // 4. Publish Event
    log.info(`Workflow Transition: ${entityType}#${entityId} [${currentStateStr} -> ${transition.to}] via ${action}`);
    
    await eventEngine.publish(entityId, entityType, action, {
      ...payload,
      _previousState: currentStateStr,
      _newState: transition.to
    });
  }
}

export const workflowService = new WorkflowService();
