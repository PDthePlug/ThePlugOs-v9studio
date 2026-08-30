import jsonLogic from 'json-logic-js';
import { createLogger } from '../../observability/logger';

const log = createLogger('RulesService');

export interface RuleDefinition {
  id: string;
  name: string;
  description: string;
  condition: any; // JSONLogic AST
  result: any;    // JSONLogic AST or static value
}

export class RulesService {
  private rules: Map<string, RuleDefinition[]> = new Map();

  public registerRules(domain: string, rules: RuleDefinition[]) {
    this.rules.set(domain, rules);
    log.debug(`Registered ${rules.length} rules for domain: ${domain}`);
  }

  public evaluate(domain: string, context: any): any[] {
    const domainRules = this.rules.get(domain) || [];
    const results = [];

    for (const rule of domainRules) {
      try {
        const isMatch = jsonLogic.apply(rule.condition, context);
        if (isMatch) {
          log.debug(`Rule matched: ${rule.name}`);
          const outcome = typeof rule.result === 'object' && rule.result !== null 
            ? jsonLogic.apply(rule.result, context)
            : rule.result;
          results.push({ ruleId: rule.id, outcome });
        }
      } catch (err: any) {
        log.error(`Failed to evaluate rule ${rule.name}`, { error: err.message });
      }
    }

    return results;
  }
}

export const rulesService = new RulesService();
