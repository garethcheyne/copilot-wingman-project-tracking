import * as vscode from 'vscode';
import { UsageTracker } from './usage-tracker';
import { UsagePanelProvider } from './views/usage-panel';
import { NetworkInterceptor } from './interceptor';
import { UsageReporter } from './reporter';
import { getProjectTag } from './project-tag';
import { refreshModelCatalog } from './model-catalog';

let interceptor: NetworkInterceptor | undefined;
let reporter: UsageReporter | undefined;

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration('wingman');
  const enabled = config.get<boolean>('enabled', true);

  if (!enabled) {
    return;
  }

  const tracker = new UsageTracker();
  const panelProvider = new UsagePanelProvider(context.extensionUri, tracker);

  // Register webview panel in activity bar
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('wingman.panel', panelProvider)
  );

  // Command: Show Panel (focus the activity bar view)
  context.subscriptions.push(
    vscode.commands.registerCommand('wingman.showPanel', () => {
      vscode.commands.executeCommand('wingman.panel.focus');
    })
  );

  // Command: Set Project
  context.subscriptions.push(
    vscode.commands.registerCommand('wingman.setProject', async () => {
      const currentTag = getProjectTag();
      const input = await vscode.window.showInputBox({
        prompt: 'Enter a project name for usage tracking',
        value: currentTag,
        placeHolder: 'e.g. my-project, client-x, sprint-42',
      });
      if (input !== undefined) {
        await config.update('project', input, vscode.ConfigurationTarget.Workspace);
        vscode.window.showInformationMessage(`Project set to: ${input || '(auto-detect)'}`);
        panelProvider.refresh();
      }
    })
  );

  // Command: Reset Usage
  context.subscriptions.push(
    vscode.commands.registerCommand('wingman.resetUsage', async () => {
      const confirm = await vscode.window.showWarningMessage(
        'Reset all usage data for this project?',
        { modal: true },
        'Reset'
      );
      if (confirm === 'Reset') {
        await tracker.reset();
        panelProvider.refresh();
        vscode.window.showInformationMessage('Usage data reset.');
      }
    })
  );

  // Command: Export Usage
  context.subscriptions.push(
    vscode.commands.registerCommand('wingman.exportUsage', async () => {
      const data = await tracker.getUsageData();
      const json = JSON.stringify(data, null, 2);
      const doc = await vscode.workspace.openTextDocument({
        content: json,
        language: 'json',
      });
      await vscode.window.showTextDocument(doc);
    })
  );

  // Start network interceptor (patches https.request in the extension host)
  interceptor = new NetworkInterceptor(tracker);
  interceptor.start();

  // Fetch model multipliers from GitHub (non-blocking, falls back to hardcoded)
  refreshModelCatalog();

  // Start usage reporter (posts to reporting server if configured)
  reporter = new UsageReporter(tracker);
  reporter.start();

  // Command: Submit to Report Server
  context.subscriptions.push(
    vscode.commands.registerCommand('wingman.submitReport', async () => {
      if (!reporter) throw new Error('Reporter not initialized');
      await reporter.report();
    })
  );

  // Status bar item showing current project
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBar.command = 'wingman.setProject';
  statusBar.tooltip = 'Copilot Usage: Click to change project';
  context.subscriptions.push(statusBar);

  function updateStatusBar() {
    const tag = getProjectTag();
    const data = tracker.getUsageSummarySync();
    const creditsStr = data.totalAiCredits < 10 ? data.totalAiCredits.toFixed(2) : data.totalAiCredits.toFixed(1);
    statusBar.text = `$(pulse) ${tag}: ${creditsStr} credits`;
    statusBar.show();
  }

  updateStatusBar();
  tracker.onDidChange(() => updateStatusBar());

  // Update status bar when config changes
  vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('wingman')) {
      updateStatusBar();
      panelProvider.refresh();
    }
  });
}

export function deactivate() {
  interceptor?.stop();
  reporter?.stop();
}
