import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { UsageTracker } from '../usage-tracker';

// Mock vscode
vi.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [{ uri: { fsPath: '/tmp/test-workspace' } }],
    getConfiguration: () => ({
      get: (key: string, def: any) => def,
    }),
  },
}));

// Mock project-tag
vi.mock('../project-tag', () => ({
  getProjectTag: () => 'test-org/test-repo',
}));

// Mock child_process so getUser() doesn't shell out
vi.mock('child_process', () => ({
  execSync: () => 'test-user',
}));

const TEST_DIR = path.join('/tmp/test-workspace', '.vscode');
const TEST_FILE = path.join(TEST_DIR, 'copilot-usage-test-user.json');

describe('UsageTracker', () => {
  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    // Remove any existing file
    if (fs.existsSync(TEST_FILE)) {
      fs.unlinkSync(TEST_FILE);
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_FILE)) {
      fs.unlinkSync(TEST_FILE);
    }
  });

  it('creates empty data on first load', async () => {
    const tracker = new UsageTracker();
    const data = await tracker.getUsageData();

    expect(data.project).toBe('test-org/test-repo');
    expect(data.tags).toEqual([]);
    expect(data.costCenter).toBe('');
    expect(data.entries).toEqual([]);
    expect(data.summary.totalTokens).toBe(0);
    expect(data.summary.totalRequests).toBe(0);
  });

  it('logs a request and updates summary', async () => {
    const tracker = new UsageTracker();

    await tracker.logRequest({
      model: 'gpt-4o',
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      billable: true,
      requestType: 'chat',
    });

    const data = await tracker.getUsageData();
    expect(data.entries).toHaveLength(1);
    expect(data.entries[0].model).toBe('gpt-4o');
    expect(data.entries[0].totalTokens).toBe(150);
    expect(data.entries[0].billable).toBe(true);
    expect(data.entries[0].aiCredits).toBeGreaterThan(0);
    expect(data.summary.totalInputTokens).toBe(100);
    expect(data.summary.totalOutputTokens).toBe(50);
    expect(data.summary.totalTokens).toBe(150);
    expect(data.summary.totalRequests).toBe(1);
    expect(data.summary.billableRequests).toBe(1);
    expect(data.summary.billableTokens).toBe(150);
    expect(data.summary.totalAiCredits).toBeGreaterThan(0);
    expect(data.summary.byModel['gpt-4o']).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      requests: 1,
    });
    expect(data.summary.byType['chat']).toMatchObject({
      inputTokens: 100,
      outputTokens: 50,
      cachedTokens: 0,
      requests: 1,
      billable: true,
    });
  });

  it('accumulates multiple requests', async () => {
    const tracker = new UsageTracker();

    await tracker.logRequest({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50, cachedTokens: 0, billable: true, requestType: 'chat' });
    await tracker.logRequest({ model: 'claude-sonnet-4-20250514', inputTokens: 200, outputTokens: 100, cachedTokens: 0, billable: true, requestType: 'chat' });
    await tracker.logRequest({ model: 'gpt-4o', inputTokens: 80, outputTokens: 40, cachedTokens: 0, billable: false, requestType: 'inline' });

    const data = await tracker.getUsageData();
    expect(data.entries).toHaveLength(3);
    expect(data.summary.totalTokens).toBe(570);
    expect(data.summary.totalRequests).toBe(3);
    expect(data.summary.billableRequests).toBe(2);
    expect(data.summary.billableTokens).toBe(450);
    expect(data.summary.nonBillableTokens).toBe(120);
    expect(data.summary.byModel['gpt-4o'].requests).toBe(2);
    expect(data.summary.byModel['claude-sonnet-4-20250514'].requests).toBe(1);
    expect(data.summary.byType['chat'].requests).toBe(2);
    expect(data.summary.byType['inline'].requests).toBe(1);
  });

  it('persists data to disk', async () => {
    const tracker = new UsageTracker();
    await tracker.logRequest({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50, cachedTokens: 0, billable: true, requestType: 'chat' });

    // Verify file was written
    expect(fs.existsSync(TEST_FILE)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(TEST_FILE, 'utf-8'));
    expect(raw.summary.totalTokens).toBe(150);
    expect(raw.summary.totalAiCredits).toBeGreaterThan(0);
  });

  it('loads existing data from disk', async () => {
    // Write a pre-existing file
    const existing = {
      project: 'existing-project',
      tags: ['tag-a'],
      costCenter: 'CC-100',
      user: 'testuser',
      entries: [],
      summary: {
        totalInputTokens: 500,
        totalOutputTokens: 300,
        totalCachedTokens: 0,
        totalTokens: 800,
        totalAiCredits: 5.2,
        totalRequests: 5,
        billableRequests: 3,
        billableTokens: 600,
        nonBillableTokens: 200,
        byModel: {},
        byDay: {},
        byType: {},
      },
    };
    fs.writeFileSync(TEST_FILE, JSON.stringify(existing), 'utf-8');

    const tracker = new UsageTracker();
    const data = await tracker.getUsageData();
    expect(data.project).toBe('existing-project');
    expect(data.tags).toEqual(['tag-a']);
    expect(data.costCenter).toBe('CC-100');
    expect(data.summary.totalTokens).toBe(800);
  });

  it('migrates projectTag → project on load', async () => {
    const legacy = {
      projectTag: 'old-project-name',
      user: 'testuser',
      entries: [],
      summary: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
        totalTokens: 0,
        totalRequests: 0,
        byModel: {},
        byDay: {},
        byType: {},
      },
    };
    fs.writeFileSync(TEST_FILE, JSON.stringify(legacy), 'utf-8');

    const tracker = new UsageTracker();
    const data = await tracker.getUsageData();
    expect(data.project).toBe('old-project-name');
    expect((data as any).projectTag).toBeUndefined();
  });

  it('does not overwrite existing metadata on logRequest', async () => {
    const existing = {
      project: 'my-project',
      tags: ['team-x'],
      costCenter: 'CC-999',
      user: 'testuser',
      entries: [],
      summary: {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
        totalTokens: 0,
        totalAiCredits: 0,
        totalRequests: 0,
        billableRequests: 0,
        billableTokens: 0,
        nonBillableTokens: 0,
        byModel: {},
        byDay: {},
        byType: {},
      },
    };
    fs.writeFileSync(TEST_FILE, JSON.stringify(existing), 'utf-8');

    const tracker = new UsageTracker();
    await tracker.logRequest({ model: 'gpt-4o', inputTokens: 50, outputTokens: 25, cachedTokens: 0, billable: true, requestType: 'chat' });

    const data = await tracker.getUsageData();
    expect(data.project).toBe('my-project');
    expect(data.tags).toEqual(['team-x']);
    expect(data.costCenter).toBe('CC-999');
  });

  it('updateMetadata saves project, tags, and costCenter', async () => {
    const tracker = new UsageTracker();
    await tracker.getUsageData(); // init

    await tracker.updateMetadata({
      project: 'new-name',
      tags: ['billing', 'q2'],
      costCenter: 'CC-5000',
    });

    const data = await tracker.getUsageData();
    expect(data.project).toBe('new-name');
    expect(data.tags).toEqual(['billing', 'q2']);
    expect(data.costCenter).toBe('CC-5000');
  });

  it('reset clears all data', async () => {
    const tracker = new UsageTracker();
    await tracker.logRequest({ model: 'gpt-4o', inputTokens: 100, outputTokens: 50, cachedTokens: 0, billable: true, requestType: 'chat' });
    await tracker.reset();

    const data = await tracker.getUsageData();
    expect(data.entries).toEqual([]);
    expect(data.summary.totalTokens).toBe(0);
    expect(data.summary.totalRequests).toBe(0);
    expect(data.summary.totalAiCredits).toBe(0);
  });

  it('emits change events', async () => {
    const tracker = new UsageTracker();
    const listener = vi.fn();
    tracker.onDidChange(listener);

    await tracker.logRequest({ model: 'gpt-4o', inputTokens: 10, outputTokens: 5, cachedTokens: 0, billable: false, requestType: 'inline' });
    expect(listener).toHaveBeenCalledTimes(1);

    await tracker.updateMetadata({ project: 'x', tags: [], costCenter: '' });
    expect(listener).toHaveBeenCalledTimes(2);

    await tracker.reset();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('non-billable requests have zero AI credits', async () => {
    const tracker = new UsageTracker();

    await tracker.logRequest({ model: 'gpt-4o', inputTokens: 500, outputTokens: 200, cachedTokens: 0, billable: false, requestType: 'inline' });

    const data = await tracker.getUsageData();
    expect(data.entries[0].aiCredits).toBe(0);
    expect(data.summary.totalAiCredits).toBe(0);
    expect(data.summary.nonBillableTokens).toBe(700);
    expect(data.summary.billableTokens).toBe(0);
  });

  it('calculates AI credits for billable requests', async () => {
    const tracker = new UsageTracker();

    // GPT-4.1: input $2.00/M, output $8.00/M
    await tracker.logRequest({ model: 'gpt-4.1', inputTokens: 1000, outputTokens: 500, cachedTokens: 0, billable: true, requestType: 'chat' });

    const data = await tracker.getUsageData();
    // Cost: (1000 * 2.00 + 500 * 8.00) / 1,000,000 = $0.006 = 0.6 AI credits
    expect(data.entries[0].aiCredits).toBeCloseTo(0.6, 1);
    expect(data.summary.totalAiCredits).toBeCloseTo(0.6, 1);
    expect(data.summary.billableTokens).toBe(1500);
  });
});
