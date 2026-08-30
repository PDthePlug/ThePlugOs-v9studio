import * as fs from 'fs';

// tsconfig.json
const tsconfigPath = 'tsconfig.json';
let tsconfig = fs.readFileSync(tsconfigPath, 'utf8');
if (!tsconfig.includes('"@plugos/testing"')) {
  tsconfig = tsconfig.replace(
    '"@plugos/react": ["./packages/react/src/index.tsx"]',
    '"@plugos/react": ["./packages/react/src/index.tsx"],\n      "@plugos/testing": ["./packages/testing/src/index.ts"],\n      "@plugos/cli": ["./packages/cli/src/index.ts"]'
  );
  fs.writeFileSync(tsconfigPath, tsconfig);
}

// vitest.config.ts
const vitestPath = 'vitest.config.ts';
let vitest = fs.readFileSync(vitestPath, 'utf8');
if (!vitest.includes("'@plugos/testing'")) {
  vitest = vitest.replace(
    "{ find: '@plugos/react', replacement: resolve(__dirname, './packages/react/src/index.tsx') }",
    "{ find: '@plugos/react', replacement: resolve(__dirname, './packages/react/src/index.tsx') },\n      { find: /^@plugos\\/testing\\/(.*)/, replacement: resolve(__dirname, './packages/testing/src/$1') },\n      { find: '@plugos/testing', replacement: resolve(__dirname, './packages/testing/src/index.ts') },\n      { find: /^@plugos\\/cli\\/(.*)/, replacement: resolve(__dirname, './packages/cli/src/$1') },\n      { find: '@plugos/cli', replacement: resolve(__dirname, './packages/cli/src/index.ts') }"
  );
  fs.writeFileSync(vitestPath, vitest);
}
