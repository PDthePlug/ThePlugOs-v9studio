const fs = require('fs');

const index = fs.readFileSync('packages/core/src/storage/index.ts', 'utf8');
const newIndex = index
  .replace('appendEvent(event: any): Promise<void>;', 'appendEvent(event: any): Promise<number>;')
  .replace('public async appendEvent(event: any): Promise<void> {', 'public async appendEvent(event: any): Promise<number> {');
fs.writeFileSync('packages/core/src/storage/index.ts', newIndex);

const inMem = fs.readFileSync('packages/core/src/storage/adapters/in-memory.ts', 'utf8');
const newInMem = inMem
  .replace('public async appendEvent(event: any): Promise<void> {', 'public async appendEvent(event: any): Promise<number> {')
  .replace('this.events.push(event);', 'this.events.push(event);\n    return this.events.length - 1;');
fs.writeFileSync('packages/core/src/storage/adapters/in-memory.ts', newInMem);

const events = fs.readFileSync('packages/core/src/events/index.ts', 'utf8');
let newEvents = events
  .replace('version: number;', 'version: number;\n  offset?: number;')
  .replace('await storageEngine.appendEvent(event);', 'event.offset = await storageEngine.appendEvent(event);');
fs.writeFileSync('packages/core/src/events/index.ts', newEvents);
