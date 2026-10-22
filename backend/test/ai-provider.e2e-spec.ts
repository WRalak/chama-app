import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { AiProviderError, AnthropicProvider, costMicroUsd } from '../src/modules/ai/provider';

/** The real SDK-backed provider against a local stub of the Messages API: request shape, timeouts and error mapping. */
describe('Anthropic provider adapter', () => {
  let server: Server;
  let handler: (req: IncomingMessage, body: string, res: ServerResponse) => void;
  let lastBody: Record<string, unknown> = {};
  let lastHeaders: IncomingMessage['headers'] = {};

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        lastHeaders = req.headers;
        try {
          lastBody = JSON.parse(body || '{}');
        } catch {
          lastBody = {};
        }
        handler(req, body, res);
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    delete process.env.ANTHROPIC_BASE_URL;
    await new Promise((r) => server.close(r));
  });

  const provider = (timeoutMs = 2000) => new AnthropicProvider('sk-ant-test-key', 'claude-opus-5-5', 'medium', timeoutMs, 0);
  const request = { system: [{ type: 'text' as const, text: 'sys' }], messages: [{ role: 'user' as const, content: 'hi' }], tools: [{ name: 'get_x', description: 'x', input_schema: { type: 'object' as const, properties: {} } }], maxTokens: 100 };
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  it('sends a well-formed request and maps the response', async () => {
    handler = (_req, _b, res) =>
      json(res, 200, { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'text', text: 'Hello' }], stop_reason: 'end_turn', stop_sequence: null, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 0 } });
    const turn = await provider().complete(request);
    expect(turn).toMatchObject({ stopReason: 'end_turn', model: 'claude-opus-5-5', usage: { input: 10, output: 5, cacheRead: 3, cacheWrite: 0 } });
    expect(lastBody).toMatchObject({ model: 'claude-opus-5-5', max_tokens: 100, thinking: { type: 'adaptive' }, output_config: { effort: 'medium' }, fallbacks: 'default' });
    expect(lastBody).not.toHaveProperty('temperature');
    expect(String(lastHeaders['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
    expect(lastHeaders.authorization).toBe('Bearer sk-ant-test-key');
  });

  it('maps rate limits, outages, bad keys and timeouts to typed failures', async () => {
    const kind = async (p: AnthropicProvider) => p.complete(request).then(() => 'ok', (e) => (e instanceof AiProviderError ? e.kind : `other:${e}`));
    handler = (_r, _b, res) => json(res, 429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } });
    expect(await kind(provider())).toBe('rate_limited');
    handler = (_r, _b, res) => json(res, 529, { type: 'error', error: { type: 'overloaded_error', message: 'busy' } });
    expect(await kind(provider())).toBe('unavailable');
    handler = (_r, _b, res) => json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'bad key' } });
    expect(await kind(provider())).toBe('misconfigured');
    handler = (_r, _b, res) => json(res, 400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad' } });
    expect(await kind(provider())).toBe('rejected');
    handler = () => undefined; // never answers
    expect(await kind(provider(300))).toBe('timeout');
  });

  it('prices usage per model, conservatively for unknown models', () => {
    expect(costMicroUsd('claude-opus-5-5', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(4_000_000);
    expect(costMicroUsd('claude-haiku-5-5', { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 })).toBe(500_000);
    expect(costMicroUsd('some-new-model', { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 })).toBe(10_000_000);
  });
});
