import * as http from 'http';
import * as zlib from 'zlib';
import { UsageTracker } from './usage-tracker';

function tryDecompress(buffer: Buffer): string {
  try { return zlib.gunzipSync(buffer).toString('utf-8'); } catch {}
  try { return zlib.inflateSync(buffer).toString('utf-8'); } catch {}
  try { return zlib.inflateRawSync(buffer).toString('utf-8'); } catch {}
  return buffer.toString('utf-8');
}

function isLikelyCompressed(buffer: Buffer): boolean {
  if (buffer.length < 2) return false;
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) return true;
  if (buffer[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(buffer[1])) return true;
  return false;
}

export class NetworkInterceptor {
  private active = false;

  constructor(private tracker: UsageTracker) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.patchPrototype();
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
  }

  // ═══════════════════════════════════════════════════════════════
  // HTTP PROTOTYPE PATCHES — catches Copilot telemetry
  // ═══════════════════════════════════════════════════════════════

  private tracked = new WeakMap<http.ClientRequest, { hostname: string; path: string; requestChunks: Buffer[] }>();

  private patchPrototype(): void {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    const originalWrite = http.ClientRequest.prototype.write;
    const originalEnd = http.ClientRequest.prototype.end;

    (http.ClientRequest.prototype as any).write = function (this: http.ClientRequest, chunk: any, ...args: any[]): boolean {
      const t = self.ensureTracking(this);
      if (t && chunk) t.requestChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return originalWrite.apply(this, [chunk, ...args] as any);
    };

    (http.ClientRequest.prototype as any).end = function (this: http.ClientRequest, chunk: any, ...args: any[]): any {
      const t = self.ensureTracking(this);
      if (t && chunk && typeof chunk !== 'function') {
        t.requestChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      if (t && t.hostname.includes('githubcopilot.com') && t.path.includes('/telemetry')) {
        const raw = Buffer.concat(t.requestChunks);
        if (raw.length > 0) {
          const body = isLikelyCompressed(raw) ? tryDecompress(raw) : raw.toString('utf-8');
          self.parseCopilotTelemetry(body);
        }
      }
      return originalEnd.apply(this, [chunk, ...args] as any);
    };
  }

  private ensureTracking(req: http.ClientRequest) {
    if (this.tracked.has(req)) return this.tracked.get(req)!;
    const t = {
      hostname: (req as any).getHeader?.('host') || '',
      path: (req as any).path || '',
      requestChunks: [] as Buffer[],
    };
    this.tracked.set(req, t);
    return t;
  }

  // ═══════════════════════════════════════════════════════════════
  // COPILOT TELEMETRY PARSER — Extract token counts
  // ═══════════════════════════════════════════════════════════════

  private parseCopilotTelemetry(body: string): void {
    try {
      const envelopes: any[] = [];

      if (body.startsWith('[')) {
        envelopes.push(...JSON.parse(body));
      } else if (body.includes('\n')) {
        for (const line of body.split('\n')) {
          const trimmed = line.trim();
          if (trimmed) {
            try { envelopes.push(JSON.parse(trimmed)); } catch {}
          }
        }
      } else {
        envelopes.push(JSON.parse(body));
      }

      for (const envelope of envelopes) {
        this.extractUsageFromEnvelope(envelope);
      }
    } catch {}
  }

  private extractUsageFromEnvelope(envelope: any): void {
    if (!envelope || typeof envelope !== 'object') return;

    const baseData = envelope?.data?.baseData;
    if (!baseData) return;

    const properties = baseData.properties || {};
    const measurements = baseData.measurements || {};

    const inputTokens = measurements.promptTokenCount ?? measurements.promptTokens ?? measurements.prompt_tokens
      ?? (parseFloat(properties.promptTokens) || 0);
    const outputTokens = measurements.completionTokens ?? measurements.responseTokens ?? measurements.completion_tokens
      ?? (parseFloat(properties.completionTokens) || 0);
    const cachedTokens = measurements.cachedTokens ?? measurements.cached_tokens
      ?? (parseFloat(properties.cachedTokens) || 0);

    if (inputTokens === 0 && outputTokens === 0) return;

    const model = properties.model || properties.requestModel || properties['copilot_model'] || 'unknown';
    const endpoint = properties.endpoint || '';
    const eventName = baseData.name || '';
    const feature = properties.feature || properties['copilot_feature'] || '';
    const requestKind = properties.requestKind || '';
    const source = properties.source || '';
    const initiatorType = properties.initiatorType || '';

    let requestType: string;
    let billable: boolean;

    if (requestKind === 'conversation-agent' || (initiatorType === 'user' && requestKind.includes('conversation'))) {
      requestType = 'chat';
      billable = true;
    } else if (requestKind === 'conversation-background') {
      requestType = 'background';
      billable = true;
    } else if (source.includes('nes') || source === 'XtabProvider' || eventName.includes('copilot-nes')) {
      // Next Edit Suggestions — not billed under usage-based billing
      requestType = 'inline';
      billable = false;
    } else if (endpoint === 'completions' || feature === 'ghostText' || feature === 'copilot-ghost-text') {
      // Code completions — not billed under usage-based billing
      requestType = 'inline';
      billable = false;
    } else if (requestKind === 'conversation-other') {
      requestType = 'inline';
      billable = false;
    } else {
      requestType = 'other';
      billable = true;
    }

    this.tracker.logRequest({
      model,
      inputTokens: Math.round(inputTokens),
      outputTokens: Math.round(outputTokens),
      cachedTokens: Math.round(cachedTokens),
      billable,
      requestType,
    });
  }
}
