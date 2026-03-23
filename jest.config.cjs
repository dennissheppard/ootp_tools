/** @type {import('ts-jest').JestConfigWithTsJest}
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testPathIgnorePatterns: [
    '/node_modules/',
    // Vitest-only tests (run via npx vitest)
    'src/services/simulation/SeasonSimulator.test.ts',
    'src/router\\.test\\.ts',
    // DOM-dependent tests (need jsdom environment)
    'src/views/TeamPlanningView\\.test\\.ts',
    // Worktree copies
    '\\.claude/worktrees/',
  ],
  moduleNameMapper: {
    '^(\.{1,2}/.*)\\.js$': '$1',
    '.*teamLogos.*': '<rootDir>/src/utils/__mocks__/teamLogos.ts',
    './SupabaseDataService': '<rootDir>/src/services/__mocks__/SupabaseDataService.ts',
  },
  transform: {
    // '^.+\.[tj]sx?$' to process js/ts with `ts-jest`
    // '^.+\.m?[tj]sx?$' to process js/ts/mjs/mts with `ts-jest`
    '^.+\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
};
