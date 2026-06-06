# Wingman — Copilot Project Tracking

Track GitHub Copilot token usage per VS Code workspace/project. Provides a real-time activity bar panel showing token consumption, AI credits, and model breakdown — with optional reporting to a central server.

## Features

- **Per-user tracking** — Usage data stored in `.vscode/copilot-usage-{username}.json`
- **Activity bar panel** — Live token counts, AI credits, model distribution, and request breakdown
- **AI credit calculation** — Uses GitHub's model multipliers to calculate actual AI credit consumption
- **GitHub account linking** — Associates usage with your GitHub/git identity
- **Reporting server** — POST usage summaries to a central endpoint (manual or automatic)
- **Workspace metadata** — Tag projects with cost centres, labels, and custom tags

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
| `wingman.costCenter` | `""` | Cost centre code |

> Project, tags, and cost centre are also editable directly in the Wingman panel and saved to the usage file.

## Report Payload

When submitting to the reporting server (via button or auto mode), the extension POSTs:

```json
{
  "project": "garethcheyne/my-app",
  "tags": ["team-platform", "sprint-42"],
  "costCenter": "CC-4200",
  "user": "gareth",
  "summary": {
    "totalInputTokens": 12450,
    "totalOutputTokens": 8320,
    "totalCachedTokens": 1200,
    "totalTokens": 20770,
    "totalAiCredits": 45.2,
    "totalRequests": 47,
    "billableRequests": 42,
    "billableTokens": 19570,
    "nonBillableTokens": 1200,
    "byModel": {
      "gpt-4o": {
        "inputTokens": 9800,
        "outputTokens": 6500,
        "cachedTokens": 800,
        "aiCredits": 32.1,
        "requests": 32
      },
      "claude-sonnet-4-20250514": {
        "inputTokens": 2650,
        "outputTokens": 1820,
        "cachedTokens": 400,
        "aiCredits": 13.1,
        "requests": 15
      }
    },
    "byDay": {
      "2026-05-19": {
        "inputTokens": 12450,
        "outputTokens": 8320,
        "cachedTokens": 1200,
        "aiCredits": 45.2,
        "requests": 47
      }
    },
    "byType": {
      "chat": {
        "inputTokens": 10200,
        "outputTokens": 7100,
        "cachedTokens": 900,
        "aiCredits": 38.0,
        "requests": 35,
        "billable": true
      },
      "inline": {
        "inputTokens": 2250,
        "outputTokens": 1220,
        "cachedTokens": 300,
        "aiCredits": 7.2,
        "requests": 12,
        "billable": true
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

Usage data is stored per-user at `.vscode/copilot-usage-{username}.json` in your workspace root (username derived from `git config user.name`). This file is safe to commit for shared visibility or gitignore for privacy.
