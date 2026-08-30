import * as fs from 'fs';

const stateFile = 'packages/core/src/state/index.ts';
let code = fs.readFileSync(stateFile, 'utf8');

// We will track the high-water mark for the state engine
code = code.replace(
  "export class StateEngine {",
  "export class StateEngine {\n  private readonly HWM_KEY = 'state_engine_hwm';"
);

// Update processEvent to update HWM
const processEventTarget = `      await storageEngine.set(collection, event.entityId, nextState);
      log.debug(\`Projected state for \${event.entityType}#\${event.entityId}\`);`;

const processEventReplacement = `      await storageEngine.set(collection, event.entityId, nextState);
      if (event.offset !== undefined) {
        await storageEngine.set('system', this.HWM_KEY, event.offset);
      }
      log.debug(\`Projected state for \${event.entityType}#\${event.entityId}\`);`;

code = code.replace(processEventTarget, processEventReplacement);

// Add getHighWaterMark
const getHwmCode = `  public async getHighWaterMark(): Promise<number> {
    const hwm = await storageEngine.get('system', this.HWM_KEY);
    return typeof hwm === 'number' ? hwm : -1;
  }`;

code = code.replace("  public async query", getHwmCode + "\n\n  public async query");

fs.writeFileSync(stateFile, code);
