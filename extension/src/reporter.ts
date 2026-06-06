import * as vscode from 'vscode';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { UsageTracker } from './usage-tracker';
import { getProjectTag } from './project-tag';

/**
 * Posts usage snapshots to a configured reporting server.
 * Supports 'auto' (configurable interval, default 5min) and 'manual' (on-demand) modes.
 */
export class UsageReporter {
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private tracker: UsageTracker) {}

  start(): void {
    this.setupAutoIfEnabled();
    // Re-evaluate when settings change
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('wingman.reportingFrequency') || e.affectsConfiguration('wingman.reportingServer') || e.affectsConfiguration('wingman.reportingInterval')) {
        this.stopTimer();
        this.setupAutoIfEnabled();
      }
    });
  }

  private setupAutoIfEnabled(): void {
    const config = vscode.workspace.getConfiguration('wingman');
    const frequency = config.get<string>('reportingFrequency', 'manual');
    const serverUrl = config.get<string>('reportingServer', '');
    const intervalSecs = Math.max(30, config.get<number>('reportingInterval', 300));

    if (frequency === 'auto' && serverUrl) {
      this.timer = setInterval(() => this.reportSilent(), intervalSecs * 1000);
      // Also report once on start after a short delay
      setTimeout(() => this.reportSilent(), 5_000);
    }
  }

  private stopTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  stop(): void {
    this.stopTimer();
  }

  /** Silent report — swallows errors (used in auto mode) */
  private async reportSilent(): Promise<void> {
    try { await this.report(); } catch {}
  }

  /** Submit report. Throws on failure so callers can show error. */
  async report(): Promise<void> {
    const config = vscode.workspace.getConfiguration('wingman');
    const serverUrl = config.get<string>('reportingServer', '');
    if (!serverUrl) {
      throw new Error('No reporting server URL configured. Set wingman.reportingServer in settings.');
    }

    const data = await this.tracker.getUsageData();
    const ghAccount = await this.getGitHubAccount();

    const payload = {
      project: data.project || getProjectTag(),
      tags: data.tags || [],
      costCenter: data.costCenter || '',
      user: data.user,
      githubAccount: ghAccount?.label || null,
      summary: data.summary,
      reportedAt: new Date().toISOString(),
    };

    await this.post(serverUrl, payload);
  }

  private async getGitHubAccount(): Promise<{ label: string; id: string } | null> {
    try {
      const session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: false });
      if (session) return { label: session.account.label, id: session.account.id };
    } catch {}
    return null;
  }

  private post(urlStr: string, payload: object): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = new URL(urlStr);
      const body = JSON.stringify(payload);
      const mod = url.protocol === 'https:' ? https : http;

      const req = mod.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname + url.search,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        (res) => {
          res.resume(); // drain
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            resolve();
          } else {
            reject(new Error(`Report server responded ${res.statusCode}`));
          }
        }
      );

      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }
}
