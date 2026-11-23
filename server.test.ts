import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { createApp } from './server.ts';

async function withServer<T>(
  options: Parameters<typeof createApp>[0],
  fn: (baseUrl: string) => Promise<T>
): Promise<T> {
  const app = createApp(options);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

test('GET /api/health returns 200 ok', async () => {
  await withServer({}, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; model: string };
    assert.equal(body.ok, true);
    assert.ok(typeof body.model === 'string' && body.model.length > 0);
  });
});

test('GET /api/assistant/status reflects whether GEMINI_API_KEY is configured', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    await withServer({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/assistant/status`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { geminiConfigured: boolean; engineMode: string };
      assert.equal(body.geminiConfigured, false);
      assert.equal(body.engineMode, 'deterministic-only');
    });

    process.env.GEMINI_API_KEY = 'test-fake-key-for-status-check';
    await withServer({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/assistant/status`);
      assert.equal(res.status, 200);
      const body = (await res.json()) as { geminiConfigured: boolean; engineMode: string };
      assert.equal(body.geminiConfigured, true);
      assert.equal(body.engineMode, 'hybrid-deterministic-and-gemini');
    });
  } finally {
    if (prevKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = prevKey;
    }
  }
});

test('POST /api/assistant/explain returns 503 when key unset and enforces 429 rate limits', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  try {
    delete process.env.GEMINI_API_KEY;
    await withServer({ rateLimitMax: 2, rateLimitWindowMs: 60_000 }, async (baseUrl) => {
      const payload = JSON.stringify({
        question: 'Which SKU is highest risk?',
        groundingDossier: { authoritativeHeadline: 'Test dossier' },
      });
      const headers = { 'Content-Type': 'application/json' };

      const r1 = await fetch(`${baseUrl}/api/assistant/explain`, { method: 'POST', headers, body: payload });
      assert.equal(r1.status, 503);
      const b1 = (await r1.json()) as { code: string };
      assert.equal(b1.code, 'GEMINI_NOT_CONFIGURED');

      const r2 = await fetch(`${baseUrl}/api/assistant/explain`, { method: 'POST', headers, body: payload });
      assert.equal(r2.status, 503);

      const r3 = await fetch(`${baseUrl}/api/assistant/explain`, { method: 'POST', headers, body: payload });
      assert.equal(r3.status, 429);
      const b3 = (await r3.json()) as { code: string; retryable: boolean };
      assert.equal(b3.code, 'RATE_LIMITED');
      assert.equal(b3.retryable, true);
    });
  } finally {
    if (prevKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = prevKey;
    }
  }
});
