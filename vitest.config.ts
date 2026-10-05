import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
  resolve: {
    alias: [
      { find: /^@plugos\/core\/(.*)/, replacement: resolve(__dirname, './packages/core/src/$1') },
      { find: '@plugos/core', replacement: resolve(__dirname, './packages/core/src/index.ts') },
      { find: /^@plugos\/types\/(.*)/, replacement: resolve(__dirname, './packages/types/src/$1') },
      { find: '@plugos/types', replacement: resolve(__dirname, './packages/types/src/index.ts') },
      { find: /^@plugos\/sdk\/(.*)/, replacement: resolve(__dirname, './packages/sdk/src/$1') },
      { find: '@plugos/sdk', replacement: resolve(__dirname, './packages/sdk/src/index.ts') },
      { find: /^@plugos\/react\/(.*)/, replacement: resolve(__dirname, './packages/react/src/$1') },
      { find: '@plugos/react', replacement: resolve(__dirname, './packages/react/src/index.tsx') },
      { find: /^@plugos\/testing\/(.*)/, replacement: resolve(__dirname, './packages/testing/src/$1') },
      { find: '@plugos/testing', replacement: resolve(__dirname, './packages/testing/src/index.ts') },
      { find: /^@plugos\/cli\/(.*)/, replacement: resolve(__dirname, './packages/cli/src/$1') },
      { find: '@plugos/cli', replacement: resolve(__dirname, './packages/cli/src/index.ts') },
      { find: /^@plugos\/fastfood-domain\/(.*)/, replacement: resolve(__dirname, './fastfood-domain/src/$1') },
      { find: '@plugos/fastfood-domain', replacement: resolve(__dirname, './fastfood-domain/src/index.ts') },
      { find: /^@plugos\/pharmacy-domain\/(.*)/, replacement: resolve(__dirname, './pharmacy-domain/src/$1') },
      { find: '@plugos/pharmacy-domain', replacement: resolve(__dirname, './pharmacy-domain/src/index.ts') }
    ]
  },
});
