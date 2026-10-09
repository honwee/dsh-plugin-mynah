import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.local.json'] })],
  test: { include: ['tests/**/*.spec.ts'], environment: 'node' },
})
