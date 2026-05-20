#!/usr/bin/env bun
// DeepSeek proxy for GitHub Copilot (Ollama-compatible).
// Listens on :8765, forwards to api.deepseek.com.
//
// Thinking mode control:
//   DEEPSEEK_THINKING=disabled  → thinking: { type: "disabled" } (fastest)
//   DEEPSEEK_THINKING=enabled   → thinking: { type: "enabled" } (always reason)
//   DEEPSEEK_THINKING=auto      → model-classified per-request (smart default)

const UPSTREAM = "https://api.deepseek.com";
const PORT = 8765;
const DEEPSEEK_API_KEY = process.env.OPENAI_API_KEY ?? "";
const THINKING_MODE = (process.env.DEEPSEEK_THINKING ?? "disabled").toLowerCase();
// "disabled" | "enabled" | "auto"

const HOP_BY_HOP_HEADERS = [
  "connection",
  "keep-alive",
  "proxy-connection",
  "transfer-encoding",
  "te",
  "trailer",
  "upgrade",
  "expect",
  "proxy-authenticate",
  "proxy-authorization",
];

function stripHopByHopHeaders(headers: Headers) {
  const stripped: string[] = [];
  for (const name of HOP_BY_HOP_HEADERS) {
    if (headers.has(name)) {
      headers.delete(name);
      stripped.push(name);
    }
  }
  if (stripped.length > 0) {
    console.log(`[proxy] stripped headers: ${stripped.join(", ")}`);
  }
}

function normalizeResponseHeaders(headers: Headers) {
  for (const name of [
    "content-encoding",
    "content-length",
    "transfer-encoding",
    "connection",
    "keep-alive",
    "trailer",
  ]) {
    headers.delete(name);
  }
}

// ---- Smart auto thinking: classify complexity via a lightweight model call ----
// Sends a tiny classification request (thinking=disabled, max_tokens=5) to
// DeepSeek, asking it to judge whether the latest user query needs deep
// reasoning.  Returns true → enable thinking, false → fast path.
// Defaults to false on any error (safe: fast response).
async function classifyComplexity(messages: any[]): Promise<boolean> {
  // Already in a tool-using chain → keep thinking
  if (
    messages.some(
      (m: any) =>
        m?.role === "assistant" &&
        Array.isArray(m.tool_calls) &&
        m.tool_calls.length > 0,
    )
  ) {
    return true;
  }

  // Extract latest user message text (max 2000 chars for classifier)
  let userText = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "user") continue;
    if (typeof m.content === "string") {
      userText = m.content;
    } else if (Array.isArray(m.content)) {
      userText = m.content
        .filter((c: any) => c?.type === "text")
        .map((c: any) => c.text ?? "")
        .join(" ");
    }
    break;
  }
  if (!userText.trim()) return false;

  const t0 = Date.now();
  try {
    const res = await fetch(UPSTREAM + "/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: [
          {
            role: "system",
            content:
              "Classify queries as 'simple' or 'complex'. SIMPLE: casual chat, greetings, weather, time, trivial facts, yes/no, one-sentence answers. COMPLEX: coding, debugging, design, analysis, math, architecture, research, multi-step reasoning, deep explanations, or anything needing tools. Reply with ONLY the word 'simple' or 'complex'.",
          },
          { role: "user", content: userText.slice(0, 2000) },
        ],
        max_tokens: 5,
        temperature: 0,
        thinking: { type: "disabled" },
      }),
    });
    if (!res.ok) {
      console.log(
        `[proxy] classifier HTTP ${res.status}, defaulting to disabled`,
      );
      return false;
    }
    const data = (await res.json()) as any;
    const answer = (data.choices?.[0]?.message?.content ?? "")
      .toLowerCase()
      .trim();
    const isComplex = answer.includes("complex");
    const ms = Date.now() - t0;
    console.log(
      `[proxy] classifier: "${userText.slice(0, 80)}..." → ${answer} (${ms}ms)`,
    );
    return isComplex;
  } catch (e) {
    console.log(`[proxy] classifier error: ${e}, defaulting to disabled`);
    return false;
  }
}

// ---- End classifier ----

// Retry fetch on transient connection errors (DeepSeek upstream sometimes
// resets keep-alive sockets, surfacing as ConnectionRefused / FailedToOpenSocket).
async function fetchWithRetry(
  input: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(input, init);
    } catch (e: any) {
      lastErr = e;
      const code = e?.code ?? "";
      const transient =
        code === "ConnectionRefused" ||
        code === "FailedToOpenSocket" ||
        code === "ConnectionReset" ||
        code === "ECONNRESET" ||
        code === "ECONNREFUSED";
      console.log(`[proxy] fetch attempt ${i + 1}/${attempts} failed: ${code || e?.message}`);
      if (!transient || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, 200 * (i + 1)));
    }
  }
  throw lastErr;
}

Bun.serve({
  port: PORT,
  // Long idle timeout — DeepSeek thinking mode can take >10s before the
  // first SSE chunk; default 10s would terminate the stream prematurely.
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);

    // Mock Ollama /api/version
    if (url.pathname === "/api/version") {
      return Response.json({ version: "0.9.0" });
    }

    // Mock Ollama /api/show — return model info for any deepseek model
    if (url.pathname === "/api/show") {
      let modelName = "deepseek-v4-pro";
      try {
        const b = await req.json();
        modelName = b.name ?? b.model ?? modelName;
      } catch {}
      const architecture = "deepseek";
      const contextLength = 1_000_000;
      return Response.json({
        modelfile: `FROM ${modelName}`,
        remote_model: modelName,
        parameters: "",
        template: "{{ .Prompt }}",
        capabilities: ["completion", "tools"],
        details: {
          format: "gguf",
          family: "deepseek",
          families: ["deepseek"],
          parameter_size: "671B",
          quantization_level: "Q4_0",
        },
        model_info: {
          "general.architecture": architecture,
          "general.basename": modelName,
          "general.parameter_count": 671000000000,
          [`${architecture}.context_length`]: contextLength,
        },
      });
    }

    // Mock Ollama /api/tags so VS Code Copilot's "Ollama" provider can list models
    if (url.pathname === "/api/tags") {
      const models = ["deepseek-v4-pro", "deepseek-v4-flash"].map((name) => ({
        name,
        model: name,
        modified_at: new Date().toISOString(),
        size: 0,
        digest: name,
        details: { family: "deepseek", parameter_size: "unknown" },
      }));
      return Response.json({ models });
    }

    // Ollama /api/chat → forward as OpenAI /v1/chat/completions, translate response back
    if (url.pathname === "/api/chat") {
      const ollamaBody = await req.json();
      const openaiBody: any = {
        model: ollamaBody.model ?? "deepseek-v4-pro",
        messages: ollamaBody.messages ?? [],
        stream: ollamaBody.stream ?? false,
        max_tokens: 16384,
      };
      if (THINKING_MODE === "disabled") {
        openaiBody.thinking = { type: "disabled" };
        openaiBody.chat_template_kwargs = { thinking: false };
      } else if (THINKING_MODE === "enabled") {
        openaiBody.thinking = { type: "enabled" };
      } else if (THINKING_MODE === "auto") {
        const useThinking = await classifyComplexity(openaiBody.messages ?? []);
        if (useThinking) {
          openaiBody.thinking = { type: "enabled" };
        } else {
          openaiBody.thinking = { type: "disabled" };
          openaiBody.chat_template_kwargs = { thinking: false };
        }
      }
      const upstreamRes = await fetchWithRetry(UPSTREAM + "/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${DEEPSEEK_API_KEY}`,
        },
        body: JSON.stringify(openaiBody),
      });
      if (!upstreamRes.ok) {
        const err = await upstreamRes.text();
        console.log(`[proxy] /api/chat upstream error ${upstreamRes.status}: ${err}`);
        return new Response(err, { status: upstreamRes.status });
      }
      const openaiData = await upstreamRes.json() as any;
      const content = openaiData.choices?.[0]?.message?.content ?? "";
      // Return Ollama-format response
      return Response.json({
        model: openaiBody.model,
        created_at: new Date().toISOString(),
        message: { role: "assistant", content },
        done: true,
        done_reason: "stop",
      });
    }

    const upstreamUrl = UPSTREAM + url.pathname + url.search;
    const headers = new Headers(req.headers);
    headers.delete("host");
    headers.delete("content-length");
    stripHopByHopHeaders(headers);

    let body: BodyInit | undefined;
    let injected = false;
    if (req.method !== "GET" && req.method !== "HEAD") {
      const text = await req.text();
      if (
        url.pathname.endsWith("/chat/completions") &&
        headers.get("content-type")?.includes("application/json")
      ) {
        try {
          const json = JSON.parse(text);
          json.max_tokens = 16384;
          // Thinking mode: controlled by DEEPSEEK_THINKING env var.
          // When enabled, DeepSeek requires every prior assistant message to
          // carry a `reasoning_content` field. Copilot doesn't preserve the
          // real one, so we inject "" — empty string is accepted by the
          // server and lets us keep thinking on for the whole conversation.
          //
          // "auto": run a lightweight classifier to decide per-request.
          // If we're in auto mode and already in a tool chain, keep thinking.
          let effectiveThinking: string = THINKING_MODE;
          if (THINKING_MODE === "auto" && Array.isArray(json.messages)) {
            const useThinking = await classifyComplexity(json.messages);
            effectiveThinking = useThinking ? "enabled" : "disabled";
          }
          if (effectiveThinking === "disabled") {
            json.chat_template_kwargs = {
              ...(json.chat_template_kwargs ?? {}),
              thinking: false,
            };
            json.thinking = { type: "disabled" };
          } else if (effectiveThinking === "enabled") {
            json.thinking = { type: "enabled" };
          }
          // Normalize reasoning fields on prior assistant messages.
          if (Array.isArray(json.messages)) {
            for (const m of json.messages) {
              if (m && typeof m === "object") {
                delete m.reasoning;
                if (m.role === "assistant" && effectiveThinking === "enabled") {
                  // Always provide an empty reasoning_content placeholder so
                  // multi-turn requests pass DeepSeek's thinking-mode check.
                  if (typeof m.reasoning_content !== "string") {
                    m.reasoning_content = "";
                  }
                } else {
                  delete m.reasoning_content;
                }
              }
            }
            // Iteratively prune orphan tool_calls / orphan tool messages.
            // DeepSeek strictly enforces:
            //   1. every assistant.tool_calls[i].id must have a matching
            //      tool message later with tool_call_id == that id
            //   2. every tool message must follow an assistant.tool_calls
            //      that produced its tool_call_id
            //   3. tool messages must IMMEDIATELY follow the assistant
            //      message that produced their tool_call_ids (no other
            //      assistant/user message may interleave)
            // Pruning one side may invalidate the other, so loop until stable.
            let msgs: any[] = json.messages;

            // Pass A: reorder tool messages to immediately follow their
            // producing assistant.tool_calls message.
            {
              const reordered: any[] = [];
              const taken = new Set<number>();
              for (let i = 0; i < msgs.length; i++) {
                if (taken.has(i)) continue;
                const m = msgs[i];
                reordered.push(m);
                taken.add(i);
                if (
                  m?.role === "assistant" &&
                  Array.isArray(m.tool_calls) &&
                  m.tool_calls.length > 0
                ) {
                  const wantIds = m.tool_calls
                    .map((tc: any) => tc?.id)
                    .filter(Boolean);
                  for (const id of wantIds) {
                    for (let j = i + 1; j < msgs.length; j++) {
                      if (taken.has(j)) continue;
                      const n = msgs[j];
                      if (n?.role === "tool" && n.tool_call_id === id) {
                        reordered.push(n);
                        taken.add(j);
                        break;
                      }
                    }
                  }
                }
              }
              if (reordered.length !== msgs.length) {
                console.log(
                  `[proxy] reorder lost messages: ${msgs.length} -> ${reordered.length}`,
                );
              }
              msgs = reordered;
            }

            // Pass B: drop any orphan tool messages or assistant tool_calls
            // whose responses are missing.
            for (let pass = 0; pass < 5; pass++) {
              const producedIds = new Set<string>();
              for (const m of msgs) {
                if (m?.role === "assistant" && Array.isArray(m.tool_calls)) {
                  for (const tc of m.tool_calls) {
                    if (tc?.id) producedIds.add(tc.id);
                  }
                }
              }
              const respondedIds = new Set<string>();
              for (const m of msgs) {
                if (m?.role === "tool" && m.tool_call_id) {
                  respondedIds.add(m.tool_call_id);
                }
              }
              const next: any[] = [];
              let changed = false;
              for (const m of msgs) {
                if (m?.role === "tool" && m.tool_call_id) {
                  if (!producedIds.has(m.tool_call_id)) {
                    console.log(
                      `[proxy] dropping orphan tool message: ${m.tool_call_id}`,
                    );
                    changed = true;
                    continue;
                  }
                }
                if (
                  m?.role === "assistant" &&
                  Array.isArray(m.tool_calls) &&
                  m.tool_calls.length > 0
                ) {
                  const allResponded = m.tool_calls.every(
                    (tc: any) => tc?.id && respondedIds.has(tc.id),
                  );
                  if (!allResponded) {
                    console.log(
                      `[proxy] dropping incomplete assistant tool_calls`,
                    );
                    changed = true;
                    continue;
                  }
                }
                next.push(m);
              }
              msgs = next;
              if (!changed) break;
            }

            // Pass C: merge consecutive same-role user/system messages.
            // DeepSeek API rejects consecutive same-role messages with
            // "bad request, http smuggling". Copilot sometimes emits two
            // back-to-back user messages (e.g. context blocks + actual query).
            {
              const mergedMsgs: any[] = [];
              for (const m of msgs) {
                const last = mergedMsgs.length > 0 ? mergedMsgs[mergedMsgs.length - 1] : null;
                if (
                  last &&
                  last.role === m.role &&
                  (m.role === "user" || m.role === "system")
                ) {
                  // Normalize content to array of parts, then flatten to string
                  const toParts = (c: any): any[] => {
                    if (typeof c === "string") return [{ type: "text", text: c }];
                    if (Array.isArray(c)) return c;
                    return [{ type: "text", text: String(c ?? "") }];
                  };
                  const parts = [...toParts(last.content), ...toParts(m.content)];
                  if (parts.every((p: any) => p?.type === "text")) {
                    last.content = parts.map((p: any) => p.text ?? "").join("\n\n");
                  } else {
                    last.content = parts;
                  }
                  console.log(`[proxy] merged consecutive ${m.role} messages`);
                } else {
                  mergedMsgs.push({ ...m });
                }
              }
              msgs = mergedMsgs;
            }

            json.messages = msgs;
          }
          body = JSON.stringify(json);
          headers.set("content-type", "application/json");
          injected = true;
          console.log(
            `[proxy] ${req.method} ${url.pathname} model=${json.model} msgs=${
              Array.isArray(json.messages) ? json.messages.length : "?"
            } stream=${!!json.stream} max_tokens=${json.max_tokens ?? "?"} max_input_tokens=${json.max_input_tokens ?? "?"} thinking=${effectiveThinking ?? THINKING_MODE}`,
          );
          // Dump message roles + tool_call ids to diagnose tool ordering bugs.
          if (Array.isArray(json.messages)) {
            const sketch = json.messages.map((m: any, i: number) => {
              const tcs = Array.isArray(m.tool_calls)
                ? m.tool_calls.map((tc: any) => tc.id).join(",")
                : "";
              return `${i}:${m.role}${tcs ? `[tc:${tcs}]` : ""}${
                m.tool_call_id ? `[resp:${m.tool_call_id}]` : ""
              }`;
            });
            console.log(`[proxy]   roles: ${sketch.join(" | ")}`);
          }
        } catch (e) {
          body = text;
          console.log("[proxy] json parse failed:", e);
        }
      } else {
        body = text;
      }
    }
    if (!injected) {
      console.log(`[proxy] ${req.method} ${url.pathname} (passthrough)`);
    }

    // Always inject our own API key — Copilot's Ollama provider sends no key.
    headers.set("authorization", `Bearer ${DEEPSEEK_API_KEY}`);

    const upstreamRes = await fetchWithRetry(upstreamUrl, {
      method: req.method,
      headers,
      body,
    });
    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text();
      const responseHeaders = new Headers(upstreamRes.headers);
      normalizeResponseHeaders(responseHeaders);
      console.log(
        `[proxy] upstream ${url.pathname} -> ${upstreamRes.status} ${upstreamRes.statusText}: ${errText.slice(0, 500)}`,
      );
      return new Response(errText, {
        status: upstreamRes.status,
        statusText: upstreamRes.statusText,
        headers: responseHeaders,
      });
    }
    const responseHeaders = new Headers(upstreamRes.headers);
    normalizeResponseHeaders(responseHeaders);
    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: responseHeaders,
    });
  },
});

console.log(`[deepseek-proxy] listening on http://localhost:${PORT}`);
console.log(`[deepseek-proxy] forwarding to ${UPSTREAM}`);
