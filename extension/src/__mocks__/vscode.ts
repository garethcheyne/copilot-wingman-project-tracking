import { vi } from 'vitest';

// Mock vscode module
vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/tmp/test-workspace' } }],
    getConfiguration: () => ({
      get: (key: string, def: any) => def,
    }),
  },
  authentication: {
    getSession: vi.fn().mockResolvedValue(null),
  },
  window: {},
  commands: {},
  ConfigurationTarget: { Workspace: 1, Global: 2 },
}));
