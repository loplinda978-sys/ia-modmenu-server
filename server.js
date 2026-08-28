const express = require("express");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openrouter/free";
const tasks = new Map();

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "1mb" }));

function sendEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

app.post("/api/tasks", (req, res) => {
  const prompt = String(req.body?.prompt || req.body?.message || "").trim();

  if (!prompt) {
    return res.status(400).json({ error: "Envie um prompt ou message." });
  }

  const taskId = `task_${Math.random().toString(36).slice(2, 11)}`;
  tasks.set(taskId, { prompt, createdAt: Date.now() });

  return res.status(202).json({
    id: taskId,
    status: "queued",
    title: prompt.length > 60 ? `${prompt.slice(0, 60)}…` : prompt
  });
});

app.get("/api/tasks/:id/events", async (req, res) => {
  const taskId = req.params.id;
  const task = tasks.get(taskId);

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  if (!task) {
    sendEvent(res, { type: "error", error: "Tarefa não encontrada." });
    return res.end();
  }

  if (!OPENROUTER_API_KEY) {
    sendEvent(res, {
      type: "error",
      error: "OPENROUTER_API_KEY não está configurada no Render."
    });
    return res.end();
  }

  try {
    sendEvent(res, { type: "status", taskId, status: "running" });

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ia-modmenu-server.onrender.com",
        "X-Title": "CollinsIA"
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [
          {
            role: "system",
            content: "Você é a CollinsIA, uma assistente útil para programação, criação de conteúdo, planejamento e desenvolvimento de projetos próprios ou autorizados. Responda em português do Brasil quando o usuário escrever em português. Explique as etapas com clareza e forneça código completo quando solicitado, respeitando segurança, propriedade intelectual e as regras do serviço."
          },
          { role: "user", content: task.prompt }
        ]
      })
    });

    if (!response.ok) {
      const detalhe = await response.text();
      console.error("[OPENROUTER_ERROR]", response.status, detalhe);
      sendEvent(res, {
        type: "error",
        error: `OpenRouter HTTP ${response.status}: ${detalhe.slice(0, 500)}`
      });
      return res.end();
    }

    const data = await response.json();
    const textoResposta = data?.choices?.[0]?.message?.content;

    if (!textoResposta) {
      console.error("[OPENROUTER_EMPTY_RESPONSE]", JSON.stringify(data).slice(0, 1000));
      sendEvent(res, { type: "error", error: "A OpenRouter não retornou texto." });
      return res.end();
    }

    sendEvent(res, { type: "token", taskId, text: textoResposta });
    sendEvent(res, { type: "status", taskId, status: "done" });
    sendEvent(res, { type: "done", taskId });
  } catch (error) {
    console.error("[SERVER_ERROR]", error);
    sendEvent(res, {
      type: "error",
      error: error instanceof Error ? error.message : "Erro interno ao consultar a IA."
    });
  }

  return res.end();
});

app.get("/ping", (_req, res) => {
  res.status(200).send("Acordado!");
});

app.listen(PORT, () => {
  console.log(`Servidor CollinsIA rodando na porta ${PORT}`);
});
