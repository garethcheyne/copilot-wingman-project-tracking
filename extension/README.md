<p align="center">
  <img src="resources/wingman-ai.png" alt="Wingman logo" width="128" />
</p>

# Wingman — Copilot Project Tracking

Track GitHub Copilot token usage per VS Code workspace/project. Provides a real-time activity bar panel showing token consumption by model and request type, with optional reporting to a central server.

## Features

- **Per-project tracking** — Usage data stored in `.vscode/copilot-usage.json`
- **Activity bar panel** — Live token counts, model distribution, and request breakdown
- **GitHub account linking** — Associates usage with your GitHub identity
- **Reporting server** — POST usage summaries to a central endpoint (manual or automatic)
- **Workspace metadata** — Tag projects with cost centers, labels, and custom tags

## Settings

### Global (User-level)

| Setting | Default | Description |
|---------|---------|-------------|
| `wingman.reportingServer` | `""` | URL to POST usage reports to |
| `wingman.reportingFrequency` | `"manual"` | `"manual"` or `"auto"` |
| `wingman.reportingInterval` | `300` | Seconds between auto-reports (min 30) |
| `wingman.enabled` | `true` | Enable/disable tracking |

### Workspace-level

| Setting | Default | Description |
|---------|---------|-------------|
| `wingman.project` | `""` | Project name (auto-detects from git remote or folder) |
| `wingman.tags` | `[]` | Tags for this workspace |
| `wingman.costCenter` | `""` | Cost center code |

> Project, tags, and cost center are also editable directly in the Wingman panel and saved to `.vscode/copilot-usage.json`.

## Report Payload

When submitting to the reporting server (via button or auto mode), the extension POSTs:

```json
{
  "project": "garethcheyne/my-app",
  "tags": ["team-platform", "sprint-42"],
  "costCenter": "CC-4200",
  "user": "gareth",
  "githubAccount": "garethcheyne",
  "summary": {
    "totalPromptTokens": 12450,
    "totalCompletionTokens": 8320,
    "totalTokens": 20770,
    "totalRequests": 47,
    "byModel": {
      "gpt-4o": {
        "promptTokens": 9800,
        "completionTokens": 6500,
        "requests": 32
      },
      "claude-sonnet-4-20250514": {
        "promptTokens": 2650,
        "completionTokens": 1820,
        "requests": 15
      }
    },
    "byDay": {
      "2026-05-19": {
        "promptTokens": 12450,
        "completionTokens": 8320,
        "requests": 47
      }
    },
    "byType": {
      "chat": {
        "promptTokens": 10200,
        "completionTokens": 7100,
        "requests": 35
      },
      "completions": {
        "promptTokens": 2250,
        "completionTokens": 1220,
        "requests": 12
      }
    }
  },
  "reportedAt": "2026-05-19T14:30:00.000Z"
}
```

## Commands

| Command | Description |
|---------|-------------|
| `Wingman: Show Panel` | Focus the activity bar panel |
| `Wingman: Set Project` | Set the project name for this workspace |
| `Wingman: Reset Usage Data` | Clear all tracked data |
| `Wingman: Export Usage Data` | Open raw usage JSON in editor |
| `Wingman: Submit Report` | POST current usage to reporting server |

## Data Storage

Usage data is stored at `.vscode/copilot-usage.json` in your workspace root. This file is safe to commit or gitignore depending on your preference.
