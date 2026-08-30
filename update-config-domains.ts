import * as fs from 'fs';

// vitest.config.ts
const vitestPath = 'vitest.config.ts';
let vitest = fs.readFileSync(vitestPath, 'utf8');
if (!vitest.includes("'@plugos/fastfood-domain'")) {
  vitest = vitest.replace(
    "{ find: '@plugos/cli', replacement: resolve(__dirname, './packages/cli/src/index.ts') }",
    "{ find: '@plugos/cli', replacement: resolve(__dirname, './packages/cli/src/index.ts') },\n      { find: /^@plugos\\/fastfood-domain\\/(.*)/, replacement: resolve(__dirname, './fastfood-domain/src/$1') },\n      { find: '@plugos/fastfood-domain', replacement: resolve(__dirname, './fastfood-domain/src/index.ts') },\n      { find: /^@plugos\\/pharmacy-domain\\/(.*)/, replacement: resolve(__dirname, './pharmacy-domain/src/$1') },\n      { find: '@plugos/pharmacy-domain', replacement: resolve(__dirname, './pharmacy-domain/src/index.ts') }"
  );
  fs.writeFileSync(vitestPath, vitest);
}
