<p align="center">
  <img src="assets/wingman-ai.png" alt="Wingman" width="200" />
</p>


# Copilot Wingman — Project Tracking

Track GitHub Copilot AI token usage per VS Code workspace/project. Attribute costs to users, projects, and cost centers with a real-time activity bar panel.

## Installation

This extension is **not published to the VS Code Marketplace**. Install it by sideloading the `.vsix` file:

1. Download the latest `.vsix` from [GitHub Releases](https://github.com/garethcheyne/copilot-wingman-project-tracking/releases)
2. In VS Code, open the Command Palette (`Ctrl+Shift+P`) and run **Extensions: Install from VSIX...**
3. Select the downloaded `.vsix` file
4. Reload VS Code when prompted

## Extension

The VS Code extension intercepts Copilot API traffic, counts tokens, calculates AI credits using GitHub's model multipliers, and stores usage locally per-user.

**Key features:**
- Per-user tracking — each developer gets their own `.vscode/copilot-usage-{username}.json`
- Activity bar panel with live token counts, model breakdown, and credit usage
- GitHub account linking
- Project tagging with cost centers and labels
- Optional reporting to a central server

See [extension/README.md](extension/README.md) for full settings, commands, and configuration.

## Backends (Coming Soon)

> **Work in Progress** — backend services are under active development and not yet available.

Optional backends for aggregating usage data from multiple users/projects into a central database for reporting.

### Azure Cosmos DB (Serverless)

Azure Functions + Cosmos DB with Entra ID authentication. Serverless — scales to zero, pay-per-use.

### Docker

Self-hosted option with PostgreSQL for teams that prefer on-premise.

## How It Works

1. Extension runs locally in VS Code, intercepting Copilot API responses
2. Token counts are logged to a per-user JSON file in `.vscode/`
3. The panel shows real-time usage breakdown by model, day, and request type
4. Optionally, usage is pushed to a central API for org-wide reporting

## Per-User Files

Usage files are named by git username: `.vscode/copilot-usage-gareth-cheyne.json`

This means multiple developers on the same repo each get their own file — safe to commit for shared visibility, or gitignore for privacy.

## Part of the Copilot Wingman Family

This project is part of the **Copilot Wingman** family — a suite of tools that extend GitHub Copilot beyond the editor.

| Project | Description |
|---------|-------------|
| [Copilot Wingman](https://github.com/garethcheyne/copilot-wingman) | Self-hosted AI proxy & chat UI powered by your GitHub Copilot subscription |
| **Copilot Wingman Project Tracking** (this repo) | VS Code extension for per-user, per-project AI token usage tracking and cost attribution |

## License

MIT
