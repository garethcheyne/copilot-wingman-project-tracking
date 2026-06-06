import * as vscode from 'vscode';
import { UsageTracker, UsageData } from '../usage-tracker';
import { getProjectTag } from '../project-tag';
import { getModelMultiplier } from '../model-pricing';

export class UsagePanelProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly tracker: UsageTracker
  ) {
    tracker.onDidChange(() => this.refresh());
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
    };

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      if (msg.command === 'saveAll') {
        await this.tracker.updateMetadata({
          project: msg.project,
          tags: msg.tags.split(',').map((t: string) => t.trim()).filter((t: string) => t),
          costCenter: msg.costCenter,
        });
        this.updateContent();
      } else if (msg.command === 'connectGitHub') {
        try {
          await vscode.authentication.getSession('github', ['user:email'], { createIfNone: true });
          this.updateContent();
        } catch {}
      } else if (msg.command === 'submitReport') {
        try {
          await vscode.commands.executeCommand('wingman.submitReport');
          webviewView.webview.postMessage({ command: 'submitResult', success: true });
        } catch (e: any) {
          webviewView.webview.postMessage({ command: 'submitResult', success: false, error: e?.message || 'Unknown error' });
        }
      } else if (msg.command === 'openSettings') {
        vscode.commands.executeCommand('workbench.action.openSettings', 'wingman.reporting');
      }
    });

    this.updateContent();
  }

  refresh() {
    this.updateContent();
  }

  private async updateContent() {
    if (!this.view) return;

    const data = await this.tracker.getUsageData();
    const ghAccount = await this.getGitHubAccount();
    this.view.webview.html = this.getHtml(data, ghAccount);
  }

  private async getGitHubAccount(): Promise<{ label: string; id: string } | null> {
    // Try different scope combinations — Copilot may have registered with varying scopes
    const scopesToTry = [[], ['user:email'], ['read:user']];
    for (const scopes of scopesToTry) {
      try {
        const session = await vscode.authentication.getSession('github', scopes, { createIfNone: false });
        if (session) {
          return { label: session.account.label, id: session.account.id };
        }
      } catch {}
    }
    return null;
  }

  private getHtml(data: UsageData, ghAccount: { label: string; id: string } | null): string {
    const tag = data.project || getProjectTag();
    const tags = data.tags || [];
    const costCenter = data.costCenter || '';
    const { summary } = data;

    // Type breakdown
    const byType = summary.byType || {};
    const chatStats = byType['chat'] || { inputTokens: 0, outputTokens: 0, cachedTokens: 0, aiCredits: 0, requests: 0, billable: true };
    const inlineStats = byType['inline'] || { inputTokens: 0, outputTokens: 0, cachedTokens: 0, aiCredits: 0, requests: 0, billable: false };
    const backgroundStats = byType['background'] || { inputTokens: 0, outputTokens: 0, cachedTokens: 0, aiCredits: 0, requests: 0, billable: true };
    const otherStats = byType['other'] || { inputTokens: 0, outputTokens: 0, cachedTokens: 0, aiCredits: 0, requests: 0, billable: true };

    const totalChat = chatStats.inputTokens + chatStats.outputTokens + chatStats.cachedTokens;
    const totalInline = inlineStats.inputTokens + inlineStats.outputTokens + inlineStats.cachedTokens;
    const totalBackground = backgroundStats.inputTokens + backgroundStats.outputTokens + backgroundStats.cachedTokens;
    const totalOther = otherStats.inputTokens + otherStats.outputTokens + otherStats.cachedTokens;
    const grandTotal = summary.totalTokens;

    // AI Credits
    const totalCredits = summary.totalAiCredits || 0;
    const creditsDisplay = totalCredits < 10 ? totalCredits.toFixed(2) : totalCredits.toFixed(1);

    // Percentages for the bar
    const chatPct = grandTotal > 0 ? Math.round((totalChat / grandTotal) * 100) : 0;
    const inlinePct = grandTotal > 0 ? Math.round((totalInline / grandTotal) * 100) : 0;
    const bgPct = grandTotal > 0 ? Math.round((totalBackground / grandTotal) * 100) : 0;

    // Build model breakdown rows
    const sortedModels = Object.entries(summary.byModel)
      .map(([model, stats]) => ({ model, stats, total: stats.inputTokens + stats.outputTokens + stats.cachedTokens }))
      .sort((a, b) => b.stats.aiCredits - a.stats.aiCredits);
    const modelMax = sortedModels.reduce((m, r) => Math.max(m, r.stats.aiCredits), 0);

    const modelRows = sortedModels
      .map(({ model, stats }, i) => {
        const pct = modelMax > 0 ? (stats.aiCredits / modelMax) * 100 : 0;
        const rank = String(i + 1).padStart(2, '0');
        const displayName = model.length > 28 ? model.slice(0, 26) + '…' : model;
        const creditsStr = stats.aiCredits < 10 ? stats.aiCredits.toFixed(2) : stats.aiCredits.toFixed(1);
        return `
          <div class="data-item reveal" style="--w:${pct.toFixed(1)}%; --i:${10 + i}">
            <div class="data-line">
              <span class="rank">${rank}</span>
              <span class="name" title="${model}">${displayName}</span>
              <span class="reqs">${stats.requests}</span>
              <span class="tokens">${creditsStr} cr</span>
            </div>
            <div class="mini-bar"></div>
          </div>
        `;
      })
      .join('');

    // Build daily breakdown (last 7 days)
    const sortedDays = Object.entries(summary.byDay)
      .map(([day, stats]) => ({ day, stats, total: stats.inputTokens + stats.outputTokens + stats.cachedTokens }))
      .sort((a, b) => b.day.localeCompare(a.day))
      .slice(0, 7);
    const dayMax = sortedDays.reduce((m, r) => Math.max(m, r.stats.aiCredits), 0);

    const days = sortedDays
      .map(({ day, stats }, i) => {
        const pct = dayMax > 0 ? (stats.aiCredits / dayMax) * 100 : 0;
        const creditsStr = stats.aiCredits < 10 ? stats.aiCredits.toFixed(2) : stats.aiCredits.toFixed(1);
        return `
          <div class="data-item reveal" style="--w:${pct.toFixed(1)}%; --i:${20 + i}">
            <div class="data-line">
              <span class="day">${day}</span>
              <span class="reqs">${stats.requests}</span>
              <span class="tokens">${creditsStr} cr</span>
            </div>
            <div class="mini-bar"></div>
          </div>
        `;
      })
      .join('');

    // ── Token tab data ──
    const tokenModelRows = sortedModels
      .sort((a, b) => b.total - a.total)
      .map(({ model, stats, total }, i) => {
        const tokenMax = sortedModels.reduce((m, r) => Math.max(m, r.total), 0);
        const pct = tokenMax > 0 ? (total / tokenMax) * 100 : 0;
        const rank = String(i + 1).padStart(2, '0');
        const displayName = model.length > 22 ? model.slice(0, 20) + '…' : model;
        const mult = getModelMultiplier(model);
        const multClass = mult === 0 ? 'mult low' : mult <= 1 ? 'mult low' : 'mult';
        const multStr = mult === 0 ? 'FREE' : mult < 1 ? mult + 'x' : mult + 'x';
        return `
          <div class="data-item reveal" style="--w:${pct.toFixed(1)}%; --i:${10 + i}">
            <div class="data-line">
              <span class="rank">${rank}</span>
              <span class="name" title="${model}">${displayName} <span class="${multClass}">${multStr}</span></span>
              <span class="reqs">${stats.requests}</span>
              <span class="tokens">${total.toLocaleString()}</span>
            </div>
            <div class="mini-bar"></div>
          </div>
        `;
      })
      .join('');

    const tokenDayMax = sortedDays.reduce((m, r) => Math.max(m, r.total), 0);
    const tokenDays = sortedDays
      .map(({ day, stats, total }, i) => {
        const pct = tokenDayMax > 0 ? (total / tokenDayMax) * 100 : 0;
        return `
          <div class="data-item reveal" style="--w:${pct.toFixed(1)}%; --i:${20 + i}">
            <div class="data-line">
              <span class="day">${day}</span>
              <span class="reqs">${stats.requests}</span>
              <span class="tokens">${total.toLocaleString()} tok</span>
            </div>
            <div class="mini-bar"></div>
          </div>
        `;
      })
      .join('');

    const otherPct = Math.max(0, 100 - chatPct - inlinePct - bgPct);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
  <style>
    :root {
      --mono: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace;
      --fg: var(--vscode-foreground, #d4d4d4);
      --bg: var(--vscode-sideBar-background, var(--vscode-editor-background, #1e1e1e));
      --accent: var(--vscode-charts-blue, #4fc1ff);
      --muted: color-mix(in srgb, currentColor 55%, transparent);
      --faint: color-mix(in srgb, currentColor 28%, transparent);
      --hair: color-mix(in srgb, currentColor 14%, transparent);
      --hair-strong: color-mix(in srgb, currentColor 22%, transparent);

      --c-chat: #4fc1ff;
      --c-inline: #c586c0;
      --c-bg: #6a9955;
      --c-other: #808080;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      padding: 0;
      background: transparent;
    }

    body {
      font-family: var(--mono);
      font-size: 12px;
      color: var(--fg);
      padding: 14px 14px 28px;
      line-height: 1.5;
      font-feature-settings: "ss01", "cv02";
      background:
        radial-gradient(120% 40% at 50% -10%, color-mix(in srgb, var(--accent) 9%, transparent), transparent 60%),
        repeating-linear-gradient(0deg, transparent 0 23px, color-mix(in srgb, currentColor 3%, transparent) 23px 24px);
    }

    ::selection { background: color-mix(in srgb, var(--accent) 35%, transparent); }

    /* ─── REVEAL ─── */
    .reveal {
      opacity: 0;
      transform: translateY(6px);
      animation: reveal 0.55s cubic-bezier(0.2, 0.85, 0.25, 1) forwards;
      animation-delay: calc(var(--i, 0) * 55ms);
    }
    @keyframes reveal { to { opacity: 1; transform: none; } }

    /* ─── HEADER ─── */
    .head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 10px;
      margin-bottom: 14px;
      border-bottom: 1px dashed var(--hair-strong);
    }
    .head-title {
      display: flex;
      align-items: center;
      gap: 9px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.22em;
      text-transform: uppercase;
    }
    .head-title::before {
      content: '';
      width: 7px; height: 7px;
      background: var(--accent);
      box-shadow: 0 0 10px var(--accent);
      animation: pulse 2.4s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.45; transform: scale(0.85); }
    }
    .head-meta {
      font-size: 9px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--muted);
    }
    .gh-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border: 1px solid var(--hair-strong);
      font-size: 9px;
      letter-spacing: 0.1em;
      color: var(--fg);
    }
    .gh-badge.gh-none {
      color: var(--faint);
      border-color: var(--hair);
    }
    .gh-badge.gh-connect {
      color: var(--accent);
      border-color: color-mix(in srgb, var(--accent) 38%, transparent);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
    }
    .gh-badge.gh-connect:hover {
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      border-color: var(--accent);
    }

    /* ─── PROJECT ROW ─── */
    .project-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 20px;
    }
    .project-row label {
      font-size: 9px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--muted);
      font-weight: 500;
    }
    .project-row input {
      flex: 1;
      min-width: 0;
      font-family: var(--mono);
      font-size: 11px;
      background: transparent;
      color: var(--fg);
      border: none;
      border-bottom: 1px solid var(--hair-strong);
      padding: 4px 0;
      outline: none;
      letter-spacing: 0.02em;
      transition: border-color 0.2s, color 0.2s;
    }
    .project-row input::placeholder {
      color: var(--faint);
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.15em;
    }
    .project-row input:focus {
      border-bottom-color: var(--accent);
    }
    .project-row button {
      font-family: var(--mono);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      background: transparent;
      color: var(--accent);
      border: 1px solid color-mix(in srgb, var(--accent) 38%, transparent);
      padding: 4px 12px;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.1s;
    }
    .project-row button:hover {
      background: color-mix(in srgb, var(--accent) 14%, transparent);
      border-color: var(--accent);
    }
    .project-row button:active { transform: translateY(1px); }

    /* ─── TAG PILLS ─── */
    .tag-field {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      padding: 3px 0;
      min-height: 24px;
      border-bottom: 1px solid var(--hair-strong);
      transition: border-color 0.2s;
      cursor: text;
    }
    .tag-field:focus-within { border-bottom-color: var(--accent); }
    .project-row .tag-field input {
      flex: 1;
      min-width: 60px;
      width: auto;
      border: none;
      border-bottom: none;
      padding: 2px 0;
      background: transparent;
      font: inherit;
      font-family: var(--mono);
      font-size: 11px;
      color: var(--fg);
      outline: none;
      letter-spacing: 0.02em;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 0;
      font-family: var(--mono);
      font-size: 10px;
      letter-spacing: 0.04em;
      padding: 2px 10px;
      border: 1px solid color-mix(in srgb, var(--accent) 42%, transparent);
      border-radius: 999px;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 10%, transparent);
      user-select: none;
      animation: pill-in 0.22s cubic-bezier(0.2, 0.85, 0.25, 1);
      transition: background 0.15s, border-color 0.15s, padding 0.18s ease;
    }
    .pill:hover,
    .pill:focus-within {
      background: color-mix(in srgb, var(--accent) 18%, transparent);
      border-color: var(--accent);
      padding-right: 4px;
    }
    .pill-x {
      display: none;
      align-items: center;
      justify-content: center;
      font-family: var(--mono);
      width: 14px;
      height: 14px;
      margin-left: 6px;
      padding: 0;
      border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
      border-radius: 50%;
      background: transparent;
      color: color-mix(in srgb, var(--accent) 75%, transparent);
      font-size: 11px;
      line-height: 1;
      cursor: pointer;
      box-sizing: border-box;
      transition: color 0.15s, border-color 0.15s, background 0.15s;
    }
    .pill:hover .pill-x,
    .pill:focus-within .pill-x {
      display: inline-flex;
    }
    .pill .pill-x:hover {
      color: #fff;
      background: #f44747;
      border-color: #f44747;
    }
    .pill.pill-out {
      animation: pill-out 0.18s cubic-bezier(0.4, 0, 1, 1) forwards;
    }
    @keyframes pill-in {
      from { opacity: 0; transform: scale(0.82); }
      to { opacity: 1; transform: none; }
    }
    @keyframes pill-out {
      to { opacity: 0; transform: scale(0.82); }
    }

    /* ─── SUBMIT ROW ─── */
    .submit-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 20px;
      padding-top: 4px;
    }
    .submit-btn {
      font-family: var(--mono);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      background: color-mix(in srgb, var(--accent) 10%, transparent);
      color: var(--accent);
      border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
      padding: 6px 14px;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.1s;
    }
    .submit-btn:hover {
      background: color-mix(in srgb, var(--accent) 22%, transparent);
      border-color: var(--accent);
    }
    .submit-btn:active { transform: translateY(1px); }
    .submit-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .settings-btn {
      font-family: var(--mono);
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      background: color-mix(in srgb, var(--fg) 8%, transparent);
      color: var(--fg);
      border: 1px solid color-mix(in srgb, var(--fg) 30%, transparent);
      padding: 6px 14px;
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s, transform 0.1s;
    }
    .settings-btn:hover {
      background: color-mix(in srgb, var(--fg) 18%, transparent);
      border-color: var(--fg);
    }
    .settings-btn:active { transform: translateY(1px); }
    .submit-status {
      font-size: 9px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .submit-status.ok { color: var(--c-bg); }
    .submit-status.err { color: #f44747; }

    /* ─── TOTAL ─── */
    .total {
      position: relative;
      padding: 18px 16px 16px;
      margin-bottom: 22px;
      border: 1px solid var(--hair-strong);
      background:
        linear-gradient(170deg, color-mix(in srgb, var(--accent) 7%, transparent) 0%, transparent 65%);
    }
    .total::before,
    .total::after {
      content: '';
      position: absolute;
      width: 12px; height: 12px;
      border: 1px solid var(--accent);
    }
    .total::before { top: -1px; left: -1px; border-right: none; border-bottom: none; }
    .total::after  { bottom: -1px; right: -1px; border-left: none; border-top: none; }

    .total-label {
      font-size: 9px;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .total-label::after {
      content: '';
      flex: 1;
      height: 1px;
      background: linear-gradient(90deg, var(--hair), transparent);
    }
    .total-value {
      font-size: 40px;
      font-weight: 300;
      line-height: 1;
      letter-spacing: -0.025em;
      font-variant-numeric: tabular-nums;
      margin: 4px 0 12px;
    }
    .total-sub {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 16px;
      font-size: 10px;
      color: var(--muted);
      letter-spacing: 0.04em;
    }
    .total-sub b {
      color: var(--fg);
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    .total-sub .k {
      font-size: 8px;
      letter-spacing: 0.2em;
      text-transform: uppercase;
      color: var(--faint);
      margin-right: 4px;
    }

    /* ─── SECTION HEADING ─── */
    .section-h {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 9px;
      font-weight: 600;
      letter-spacing: 0.24em;
      text-transform: uppercase;
      color: var(--muted);
      margin: 22px 0 10px;
    }
    .section-h::before {
      content: '◢';
      color: var(--accent);
      font-size: 7px;
    }
    .section-h::after {
      content: '';
      flex: 1;
      height: 1px;
      background: linear-gradient(90deg, var(--hair), transparent);
    }

    /* ─── DISTRIBUTION ─── */
    .dist-bar {
      display: flex;
      height: 5px;
      background: color-mix(in srgb, currentColor 7%, transparent);
      margin-bottom: 10px;
      overflow: hidden;
    }
    .dist-bar > span {
      width: 0;
      transition: width 0.85s cubic-bezier(0.2, 0.85, 0.25, 1);
      transition-delay: 0.25s;
    }
    .dist-legend {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 14px;
      font-size: 9px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      color: var(--muted);
      margin-bottom: 18px;
    }
    .dist-legend span {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .dist-legend i {
      width: 7px; height: 7px;
      background: var(--c);
      display: inline-block;
    }
    .dist-legend b {
      color: var(--fg);
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }

    /* ─── TYPE STRIPS ─── */
    .strips { margin-bottom: 8px; }
    .strip {
      display: grid;
      grid-template-columns: 3px 1fr auto;
      gap: 12px;
      align-items: center;
      padding: 10px 4px 10px 0;
      border-bottom: 1px dotted var(--hair);
      transition: background 0.15s;
    }
    .strip:last-of-type { border-bottom: none; }
    .strip:hover { background: color-mix(in srgb, currentColor 4%, transparent); }
    .strip-bar {
      align-self: stretch;
      background: var(--c);
      box-shadow: 0 0 6px color-mix(in srgb, var(--c) 50%, transparent);
    }
    .strip-title {
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.03em;
    }
    .strip-meta {
      display: flex;
      gap: 10px;
      font-size: 9px;
      color: var(--muted);
      letter-spacing: 0.08em;
      margin-top: 3px;
      text-transform: uppercase;
    }
    .strip-meta b {
      color: var(--fg);
      font-weight: 500;
      font-variant-numeric: tabular-nums;
    }
    .strip-value {
      text-align: right;
      font-size: 16px;
      font-weight: 400;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.015em;
    }
    .strip-unit {
      font-size: 9px;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      color: var(--muted);
      margin-left: 3px;
    }
    .billable-tag, .free-tag {
      font-size: 8px;
      letter-spacing: 0.12em;
      padding: 1px 5px;
      margin-left: 6px;
      vertical-align: middle;
    }
    .billable-tag {
      color: #f5a623;
      border: 1px solid color-mix(in srgb, #f5a623 45%, transparent);
      background: color-mix(in srgb, #f5a623 8%, transparent);
    }
    .free-tag {
      color: #6a9955;
      border: 1px solid color-mix(in srgb, #6a9955 45%, transparent);
      background: color-mix(in srgb, #6a9955 8%, transparent);
    }

    /* ─── DATA LIST ─── */
    .data-list { margin-bottom: 4px; }
    .data-item {
      padding: 7px 0 9px;
      border-bottom: 1px dotted var(--hair);
    }
    .data-item:last-child { border-bottom: none; }
    .data-line {
      display: grid;
      grid-template-columns: 22px 1fr auto auto;
      gap: 10px;
      align-items: baseline;
      font-size: 11px;
    }
    .data-item .rank {
      font-size: 9px;
      color: var(--faint);
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.05em;
    }
    .data-item .name,
    .data-item .day {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      letter-spacing: 0.02em;
    }
    .data-item .day {
      font-size: 10px;
      color: var(--muted);
      letter-spacing: 0.08em;
    }
    .data-item .reqs {
      text-align: right;
      font-size: 10px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
      min-width: 26px;
    }
    .data-item .reqs::after {
      content: ' R';
      font-size: 8px;
      letter-spacing: 0.15em;
      color: var(--faint);
    }
    .data-item .tokens {
      text-align: right;
      font-variant-numeric: tabular-nums;
      min-width: 64px;
      font-weight: 400;
    }
    .data-item .mini-bar {
      margin-top: 6px;
      height: 2px;
      background: color-mix(in srgb, currentColor 7%, transparent);
      position: relative;
      overflow: hidden;
    }
    .data-item .mini-bar::after {
      content: '';
      position: absolute;
      inset: 0;
      width: var(--w, 0%);
      background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 40%, transparent));
      transition: width 0.7s cubic-bezier(0.2, 0.85, 0.25, 1);
      transition-delay: 0.35s;
      animation: mini-bar-grow 0s linear forwards;
    }

    /* ─── EMPTY ─── */
    .empty {
      text-align: center;
      padding: 36px 14px;
      border: 1px dashed var(--hair-strong);
      color: var(--muted);
      font-size: 10px;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .empty span {
      display: block;
      margin-top: 6px;
      color: var(--faint);
      font-size: 9px;
      letter-spacing: 0.1em;
    }

    /* ─── TABS ─── */
    .tabs {
      display: flex;
      gap: 0;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--hair-strong);
    }
    .tab-btn {
      font-family: var(--mono);
      font-size: 10px;
      font-weight: 500;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      background: transparent;
      color: var(--muted);
      border: none;
      padding: 8px 16px 10px;
      cursor: pointer;
      position: relative;
      transition: color 0.2s;
    }
    .tab-btn:hover { color: var(--fg); }
    .tab-btn.active {
      color: var(--accent);
    }
    .tab-btn.active::after {
      content: '';
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--accent);
    }
    .tab-panel { display: none; }
    .tab-panel.active { display: block; }

    /* ─── MULTIPLIER ─── */
    .mult {
      font-size: 9px;
      letter-spacing: 0.08em;
      padding: 1px 5px;
      color: #f5a623;
      border: 1px solid color-mix(in srgb, #f5a623 35%, transparent);
      background: color-mix(in srgb, #f5a623 6%, transparent);
      font-variant-numeric: tabular-nums;
    }
    .mult.low {
      color: var(--c-bg);
      border-color: color-mix(in srgb, var(--c-bg) 35%, transparent);
      background: color-mix(in srgb, var(--c-bg) 6%, transparent);
    }
  </style>
</head>
<body>
  <header class="head reveal" style="--i:0">
    <div class="head-title">Copilot · Usage</div>
    <div class="head-meta">${ghAccount ? `<span class="gh-badge" title="GitHub: ${ghAccount.label}">⬡ ${ghAccount.label}</span>` : '<span class="gh-badge gh-connect" id="connectGh" title="Click to connect GitHub">⬡ Connect GitHub</span>'}</div>
  </header>

  <div class="project-row reveal" style="--i:1">
    <label for="projectInput">Project</label>
    <input type="text" id="projectInput" value="${tag}" placeholder="project name" autocomplete="off" spellcheck="false" />
  </div>

  <div class="project-row reveal" style="--i:1">
    <label for="tagsInput">Tags</label>
    <div class="tag-field" id="tagField">
      <input type="text" id="tagsInput" placeholder="add tag…" autocomplete="off" spellcheck="false" />
    </div>
  </div>

  <div class="project-row reveal" style="--i:1">
    <label for="costInput">Cost Ctr</label>
    <input type="text" id="costInput" value="${costCenter}" placeholder="cost center code" autocomplete="off" spellcheck="false" />
    <button id="saveAll">Save</button>
  </div>

  <div class="submit-row reveal" style="--i:1">
    <button id="submitReport" class="submit-btn">▶ Submit Report</button>
    <button id="openSettings" class="settings-btn">⚙ Settings</button>
    <span id="submitStatus" class="submit-status"></span>
  </div>

  <!-- TABS -->
  <div class="tabs reveal" style="--i:2">
    <button class="tab-btn active" data-tab="credits">Credits</button>
    <button class="tab-btn" data-tab="tokens">Tokens</button>
  </div>

  <!-- ═══ CREDITS TAB ═══ -->
  <div class="tab-panel active" id="tab-credits">

  <!-- TOTAL -->
  <div class="total reveal" style="--i:2">
    <div class="total-label">AI Credits Used</div>
    <div class="total-value" id="totalValue" data-target="${creditsDisplay}">${creditsDisplay}</div>
    <div class="total-sub">
      <span><span class="k">Req</span><b>${summary.totalRequests.toLocaleString()}</b></span>
      <span><span class="k">Billable</span><b>${(summary.billableRequests || 0).toLocaleString()}</b></span>
      <span><span class="k">Cost</span><b>$${(totalCredits * 0.01).toFixed(2)}</b></span>
    </div>
  </div>

  <!-- DISTRIBUTION -->
  <div class="reveal" style="--i:3">
    <div class="section-h">Distribution</div>
    <div class="dist-bar" id="distBar">
      ${chatPct > 0 ? `<span data-w="${chatPct}" style="background: var(--c-chat)" title="Chat ${chatPct}%"></span>` : ''}
      ${inlinePct > 0 ? `<span data-w="${inlinePct}" style="background: var(--c-inline)" title="Inline ${inlinePct}%"></span>` : ''}
      ${bgPct > 0 ? `<span data-w="${bgPct}" style="background: var(--c-bg)" title="Background ${bgPct}%"></span>` : ''}
      ${otherPct > 0 && totalOther > 0 ? `<span data-w="${otherPct}" style="background: var(--c-other)" title="Other"></span>` : ''}
    </div>
    <div class="dist-legend">
      <span style="--c: var(--c-chat)"><i></i>Chat <b>${chatPct}%</b></span>
      <span style="--c: var(--c-inline)"><i></i>Inline <b>${inlinePct}%</b></span>
      <span style="--c: var(--c-bg)"><i></i>BG <b>${bgPct}%</b></span>
      ${totalOther > 0 ? `<span style="--c: var(--c-other)"><i></i>Other <b>${otherPct}%</b></span>` : ''}
    </div>
  </div>

  <!-- TYPE STRIPS -->
  <div class="strips">
    <div class="strip reveal" style="--c: var(--c-chat); --i:4">
      <div class="strip-bar"></div>
      <div>
        <div class="strip-title">Chat / Agent <span class="billable-tag">BILLED</span></div>
        <div class="strip-meta">
          <span><b>${chatStats.requests}</b> reqs</span>
          <span><b>${chatStats.inputTokens.toLocaleString()}</b> in</span>
          <span><b>${chatStats.outputTokens.toLocaleString()}</b> out</span>
        </div>
      </div>
      <div class="strip-value">${chatStats.aiCredits < 10 ? chatStats.aiCredits.toFixed(2) : chatStats.aiCredits.toFixed(1)}<span class="strip-unit">cr</span></div>
    </div>

    <div class="strip reveal" style="--c: var(--c-inline); --i:5">
      <div class="strip-bar"></div>
      <div>
        <div class="strip-title">Inline / NES <span class="free-tag">FREE</span></div>
        <div class="strip-meta">
          <span><b>${inlineStats.requests}</b> reqs</span>
          <span><b>${inlineStats.inputTokens.toLocaleString()}</b> in</span>
          <span><b>${inlineStats.outputTokens.toLocaleString()}</b> out</span>
        </div>
      </div>
      <div class="strip-value">${totalInline.toLocaleString()}<span class="strip-unit">tok</span></div>
    </div>

    <div class="strip reveal" style="--c: var(--c-bg); --i:6">
      <div class="strip-bar"></div>
      <div>
        <div class="strip-title">Background <span class="billable-tag">BILLED</span></div>
        <div class="strip-meta">
          <span><b>${backgroundStats.requests}</b> reqs</span>
          <span><b>${backgroundStats.inputTokens.toLocaleString()}</b> in</span>
          <span><b>${backgroundStats.outputTokens.toLocaleString()}</b> out</span>
        </div>
      </div>
      <div class="strip-value">${backgroundStats.aiCredits < 10 ? backgroundStats.aiCredits.toFixed(2) : backgroundStats.aiCredits.toFixed(1)}<span class="strip-unit">cr</span></div>
    </div>

    ${totalOther > 0 ? `
    <div class="strip reveal" style="--c: var(--c-other); --i:7">
      <div class="strip-bar"></div>
      <div>
        <div class="strip-title">Other <span class="billable-tag">BILLED</span></div>
        <div class="strip-meta">
          <span><b>${otherStats.requests}</b> reqs</span>
          <span><b>${otherStats.inputTokens.toLocaleString()}</b> in</span>
          <span><b>${otherStats.outputTokens.toLocaleString()}</b> out</span>
        </div>
      </div>
      <div class="strip-value">${otherStats.aiCredits < 10 ? otherStats.aiCredits.toFixed(2) : otherStats.aiCredits.toFixed(1)}<span class="strip-unit">cr</span></div>
    </div>` : ''}
  </div>

  ${modelRows ? `
  <div class="reveal" style="--i:8">
    <div class="section-h">By Model</div>
    <div class="data-list">
      ${modelRows}
    </div>
  </div>` : ''}

  ${days ? `
  <div class="reveal" style="--i:9">
    <div class="section-h">Last 7 Days</div>
    <div class="data-list">
      ${days}
    </div>
  </div>` : ''}

  ${!modelRows && !days ? `
  <div class="empty reveal" style="--i:4">
    No Usage Yet
    <span>Trigger Copilot to populate this panel</span>
  </div>` : ''}

  </div><!-- /tab-credits -->

  <!-- ═══ TOKENS TAB ═══ -->
  <div class="tab-panel" id="tab-tokens">

  <div class="total reveal" style="--i:2">
    <div class="total-label">Total Tokens</div>
    <div class="total-value">${(summary.totalTokens || 0).toLocaleString()}</div>
    <div class="total-sub">
      <span><span class="k">Input</span><b>${(summary.totalInputTokens || 0).toLocaleString()}</b></span>
      <span><span class="k">Output</span><b>${(summary.totalOutputTokens || 0).toLocaleString()}</b></span>
      <span><span class="k">Cached</span><b>${(summary.totalCachedTokens || 0).toLocaleString()}</b></span>
      <span><span class="k">Billable</span><b>${(summary.billableTokens || 0).toLocaleString()}</b></span>
      <span><span class="k">Free</span><b>${(summary.nonBillableTokens || 0).toLocaleString()}</b></span>
    </div>
  </div>

  <!-- TYPE STRIPS (token view) -->
  <div class="strips">
    <div class="strip reveal" style="--c: var(--c-chat); --i:4">
      <div class="strip-bar"></div>
      <div>
        <div class="strip-title">Chat / Agent</div>
        <div class="strip-meta">
          <span><b>${chatStats.requests}</b> reqs</span>
          <span><b>${chatStats.inputTokens.toLocaleString()}</b> in</span>
          <span><b>${chatStats.outputTokens.toLocaleString()}</b> out</span>
          <span><b>${chatStats.cachedTokens.toLocaleString()}</b> cached</span>
        </div>
      </div>
      <div class="strip-value">${totalChat.toLocaleString()}<span class="strip-unit">tok</span></div>
    </div>

    <div class="strip reveal" style="--c: var(--c-inline); --i:5">
      <div class="strip-bar"></div>
      <div>
        <div class="strip-title">Inline / NES</div>
        <div class="strip-meta">
          <span><b>${inlineStats.requests}</b> reqs</span>
          <span><b>${inlineStats.inputTokens.toLocaleString()}</b> in</span>
          <span><b>${inlineStats.outputTokens.toLocaleString()}</b> out</span>
          <span><b>${(inlineStats.cachedTokens || 0).toLocaleString()}</b> cached</span>
        </div>
      </div>
      <div class="strip-value">${totalInline.toLocaleString()}<span class="strip-unit">tok</span></div>
    </div>

    <div class="strip reveal" style="--c: var(--c-bg); --i:6">
      <div class="strip-bar"></div>
      <div>
        <div class="strip-title">Background</div>
        <div class="strip-meta">
          <span><b>${backgroundStats.requests}</b> reqs</span>
          <span><b>${backgroundStats.inputTokens.toLocaleString()}</b> in</span>
          <span><b>${backgroundStats.outputTokens.toLocaleString()}</b> out</span>
          <span><b>${(backgroundStats.cachedTokens || 0).toLocaleString()}</b> cached</span>
        </div>
      </div>
      <div class="strip-value">${totalBackground.toLocaleString()}<span class="strip-unit">tok</span></div>
    </div>
  </div>

  ${tokenModelRows ? `
  <div class="reveal" style="--i:8">
    <div class="section-h">By Model (with multiplier)</div>
    <div class="data-list">
      ${tokenModelRows}
    </div>
  </div>` : ''}

  ${tokenDays ? `
  <div class="reveal" style="--i:9">
    <div class="section-h">Last 7 Days</div>
    <div class="data-list">
      ${tokenDays}
    </div>
  </div>` : ''}

  ${!tokenModelRows && !tokenDays ? `
  <div class="empty reveal" style="--i:4">
    No Usage Yet
    <span>Trigger Copilot to populate this panel</span>
  </div>` : ''}

  </div><!-- /tab-tokens -->

  <script>
    const vscode = acquireVsCodeApi();
    const projectInput = document.getElementById('projectInput');
    const tagsInput = document.getElementById('tagsInput');
    const tagField = document.getElementById('tagField');
    const costInput = document.getElementById('costInput');
    const saveBtn = document.getElementById('saveAll');

    let currentTags = ${JSON.stringify(tags).replace(/</g, '\\u003c')};

    function saveAll() {
      vscode.postMessage({
        command: 'saveAll',
        project: projectInput.value.trim(),
        tags: currentTags.join(','),
        costCenter: costInput.value.trim(),
      });
      if (saveBtn) {
        saveBtn.textContent = 'Saved';
        setTimeout(() => { saveBtn.textContent = 'Save'; }, 1200);
      }
    }
    if (saveBtn) saveBtn.addEventListener('click', saveAll);
    [projectInput, costInput].forEach(el => {
      if (el) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') saveAll(); });
    });

    // ── TAG PILLS ──
    function renderTags() {
      tagField.querySelectorAll('.pill').forEach(p => p.remove());
      currentTags.forEach(t => {
        const pill = document.createElement('span');
        pill.className = 'pill';
        pill.dataset.tag = t;
        pill.appendChild(document.createTextNode(t));
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'pill-x';
        x.textContent = '×';
        x.setAttribute('aria-label', 'Remove ' + t);
        x.addEventListener('click', (e) => {
          e.stopPropagation();
          pill.classList.add('pill-out');
          setTimeout(() => {
            currentTags = currentTags.filter(v => v !== t);
            renderTags();
            saveAll();
          }, 160);
        });
        pill.appendChild(x);
        tagField.insertBefore(pill, tagsInput);
      });
      tagsInput.placeholder = currentTags.length ? '' : 'add tag…';
    }

    function commitTag() {
      const raw = tagsInput.value;
      const parts = raw.split(/[\\s,]+/).map(s => s.trim()).filter(Boolean);
      let added = false;
      for (const p of parts) {
        if (!currentTags.includes(p)) {
          currentTags.push(p);
          added = true;
        }
      }
      tagsInput.value = '';
      if (added) renderTags();
      return added;
    }

    if (tagsInput && tagField) {
      tagsInput.addEventListener('keydown', (e) => {
        if (e.key === ' ' || e.key === 'Enter' || e.key === ',') {
          if (tagsInput.value.trim()) {
            e.preventDefault();
            if (commitTag()) saveAll();
          } else if (e.key === 'Enter') {
            saveAll();
          } else if (e.key === ' ' || e.key === ',') {
            e.preventDefault();
          }
        } else if (e.key === 'Backspace' && tagsInput.value === '' && currentTags.length) {
          e.preventDefault();
          const last = tagField.querySelector('.pill:last-of-type');
          if (last) {
            last.classList.add('pill-out');
            setTimeout(() => {
              currentTags.pop();
              renderTags();
              saveAll();
            }, 160);
          }
        }
      });
      tagsInput.addEventListener('blur', () => {
        if (tagsInput.value.trim()) {
          if (commitTag()) saveAll();
        }
      });
      tagField.addEventListener('click', (e) => {
        if (e.target === tagField) tagsInput.focus();
      });
      renderTags();
    }

    // Connect GitHub button
    const connectGh = document.getElementById('connectGh');
    if (connectGh) connectGh.addEventListener('click', () => {
      vscode.postMessage({ command: 'connectGitHub' });
    });

    // Open settings
    const settingsBtn = document.getElementById('openSettings');
    if (settingsBtn) settingsBtn.addEventListener('click', () => {
      vscode.postMessage({ command: 'openSettings' });
    });

    // Submit to report server
    const submitBtn = document.getElementById('submitReport');
    const submitStatus = document.getElementById('submitStatus');
    if (submitBtn) submitBtn.addEventListener('click', () => {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Sending...';
      submitStatus.textContent = '';
      submitStatus.className = 'submit-status';
      vscode.postMessage({ command: 'submitReport' });
    });

    // Listen for submit result
    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.command === 'submitResult') {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '▶ Submit Report'; }
        if (submitStatus) {
          if (msg.success) {
            submitStatus.textContent = '✓ Sent';
            submitStatus.className = 'submit-status ok';
          } else {
            submitStatus.textContent = '✗ ' + (msg.error || 'Failed');
            submitStatus.className = 'submit-status err';
          }
          setTimeout(() => { submitStatus.textContent = ''; }, 4000);
        }
      }
    });

    // Animate distribution bar widths after mount
    requestAnimationFrame(() => {
      document.querySelectorAll('#distBar > span').forEach(el => {
        const w = el.getAttribute('data-w');
        if (w) el.style.width = w + '%';
      });
    });

    // Count-up animation for the total value
    const totalEl = document.getElementById('totalValue');
    if (totalEl) {
      const target = Number(totalEl.getAttribute('data-target') || '0');
      if (target > 0) {
        const start = performance.now();
        const dur = 850;
        const fmt = new Intl.NumberFormat('en-US');
        const ease = (t) => 1 - Math.pow(1 - t, 3);
        const step = (now) => {
          const t = Math.min(1, (now - start) / dur);
          const v = Math.round(ease(t) * target);
          totalEl.textContent = fmt.format(v);
          if (t < 1) requestAnimationFrame(step);
        };
        totalEl.textContent = '0';
        requestAnimationFrame(step);
      }
    }

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const panel = document.getElementById('tab-' + btn.getAttribute('data-tab'));
        if (panel) panel.classList.add('active');
      });
    });
  </script>
</body>
</html>`;
  }
}
