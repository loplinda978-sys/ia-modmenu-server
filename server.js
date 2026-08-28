const express = require("express");
const cors = require("cors");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const DEFAULT_MODEL = "nousresearch/hermes-3-llama-3-8b:free";
const tasks = new Map();

app.use(cors({ origin: "*", methods: ["GET", "POST", "OPTIONS"] }));
app.use(express.json({ limit: "1000mb" }));

function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\\n\\n`);
}

function normalizePrompt(body) {
  const prompt = String(body?.prompt || body?.message || "").trim();
  const files = Array.isArray(body?.files) ? body.files : [];
  const attachmentInfo = files.length
    ? `\\n\\n[Arquivos binários anexados: ${files.map((file) => String(file?.name || "arquivo")).join(", ")}]`
    : "";
  return `${prompt}${attachmentInfo}`.trim();
}

function extractText(data) {
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("").trim();
  }
  return "";
}

async function requestOpenRouter(prompt, model) {
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY não configurada no Render.");
  }

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.APP_URL || "https://novaiainterf-nqtczeyq.manus.space",
             {
          role: "system",
          content: "Você é a CollinsIA, uma assistente útil. Analise o conteúdo enviado pelo usuário e responda em português do Brasil quando ele escrever em português. Seja clara, objetiva e não invente o conteúdo de arquivos.",
        },

          role: "system",
          content: "Você é a CollinsIA, uma assistente útil. Analise o conteúdo enviado pelo usuário e responda em português do Brasil quando ele escrever em português. Seja clara, objetiva e não invente o conteúdo de arquivos.",
        },
        { role: "user", content: prompt },
      ],
      stream: false,
    }),
  });

  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    throw new Error(`Resposta inválida do OpenRouter (HTTP ${response.status}).`);
  }

  if (!response.ok) {
    const providerMessage = data?.error?.message || data?.error || `HTTP ${response.status}`;
    throw new Error(`OpenRouter: ${providerMessage}`);
  }

  const text = extractText(data);
  if (!text) throw new Error("O modelo não retornou texto.");
  return text;
}

app.post("/api/tasks", (req, res) => {
  const prompt = normalizePrompt(req.body);
  if (!prompt) return res.status(400).json({ error: "Envie uma mensagem ou arquivo." });

  const id = `task_${Math.random().toString(36).slice(2, 11)}`;
  const model = String(req.body?.model || DEFAULT_MODEL);
  tasks.set(id, { prompt, model, createdAt: Date.now() });
  setTimeout(() => tasks.delete(id), 15 * 60 * 1000).unref();

  return res.status(202).json({ id, status: "queued", title: prompt.slice(0, 80) });
});

app.get("/api/tasks/:id/events", async (req, res) => {
  const task = tasks.get(req.params.id);
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  if (!task) {
    sendEvent(res, { type: "error", error: "Tarefa não encontrada ou expirada." });
    return res.end();
  }

  sendEvent(res, { type: "status", taskId: req.params.id, status: "running" });
  try {
    const text = await requestOpenRouter(task.prompt, task.model);
    sendEvent(res, { type: "token", taskId: req.params.id, text });
    sendEvent(res, { type: "status", taskId: req.params.id, status: "done" });
    sendEvent(res, { type: "done", taskId: req.params.id });
  } catch (error) {
    console.error("[CollinsIA] erro na tarefa:", error.message);
    sendEvent(res, { type: "error", taskId: req.params.id, error: error.message });
  } finally {
    res.end();
  }
});

app.post("/api/tasks/:id/cancel", (req, res) => {
  const existed = tasks.delete(req.params.id);
  return res.json({ ok: true, existed });
});

app.get("/ping", (_req, res) => res.status(200).send("CollinsIA online"));

app.listen(PORT, () => {
  console.log(`Servidor CollinsIA rodando na porta ${PORT}`);
});
