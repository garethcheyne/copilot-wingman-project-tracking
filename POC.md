# POC: Copilot Token Usage Reporting by VS Code Project

## Purpose
A VS Code extension that intercepts Copilot API traffic via a local proxy, counts tokens (using the same tiktoken approach proven in copilot-wingman), tags usage with the current VS Code workspace/project, and stores it locally in `.vscode/copilot-usage.json` per project. Later this can be reported to an external database.

## How It Works

We know from [copilot-wingman](C:\Apps\Projects\WebSites\copilot-wingman) that Copilot API requests can be intercepted and token-counted accurately using tiktoken. This extension applies the same technique directly within VS Code.

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  VS Code                                                 │
│                                                          │
│  ┌──────────────┐     ┌──────────────┐                  │
│  │   Copilot    │────▶│  Local Proxy │─────────────────▶ GitHub Copilot API
│  │  Extension   │     │  (Extension) │                   │
│  └──────────────┘     └──────┬───────┘                  │
│                              │                           │
│                              │ count tokens              │
│                              ▼                           │
│  ┌──────────────┐     ┌─────────────────┐               │
│  │  Activity Bar│◀────│ Usage Tracker   │               │
│  │  Panel (UI)  │     │                 │               │
│  └──────────────┘     └────────┬────────┘               │
│                                │                         │
│                                ▼                         │
│                  .vscode/copilot-usage.json              │
└─────────────────────────────────────────────────────────┘
```

### Flow
1. Extension starts a lightweight local HTTP proxy on activation
2. Configures VS Code's `http.proxy` to route Copilot traffic through it
3. Proxy observes Copilot API requests/responses passing through
4. Counts prompt tokens and completion tokens using tiktoken
5. Tags each request with the current workspace/project name
6. Writes usage data to `.vscode/copilot-usage.json` in the project
7. Activity bar panel shows live token usage stats

## Extension Features

### Commands (Command Palette)
- **Copilot Usage: Show Panel** — focus the usage panel in the activity bar
- **Copilot Usage: Set Project Tag** — override the auto-detected project name
- **Copilot Usage: Reset Usage Data** — clear all tracked data for this project
- **Copilot Usage: Export Usage Data** — open usage data as JSON

### Activity Bar Panel
- Total tokens (prompt + completion)
- Total requests
- Breakdown by model
- Breakdown by day (last 7 days)
- Current project tag shown as badge

### Status Bar
- Shows current project tag and total token count
- Click to change project tag

## Local Storage: `.vscode/copilot-usage.json`

```json
{
  "projectTag": "garethcheyne/my-project",
  "user": "gareth.cheyne",
  "entries": [
    {
      "timestamp": "2026-05-19T10:30:00.000Z",
      "model": "gpt-4o",
      "promptTokens": 1520,
      "completionTokens": 340,
      "totalTokens": 1860,
      "requestType": "chat"
    }
  ],
  "summary": {
    "totalPromptTokens": 45000,
    "totalCompletionTokens": 12000,
    "totalTokens": 57000,
    "totalRequests": 150,
    "byModel": {
      "gpt-4o": { "promptTokens": 30000, "completionTokens": 8000, "requests": 100 },
      "claude-sonnet-4": { "promptTokens": 15000, "completionTokens": 4000, "requests": 50 }
    },
    "byDay": {
      "2026-05-19": { "promptTokens": 5000, "completionTokens": 1200, "requests": 15 }
    }
  }
}
```

## File Structure

```
extension/
├── package.json          # Extension manifest (commands, views, config)
├── tsconfig.json         # TypeScript config
├── .gitignore
├── resources/
│   └── icon.svg          # Activity bar icon
└── src/
    ├── extension.ts      # Entry point, registers commands & starts proxy
    ├── proxy.ts          # Local HTTP proxy that intercepts Copilot traffic
    ├── tokenizer.ts      # Token counting via tiktoken (from Wingman approach)
    ├── usage-tracker.ts  # Reads/writes .vscode/copilot-usage.json
    ├── project-tag.ts    # Auto-detect project tag from git/workspace
    └── views/
        └── usage-panel.ts  # Webview panel for activity bar
```

## Considerations

- **TLS/HTTPS:** Copilot API uses HTTPS. The proxy handles CONNECT tunneling. For full token counting, VS Code's built-in proxy support handles TLS termination before the proxy sees traffic.
- **Performance:** Token counting is fast (tiktoken is native). Proxy adds negligible latency.
- **Privacy:** All data stays local in `.vscode/copilot-usage.json`. No external calls unless user opts in later.
- **Copilot API detection:** Only counts requests to Copilot endpoints (`api.githubcopilot.com`, `copilot-proxy.githubusercontent.com`).

## Next Steps
1. Install dependencies and compile extension
2. Test proxy interception with Copilot traffic
3. Validate token counting accuracy
4. Later: add external database reporting (Phase 2)