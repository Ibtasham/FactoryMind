import express, { type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GEMINI_MODEL = 'gemini-4-hydrogen';
const PORT = Number(process.env.PORT || 3000);

export function getConfiguredApiKey(): string | null {
  const raw = (process.env.GEMINI_API_KEY || '').trim();
  if (!raw || raw === 'MY_GEMINI_API_KEY' || raw === 'YOUR_API_KEY') {
    return null;
  }
  return raw;
}

export interface CreateAppOptions {
  rateLimitMax?: number;
  rateLimitWindowMs?: number;
}

interface GroundingFactInput {
  label?: string;
  value?: string;
  unit?: string;
  sourceEngine?: string;
}

interface GroundingTableInput {
  title?: string;
  columns?: string[];
  rows?: string[][];
}

interface GroundingDossierInput {
  question?: string;
  intent?: string;
  focusedSku?: string | null;
  activeAssemblySku?: string | null;
  authoritativeHeadline?: string;
  summaryBullets?: string[];
  facts?: GroundingFactInput[];
  tables?: GroundingTableInput[];
  assumptions?: string[];
  insufficientDataWarnings?: string[];
}

export interface GeminiSynthesisOutput {
  executiveNarrative: string;
  keyInsights: string[];
  riskCaveats: string[];
  recommendedNextStep: string;
  followUpQuestions: string[];
}

const SYSTEM_INSTRUCTION = `You are the FactoryMind Industrial & Production Engineering Decision Assistant.
You are strictly an explanatory and advisory layer on top of deterministic FactoryMind engines (IPE EOQ/ROP, Smart Forecast Alerts, MRP, Line Balancing, Discrete-Event Simulation, and Scenario Studio).

NON-NEGOTIABLE NUMERICAL INTEGRITY RULES:
1. NEVER invent, guess, extrapolate, or modify any numerical figure (quantities, dollar values, days, lead times, OEE, cycle times, confidence intervals, or savings).
2. Cite ONLY exact numbers already present in the provided JSON grounding dossier. If a metric is missing or flagged under insufficientDataWarnings, state explicitly that data is insufficient rather than estimating.
3. Explicitly preserve the distinction between workspace catalog figures, deterministic analytical formulas (EOQ/ROP/MRP), and simulated DES/scenario counterfactuals.
4. Keep prose crisp, engineering-focused, and actionable — no fluff or hype.`;

function extractCleanUpstreamError(err: unknown): {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
} {
  const raw = err instanceof Error ? err.message : String(err || 'Gemini request failed.');
  let parsedCode: number | undefined;
  let parsedStatus: string | undefined;
  let parsedMessage = raw;

  try {
    const maybeObj = JSON.parse(raw) as {
      error?: { code?: number; message?: string; status?: string };
    };
    if (maybeObj?.error) {
      parsedCode = maybeObj.error.code;
      parsedStatus = maybeObj.error.status;
      if (maybeObj.error.message) parsedMessage = maybeObj.error.message;
    }
  } catch {
    // raw message is already plain text
  }

  const isTransient =
    parsedCode === 503 ||
    parsedCode === 429 ||
    parsedStatus === 'UNAVAILABLE' ||
    parsedStatus === 'RESOURCE_EXHAUSTED' ||
    /high demand|unavailable|temporarily|rate limit|429|503/i.test(parsedMessage);

  return {
    status: parsedCode === 503 ? 503 : parsedCode === 429 ? 429 : 502,
    code: parsedStatus || (isTransient ? 'GEMINI_TEMPORARILY_UNAVAILABLE' : 'GEMINI_UPSTREAM_ERROR'),
    message: isTransient
      ? `${parsedMessage} (Deterministic FactoryMind numbers above remain authoritative and unaffected.)`
      : parsedMessage,
    retryable: isTransient,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  app.use(express.json({ limit: '512kb' }));

  const rateLimitMax = Math.max(1, options.rateLimitMax ?? 20);
  const rateLimitWindowMs = Math.max(1000, options.rateLimitWindowMs ?? 60_000);
  const hitsByIp = new Map<string, number[]>();

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true, model: GEMINI_MODEL });
  });

  app.get('/api/assistant/status', (_req: Request, res: Response) => {
    const configured = Boolean(getConfiguredApiKey());
    res.json({
      geminiConfigured: configured,
      model: GEMINI_MODEL,
      engineMode: configured ? 'hybrid-deterministic-and-gemini' : 'deterministic-only',
    });
  });

  app.post('/api/assistant/explain', async (req: Request, res: Response) => {
    const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const recent = (hitsByIp.get(clientIp) || []).filter((ts) => now - ts < rateLimitWindowMs);
    if (recent.length >= rateLimitMax) {
      res.status(429).json({
        code: 'RATE_LIMITED',
        retryable: true,
        error: 'Too many AI synthesis requests. Please wait a moment before retrying; deterministic calculations remain available.',
      });
      return;
    }
    recent.push(now);
    hitsByIp.set(clientIp, recent);
    if (hitsByIp.size > 500) {
      for (const [k, v] of hitsByIp.entries()) {
        if (!v.some((ts) => now - ts < rateLimitWindowMs)) hitsByIp.delete(k);
      }
    }

    const apiKey = getConfiguredApiKey();
    if (!apiKey) {
      res.status(503).json({
        code: 'GEMINI_NOT_CONFIGURED',
        error:
          'Server-side GEMINI_API_KEY is not configured. Deterministic FactoryMind engine results remain active and authoritative.',
      });
      return;
    }

    const body = (req.body || {}) as {
      question?: unknown;
      groundingDossier?: GroundingDossierInput;
    };

    const question = typeof body.question === 'string' ? body.question.trim().slice(0, 600) : '';
    const dossier = body.groundingDossier;

    if (!question || !dossier || typeof dossier !== 'object') {
      res.status(400).json({
        code: 'INVALID_REQUEST',
        error: 'Both question and groundingDossier are required.',
      });
      return;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const promptPayload = {
        userQuestion: question,
        authoritativeHeadline: dossier.authoritativeHeadline || '',
        intent: dossier.intent || '',
        focusedSku: dossier.focusedSku || null,
        activeAssemblySku: dossier.activeAssemblySku || null,
        deterministicSummary: Array.isArray(dossier.summaryBullets) ? dossier.summaryBullets.slice(0, 8) : [],
        verifiedFacts: Array.isArray(dossier.facts) ? dossier.facts.slice(0, 16) : [],
        verifiedTables: Array.isArray(dossier.tables) ? dossier.tables.slice(0, 2) : [],
        assumptions: Array.isArray(dossier.assumptions) ? dossier.assumptions.slice(0, 6) : [],
        insufficientDataWarnings: Array.isArray(dossier.insufficientDataWarnings)
          ? dossier.insufficientDataWarnings.slice(0, 6)
          : [],
      };

      const requestParams = {
        model: GEMINI_MODEL,
        contents: `Synthesize a clear, engineering-grade explanation strictly grounded on the following authoritative FactoryMind dossier:\n\n${JSON.stringify(promptPayload, null, 2)}`,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              executiveNarrative: {
                type: Type.STRING,
                description:
                  'Concise 2-3 sentence operational explanation strictly citing numbers from verifiedFacts and deterministicSummary.',
              },
              keyInsights: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '2 to 4 crisp bullet takeaways referencing exact computed facts and engine provenance.',
              },
              riskCaveats: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '1 to 3 assumptions, model limits, or data sufficiency caveats from the dossier.',
              },
              recommendedNextStep: {
                type: Type.STRING,
                description: 'Single concrete next engineering verification or user-approved action.',
              },
              followUpQuestions: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: '2 to 3 natural follow-up FactoryMind questions.',
              },
            },
            required: [
              'executiveNarrative',
              'keyInsights',
              'riskCaveats',
              'recommendedNextStep',
              'followUpQuestions',
            ],
          },
        },
      };

      const maxAttempts = 2;
      const attemptTimeoutMs = 12000;
      let response: Awaited<ReturnType<typeof ai.models.generateContent>> | null = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(new Error('Gemini upstream timed out (504).')), attemptTimeoutMs);
        try {
          response = await ai.models.generateContent({
            ...requestParams,
            config: {
              ...requestParams.config,
              abortSignal: controller.signal,
            },
          });
          clearTimeout(timer);
          break;
        } catch (err) {
          clearTimeout(timer);
          const info = extractCleanUpstreamError(err);
          const timedOut = controller.signal.aborted;
          if ((!info.retryable && !timedOut) || attempt === maxAttempts) {
            throw timedOut ? new Error('Gemini API timed out after upstream retry (503 UNAVAILABLE).') : err;
          }
          await sleep(500);
        }
      }

      const rawText = (response?.text || '').trim();
      if (!rawText) {
        res.status(502).json({
          code: 'EMPTY_AI_RESPONSE',
          error: 'Gemini returned an empty response payload. Deterministic analysis remains valid.',
        });
        return;
      }

      const parsed = JSON.parse(rawText) as GeminiSynthesisOutput;
      res.json({
        model: GEMINI_MODEL,
        provenance: 'AI_SYNTHESIS_GROUNDED',
        synthesis: parsed,
      });
    } catch (err) {
      const info = extractCleanUpstreamError(err);
      res.status(info.status).json({
        code: info.code,
        retryable: info.retryable,
        error: info.message,
      });
    }
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const isProd = process.env.NODE_ENV === 'production';

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*splat', (_req: Request, res: Response) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    process.stdout.write(`FactoryMind server listening on http://0.0.0.0:${PORT} (mode=${isProd ? 'prod' : 'dev'})\n`);
  });
}

const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  startServer().catch((err) => {
    process.stderr.write(`Failed to start FactoryMind server: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
