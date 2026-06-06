import * as http from 'http';
import * as net from 'net';
import { URL } from 'url';
import { UsageTracker } from './usage-tracker';
import { countMessageTokens, countCompletionTokensFromBody, ChatMessage } from './tokenizer';

const COPILOT_HOSTS = [
  'api.githubcopilot.com',
  'copilot-proxy.githubusercontent.com',
  'api.individual.githubcopilot.com',
  'api.business.githubcopilot.com',
];

function isCopilotRequest(hostname: string): boolean {
  return COPILOT_HOSTS.some((h) => hostname.includes(h));
}

export class CopilotProxy {
  private server: http.Server | null = null;

  constructor(
    private port: number,
    private tracker: UsageTracker
  ) {}

  start(): void {
    this.server = http.createServer((req, res) => {
      this.handleRequest(req, res);
    });

    // Handle CONNECT for HTTPS tunneling
    this.server.on('connect', (req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) => {
      this.handleConnect(req, clientSocket, head);
    });

    this.server.listen(this.port, '127.0.0.1', () => {
      console.log(`[copilot-usage] Proxy listening on 127.0.0.1:${this.port}`);
    });

    this.server.on('error', (err) => {
      console.error('[copilot-usage] Proxy error:', err.message);
    });
  }

  stop(): void {
    this.server?.close();
    this.server = null;
  }

  private handleRequest(clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
    const url = new URL(clientReq.url || '', `http://${clientReq.headers.host}`);
    const isCopilot = isCopilotRequest(url.hostname);

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: clientReq.method,
      headers: clientReq.headers,
    };

    const proxyReq = http.request(options, (proxyRes) => {
      clientRes.writeHead(proxyRes.statusCode || 200, proxyRes.headers);

      if (isCopilot) {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk) => {
          chunks.push(chunk);
          clientRes.write(chunk);
        });
        proxyRes.on('end', () => {
          clientRes.end();
          // Process response for token counting
          const body = Buffer.concat(chunks).toString('utf-8');
          this.processResponse(clientReq, body);
        });
      } else {
        proxyRes.pipe(clientRes);
      }
    });

    if (isCopilot) {
      const chunks: Buffer[] = [];
      clientReq.on('data', (chunk) => {
        chunks.push(chunk);
        proxyReq.write(chunk);
      });
      clientReq.on('end', () => {
        proxyReq.end();
        // Store request body for token counting
        const body = Buffer.concat(chunks).toString('utf-8');
        (clientReq as any)._copilotBody = body;
      });
    } else {
      clientReq.pipe(proxyReq);
    }

    proxyReq.on('error', (err) => {
      console.error('[copilot-usage] Proxy request error:', err.message);
      clientRes.writeHead(502);
      clientRes.end('Bad Gateway');
    });
  }

  /**
   * Handle HTTPS CONNECT tunneling.
   * For Copilot hosts, we establish a TLS connection and observe the traffic.
   */
  private handleConnect(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer
  ): void {
    const [hostname, port] = (req.url || '').split(':');
    const targetPort = parseInt(port) || 443;

    // For now, we do a simple tunnel (no TLS inspection).
    // Token counting happens via VS Code's proxy config for HTTP requests,
    // or we can enhance with TLS interception later.
    const serverSocket = net.connect(targetPort, hostname, () => {
      clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      serverSocket.write(head);
      serverSocket.pipe(clientSocket);
      clientSocket.pipe(serverSocket);
    });

    serverSocket.on('error', (err) => {
      console.error('[copilot-usage] CONNECT tunnel error:', err.message);
      clientSocket.end();
    });

    clientSocket.on('error', () => {
      serverSocket.end();
    });
  }

  private async processResponse(req: http.IncomingMessage, responseBody: string): Promise<void> {
    try {
      const reqBody = (req as any)._copilotBody;
      if (!reqBody) return;

      const parsed = JSON.parse(reqBody);
      const model = parsed.model || 'unknown';
      const messages: ChatMessage[] = parsed.messages || [];

      // Count input tokens
      const inputTokens = countMessageTokens(messages);

      // Count output tokens from response
      let outputTokens = 0;
      if (responseBody.includes('data: ')) {
        // Streaming response (SSE)
        outputTokens = countCompletionTokensFromBody(responseBody);
      } else {
        // Non-streaming response
        try {
          const respParsed = JSON.parse(responseBody);
          if (respParsed.usage) {
            outputTokens = respParsed.usage.completion_tokens || 0;
          } else if (respParsed.choices?.[0]?.message?.content) {
            const { countTokens } = require('./tokenizer');
            outputTokens = countTokens(respParsed.choices[0].message.content);
          }
        } catch {
          // Can't parse — skip
        }
      }

      // Determine request type and billable status
      const url = req.url || '';
      let requestType = 'chat';
      let billable = true;
      if (url.includes('/completions') && !url.includes('/chat/')) {
        // Code completions — not billed under usage-based billing
        requestType = 'inline';
        billable = false;
      } else if (url.includes('/embeddings')) {
        requestType = 'other';
        billable = true;
      }

      await this.tracker.logRequest({
        model,
        inputTokens,
        outputTokens,
        cachedTokens: 0,
        billable,
        requestType,
      });
    } catch (err) {
      // Telemetry should never break the proxy
      console.error('[copilot-usage] Failed to process response:', (err as Error).message);
    }
  }
}
