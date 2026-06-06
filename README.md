<p align="center">
  <img src="assets/wingman128.png" alt="Wingman logo" width="128" />
</p>

# Copilot Wingman — Project Tracking

Track GitHub Copilot AI token usage per VS Code workspace/project. Attribute costs to users, projects, and cost centers with a real-time activity bar panel.

## Repository Structure

```
extension/          VS Code extension (published to marketplace)
backends/           Backend API options for central reporting
  azure-cosmos/     Azure Functions + Cosmos DB (serverless)
  docker/           Docker-based self-hosted (coming soon)
assets/             Shared branding and icons
```

## Extension

The VS Code extension intercepts Copilot API traffic, counts tokens, calculates AI credits using GitHub's model multipliers, and stores usage locally per-user.

**Key features:**
- Per-user tracking — each developer gets their own `.vscode/copilot-usage-{username}.json`
- Activity bar panel with live token counts, model breakdown, and credit usage
- GitHub account linking
- Project tagging with cost centers and labels
- Optional reporting to a central server

See [extension/README.md](extension/README.md) for full settings, commands, and configuration.

## Backends

Optional backends for aggregating usage data from multiple users/projects into a central database for reporting.

### Azure Cosmos DB (Serverless)

Azure Functions + Cosmos DB with Entra ID authentication. Serverless — scales to zero, pay-per-use.

See [backends/azure-cosmos/README.md](backends/azure-cosmos/README.md) for setup instructions.

### Docker (Coming Soon)

Self-hosted option with PostgreSQL for teams that prefer on-premise.

## How It Works

1. Extension runs locally in VS Code, intercepting Copilot API responses
2. Token counts are logged to a per-user JSON file in `.vscode/`
3. The panel shows real-time usage breakdown by model, day, and request type
4. Optionally, usage is pushed to a central API for org-wide reporting

## Per-User Files

Usage files are named by git username: `.vscode/copilot-usage-gareth-cheyne.json`

This means multiple developers on the same repo each get their own file — safe to commit for shared visibility, or gitignore for privacy.

## License

MIT
