import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Весь расчёт времени предполагает TZ=UTC — как и в проде.
    env: { TZ: 'UTC' },
    testTimeout: 20_000,
  },
});
