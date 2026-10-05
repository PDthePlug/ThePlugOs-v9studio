const fs = await import('fs');

// tsconfig.json
const tsconfigPath = 'tsconfig.json';
let tsconfig = fs.readFileSync(tsconfigPath, 'utf8');
tsconfig = tsconfig.replace(
  '"@plugos/sdk": ["./packages/sdk/src/index.ts"]',
  '"@plugos/sdk": ["./packages/sdk/src/index.ts"],\n      "@plugos/react": ["./packages/react/src/index.tsx"]'
);
fs.writeFileSync(tsconfigPath, tsconfig);

// vitest.config.ts
const vitestPath = 'vitest.config.ts';
let vitest = fs.readFileSync(vitestPath, 'utf8');
vitest = vitest.replace(
  "{ find: '@plugos/sdk', replacement: resolve(__dirname, './packages/sdk/src/index.ts') }",
  "{ find: '@plugos/sdk', replacement: resolve(__dirname, './packages/sdk/src/index.ts') },\n      { find: /^@plugos\\/react\\/(.*)/, replacement: resolve(__dirname, './packages/react/src/$1') },\n      { find: '@plugos/react', replacement: resolve(__dirname, './packages/react/src/index.tsx') }"
);
fs.writeFileSync(vitestPath, vitest);
