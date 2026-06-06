import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { getProjectTag } from './project-tag';
import { calculateAiCredits } from './model-pricing';

export interface UsageEntry {
  timestamp: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  totalTokens: number;
  aiCredits: number;
  billable: boolean;
  requestType: string; // 'chat' | 'inline' | 'background' | 'other'
}

export interface UsageData {
  project: string;
  tags: string[];
  costCenter: string;
  user: string;
  entries: UsageEntry[];
  summary: UsageSummary;
}

export interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  totalTokens: number;
  totalAiCredits: number;
  totalRequests: number;
  billableRequests: number;
  billableTokens: number;
  nonBillableTokens: number;
  byModel: Record<string, { inputTokens: number; outputTokens: number; cachedTokens: number; aiCredits: number; requests: number }>;
  byDay: Record<string, { inputTokens: number; outputTokens: number; cachedTokens: number; aiCredits: number; requests: number }>;
  byType: Record<string, { inputTokens: number; outputTokens: number; cachedTokens: number; aiCredits: number; requests: number; billable: boolean }>;
}

type ChangeListener = () => void;

export class UsageTracker {
  private data: UsageData | null = null;
  private listeners: ChangeListener[] = [];
  private cachedUser: string | null = null;

  private getFilePath(): string | null {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return null;
    const user = this.getUser().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return path.join(workspaceFolder.uri.fsPath, '.vscode', `copilot-usage-${user}.json`);
  }

  onDidChange(listener: ChangeListener): void {
    this.listeners.push(listener);
  }

  private emit(): void {
    for (const l of this.listeners) {
      l();
    }
  }

  async load(): Promise<UsageData> {
    if (this.data) return this.data;

    const filePath = this.getFilePath();
    if (!filePath) {
      return this.createEmpty();
    }

    // Migrate old copilot-usage.json → copilot-usage-{user}.json
    if (!fs.existsSync(filePath)) {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (workspaceFolder) {
        const oldPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'copilot-usage.json');
        if (fs.existsSync(oldPath)) {
          try {
            const oldContent = fs.readFileSync(oldPath, 'utf-8');
            const oldData = JSON.parse(oldContent);
            const fileUser = (oldData.user || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            const currentUser = this.getUser().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
            if (!fileUser || fileUser === currentUser) {
              fs.renameSync(oldPath, filePath);
            }
          } catch {}
        }
      }
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const raw = JSON.parse(content);
      let needsMigration = false;

      // Migrate old projectTag → project
      if (raw.projectTag && !raw.project) {
        raw.project = raw.projectTag;
        delete raw.projectTag;
        needsMigration = true;
      }
      if (!raw.tags) raw.tags = [];
      if (!raw.costCenter) raw.costCenter = '';

      // Migrate old schema fields to new billing model
      const s = raw.summary || {};
      if (s.totalPromptTokens !== undefined && s.totalInputTokens === undefined) {
        s.totalInputTokens = s.totalPromptTokens || 0;
        s.totalOutputTokens = s.totalCompletionTokens || 0;
        delete s.totalPromptTokens;
        delete s.totalCompletionTokens;
        needsMigration = true;
      }
      s.totalCachedTokens = s.totalCachedTokens || 0;
      s.totalAiCredits = s.totalAiCredits || 0;
      s.billableRequests = s.billableRequests || 0;
      s.billableTokens = s.billableTokens || 0;
      s.nonBillableTokens = s.nonBillableTokens || 0;

      // Migrate byModel entries: promptTokens/completionTokens → inputTokens/outputTokens
      if (s.byModel) {
        for (const stats of Object.values(s.byModel) as any[]) {
          if (stats.promptTokens !== undefined && stats.inputTokens === undefined) {
            stats.inputTokens = stats.promptTokens || 0;
            stats.outputTokens = stats.completionTokens || 0;
            delete stats.promptTokens;
            delete stats.completionTokens;
            needsMigration = true;
          }
          stats.cachedTokens = stats.cachedTokens || 0;
          stats.aiCredits = stats.aiCredits || 0;
        }
      }

      // Migrate byDay entries
      if (s.byDay) {
        for (const stats of Object.values(s.byDay) as any[]) {
          if (stats.promptTokens !== undefined && stats.inputTokens === undefined) {
            stats.inputTokens = stats.promptTokens || 0;
            stats.outputTokens = stats.completionTokens || 0;
            delete stats.promptTokens;
            delete stats.completionTokens;
            needsMigration = true;
          }
          stats.cachedTokens = stats.cachedTokens || 0;
          stats.aiCredits = stats.aiCredits || 0;
        }
      }

      // Migrate byType entries
      if (s.byType) {
        for (const stats of Object.values(s.byType) as any[]) {
          if (stats.promptTokens !== undefined && stats.inputTokens === undefined) {
            stats.inputTokens = stats.promptTokens || 0;
            stats.outputTokens = stats.completionTokens || 0;
            delete stats.promptTokens;
            delete stats.completionTokens;
            needsMigration = true;
          }
          stats.cachedTokens = stats.cachedTokens || 0;
          stats.aiCredits = stats.aiCredits || 0;
          if (stats.billable === undefined) stats.billable = true;
        }
      }

      // Migrate individual entries
      if (raw.entries) {
        for (const entry of raw.entries) {
          if (entry.promptTokens !== undefined && entry.inputTokens === undefined) {
            entry.inputTokens = entry.promptTokens || 0;
            entry.outputTokens = entry.completionTokens || 0;
            delete entry.promptTokens;
            delete entry.completionTokens;
            needsMigration = true;
          }
          entry.cachedTokens = entry.cachedTokens || 0;
          entry.aiCredits = entry.aiCredits || 0;
          if (entry.billable === undefined) entry.billable = true;
        }
      }

      raw.summary = s;
      this.data = raw as UsageData;

      // Persist migrated data and remove old file
      if (needsMigration) {
        await this.save(this.data);
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (workspaceFolder) {
          const oldPath = path.join(workspaceFolder.uri.fsPath, '.vscode', 'copilot-usage.json');
          if (fs.existsSync(oldPath) && oldPath !== filePath) {
            try { fs.unlinkSync(oldPath); } catch {}
          }
        }
      }

      return this.data;
    } catch {
      this.data = this.createEmpty();
      return this.data;
    }
  }

  private createEmpty(): UsageData {
    const config = vscode.workspace.getConfiguration('wingman');
    return {
      project: getProjectTag(),
      tags: config.get('tags', []),
      costCenter: config.get('costCenter', ''),
      user: this.getUser(),
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
  }

  private getUser(): string {
    if (this.cachedUser) return this.cachedUser;
    // Try git config user
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (workspaceFolder) {
        const name = execSync('git config user.name', { cwd: workspaceFolder, encoding: 'utf-8' }).trim();
        this.cachedUser = name;
        return name;
      }
    } catch {}
    const fallback = process.env.USER || process.env.USERNAME || 'unknown';
    this.cachedUser = fallback;
    return fallback;
  }

  async logRequest(entry: Omit<UsageEntry, 'timestamp' | 'totalTokens' | 'aiCredits'>): Promise<void> {
    const data = await this.load();
    const config = vscode.workspace.getConfiguration('wingman');

    const totalTokens = entry.inputTokens + entry.outputTokens + entry.cachedTokens;
    const aiCredits = calculateAiCredits(
      entry.model,
      entry.inputTokens,
      entry.outputTokens,
      entry.cachedTokens,
      entry.billable
    );

    const fullEntry: UsageEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
      totalTokens,
      aiCredits,
    };

    // Only set metadata if not already saved in data file
    if (!data.project) data.project = getProjectTag();
    if (!data.tags || data.tags.length === 0) data.tags = config.get('tags', []);
    if (!data.costCenter) data.costCenter = config.get('costCenter', '');
    data.entries.push(fullEntry);

    // Update summary
    data.summary.totalInputTokens += fullEntry.inputTokens;
    data.summary.totalOutputTokens += fullEntry.outputTokens;
    data.summary.totalCachedTokens += fullEntry.cachedTokens;
    data.summary.totalTokens += fullEntry.totalTokens;
    data.summary.totalAiCredits += fullEntry.aiCredits;
    data.summary.totalRequests += 1;
    if (fullEntry.billable) {
      data.summary.billableRequests += 1;
      data.summary.billableTokens += fullEntry.totalTokens;
    } else {
      data.summary.nonBillableTokens += fullEntry.totalTokens;
    }

    // By model
    if (!data.summary.byModel[fullEntry.model]) {
      data.summary.byModel[fullEntry.model] = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, aiCredits: 0, requests: 0 };
    }
    data.summary.byModel[fullEntry.model].inputTokens += fullEntry.inputTokens;
    data.summary.byModel[fullEntry.model].outputTokens += fullEntry.outputTokens;
    data.summary.byModel[fullEntry.model].cachedTokens += fullEntry.cachedTokens;
    data.summary.byModel[fullEntry.model].aiCredits += fullEntry.aiCredits;
    data.summary.byModel[fullEntry.model].requests += 1;

    // By type
    if (!data.summary.byType) data.summary.byType = {};
    if (!data.summary.byType[fullEntry.requestType]) {
      data.summary.byType[fullEntry.requestType] = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, aiCredits: 0, requests: 0, billable: fullEntry.billable };
    }
    data.summary.byType[fullEntry.requestType].inputTokens += fullEntry.inputTokens;
    data.summary.byType[fullEntry.requestType].outputTokens += fullEntry.outputTokens;
    data.summary.byType[fullEntry.requestType].cachedTokens += fullEntry.cachedTokens;
    data.summary.byType[fullEntry.requestType].aiCredits += fullEntry.aiCredits;
    data.summary.byType[fullEntry.requestType].requests += 1;

    // By day
    const day = fullEntry.timestamp.slice(0, 10); // YYYY-MM-DD
    if (!data.summary.byDay[day]) {
      data.summary.byDay[day] = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, aiCredits: 0, requests: 0 };
    }
    data.summary.byDay[day].inputTokens += fullEntry.inputTokens;
    data.summary.byDay[day].outputTokens += fullEntry.outputTokens;
    data.summary.byDay[day].cachedTokens += fullEntry.cachedTokens;
    data.summary.byDay[day].aiCredits += fullEntry.aiCredits;
    data.summary.byDay[day].requests += 1;

    await this.save(data);
    this.emit();
  }

  getUsageSummarySync(): { totalTokens: number; totalRequests: number; totalAiCredits: number } {
    if (!this.data) {
      // Try sync load — but don't cache empty data so load() migration still runs
      const filePath = this.getFilePath();
      if (filePath && fs.existsSync(filePath)) {
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          this.data = JSON.parse(content) as UsageData;
        } catch {
          // Don't cache — let load() handle migration
        }
      }
    }
    if (!this.data) {
      return { totalTokens: 0, totalRequests: 0, totalAiCredits: 0 };
    }
    return {
      totalTokens: this.data.summary.totalTokens || 0,
      totalRequests: this.data.summary.totalRequests || 0,
      totalAiCredits: this.data.summary.totalAiCredits || 0,
    };
  }

  async getUsageData(): Promise<UsageData> {
    return this.load();
  }

  async updateMetadata(meta: { project: string; tags: string[]; costCenter: string }): Promise<void> {
    const data = await this.load();
    data.project = meta.project;
    data.tags = meta.tags;
    data.costCenter = meta.costCenter;
    await this.save(data);
    this.emit();
  }

  async reset(): Promise<void> {
    this.data = this.createEmpty();
    await this.save(this.data);
    this.emit();
  }

  private async save(data: UsageData): Promise<void> {
    const filePath = this.getFilePath();
    if (!filePath) return;

    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    this.data = data;
  }
}
