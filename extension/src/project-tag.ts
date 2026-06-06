import * as vscode from 'vscode';
import { execSync } from 'child_process';

/**
 * Get the project tag for the current workspace.
 * Priority: config setting > git remote > workspace folder name
 */
export function getProjectTag(): string {
  const config = vscode.workspace.getConfiguration('wingman');
  const configTag = config.get<string>('project', '');

  if (configTag) {
    return configTag;
  }

  // Try git remote name (org/repo)
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceFolder) {
    try {
      const remote = execSync('git remote get-url origin', {
        cwd: workspaceFolder,
        encoding: 'utf-8',
      }).trim();

      // Parse org/repo from git URL
      const match = remote.match(/[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
      if (match) {
        return `${match[1]}/${match[2]}`;
      }
    } catch {
      // Not a git repo or no remote
    }
  }

  // Fall back to workspace folder name
  return vscode.workspace.workspaceFolders?.[0]?.name || 'unknown-project';
}
