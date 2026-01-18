import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AGUIEvent, ChatItem } from "./types";
import { streamSSE } from "./sse";
import {
  collectLinkStrings,
  downloadDataUrl,
  downloadUrlAsFile,
  guessExtensionFromDataUrl,
  guessFilenameFromUrl,
  pretty,
  safeJsonParse,
} from "./utils";

const THREAD_ID_STORAGE_KEY = "agui:demo2:threadId";

function nowId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function getDefaultApiUrl() {
  return (import.meta as any).env?.VITE_API_URL ?? "/api";
}

function joinUrl(base: string, path: string) {
  if (base.endsWith("/") && path.startsWith("/")) return base + path.slice(1);
  if (!base.endsWith("/") && !path.startsWith("/")) return `${base}/${path}`;
  return base + path;
}

function looksLikeInterruptEventName(name: unknown): boolean {
  if (typeof name !== "string") return false;
  const n = name.toLowerCase();
  return n.includes("interrupt");
}

export default function App() {
  const [apiUrl, setApiUrl] = useState<string>(() => getDefaultApiUrl());
  const [threadId, setThreadId] = useState<string>(() => {
    const existing = window.localStorage.getItem(THREAD_ID_STORAGE_KEY);
    return existing || crypto.randomUUID();
  });

  const [input, setInput] = useState<string>("");
  const [items, setItems] = useState<ChatItem[]>([]);
  const [events, setEvents] = useState<{ t: number; event: string; data: unknown }[]>([]);

  const [status, setStatus] = useState<
    "idle" | "connecting" | "streaming" | "finished" | "error"
  >("idle");
  const [error, setError] = useState<string>("");

  const abortRef = useRef<AbortController | null>(null);

  const canSend = status !== "connecting" && status !== "streaming";

  useEffect(() => {
    if (threadId) window.localStorage.setItem(THREAD_ID_STORAGE_KEY, threadId);
  }, [threadId]);

  const currentInterrupt = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].kind === "interrupt") return items[i];
    }
    return null;
  }, [items]);

  const pushEventLog = (eventName: string, payload: unknown) => {
    setEvents((prev) => {
      const next = [...prev, { t: Date.now(), event: eventName, data: payload }];
      return next.length > 200 ? next.slice(next.length - 200) : next;
    });
  };

  const upsertAssistantText = (messageId: string, delta: string) => {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.kind === "assistant" && it.id === messageId);
      if (idx === -1) {
        return [
          ...prev,
          {
            id: messageId,
            kind: "assistant",
            createdAt: Date.now(),
            title: "assistant",
            text: delta,
          },
        ];
      }
      const copy = [...prev];
      copy[idx] = { ...copy[idx], text: (copy[idx].text ?? "") + delta };
      return copy;
    });
  };

  const upsertToolCall = (toolCallId: string, patch: Partial<ChatItem>) => {
    setItems((prev) => {
      const idx = prev.findIndex((it) => it.kind === "tool_call" && it.toolCallId === toolCallId);
      if (idx === -1) {
        return [
          ...prev,
          {
            id: nowId("tool_call"),
            kind: "tool_call",
            createdAt: Date.now(),
            toolCallId,
            title: "tool_call",
            ...patch,
          },
        ];
      }
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...patch };
      return copy;
    });
  };

  const pushToolResult = (toolCallId: string, content: unknown) => {
    setItems((prev) => [
      ...prev,
      {
        id: nowId("tool_result"),
        kind: "tool_result",
        createdAt: Date.now(),
        title: "tool_result",
        toolCallId,
        toolResultText: typeof content === "string" ? content : pretty(content),
        raw: content,
      },
    ]);
  };

  const pushSystem = (title: string, raw?: unknown) => {
    setItems((prev) => [
      ...prev,
      {
        id: nowId("system"),
        kind: "system",
        createdAt: Date.now(),
        title,
        text: typeof raw === "string" ? raw : raw ? pretty(raw) : "",
        raw,
      },
    ]);
  };

  const handleAGUIEvent = (evt: AGUIEvent, eventName: string) => {
    const t = (evt.type as string | undefined) ?? eventName;

    if (t === "RUN_STARTED") {
      const tid = (evt.thread_id as string | undefined) ?? "";
      if (tid) setThreadId(tid);
      pushSystem("RUN_STARTED", evt);
      return;
    }

    if (t === "RUN_ERROR") {
      setStatus("error");
      const msg = (evt.message as string | undefined) ?? "Run error";
      setError(msg);
      pushSystem("RUN_ERROR", evt);
      return;
    }

    if (t === "RUN_FINISHED") {
      setStatus("finished");
      pushSystem("RUN_FINISHED", evt);
      return;
    }

    if (t === "TEXT_MESSAGE_START") {
      const mid = (evt.message_id as string | undefined) ?? nowId("assistant");
      upsertAssistantText(mid, "");
      return;
    }

    if (t === "TEXT_MESSAGE_CONTENT") {
      const mid = (evt.message_id as string | undefined) ?? "";
      const delta = (evt.delta as string | undefined) ?? "";
      if (mid) upsertAssistantText(mid, delta);
      return;
    }

    if (t === "TEXT_MESSAGE_END") {
      return;
    }

    if (t === "TOOL_CALL_START") {
      const toolCallId = (evt.tool_call_id as string | undefined) ?? nowId("tc");
      const name = (evt.tool_call_name as string | undefined) ?? "tool";
      upsertToolCall(toolCallId, {
        toolCallId,
        toolName: name,
        title: `tool_call: ${name}`,
        toolArgsText: "",
        raw: evt,
      });
      return;
    }

    if (t === "TOOL_CALL_ARGS") {
      const toolCallId = (evt.tool_call_id as string | undefined) ?? "";
      const delta = (evt.delta as string | undefined) ?? "";
      if (!toolCallId) return;

      setItems((prev) => {
        const existing = prev.find(
          (x) => x.kind === "tool_call" && x.toolCallId === toolCallId,
        );
        const prevArgs = (existing?.toolArgsText as string | undefined) ?? "";

        const idx = prev.findIndex(
          (x) => x.kind === "tool_call" && x.toolCallId === toolCallId,
        );

        if (idx === -1) {
          return [
            ...prev,
            {
              id: nowId("tool_call"),
              kind: "tool_call",
              createdAt: Date.now(),
              toolCallId,
              title: "tool_call",
              toolArgsText: prevArgs + delta,
            },
          ];
        }

        const copy = [...prev];
        copy[idx] = { ...copy[idx], toolArgsText: prevArgs + delta };
        return copy;
      });

      return;
    }

    if (t === "TOOL_CALL_END") {
      const toolCallId = (evt.tool_call_id as string | undefined) ?? "";
      if (!toolCallId) return;
      upsertToolCall(toolCallId, {
        raw: evt,
      });
      return;
    }

    if (t === "TOOL_CALL_RESULT") {
      const toolCallId = (evt.tool_call_id as string | undefined) ?? "";
      const content = (evt.content as unknown) ?? "";
      pushToolResult(toolCallId, content);
      return;
    }

    if (t === "CUSTOM") {
      const name = (evt.name as unknown) ?? (evt.event_name as unknown);
      const valueRaw = (evt.value as unknown) ?? null;
      if (looksLikeInterruptEventName(name)) {
        let parsed = valueRaw;
        if (typeof valueRaw === "string") {
          const p = safeJsonParse(valueRaw);
          parsed = p ?? valueRaw;
        }

        const first = Array.isArray(parsed) ? parsed[0] : parsed;
        const interrupt =
          first && typeof first === "object"
            ? (first as any)
            : { description: "Interrupt", raw: parsed };

        setItems((prev) => [
          ...prev,
          {
            id: nowId("interrupt"),
            kind: "interrupt",
            createdAt: Date.now(),
            title: typeof name === "string" ? name : "Interrupt",
            interrupt: {
              description: interrupt.description,
              action_request: interrupt.action_request,
              config: interrupt.config,
            },
            raw: parsed,
          },
        ]);
        return;
      }

      pushSystem(`CUSTOM: ${String(name)}`, evt);
      return;
    }

    if (t === "STEP_STARTED" || t === "STEP_FINISHED") {
      pushSystem(t, evt);
      return;
    }
  };

  const run = async (payload: any) => {
    abortRef.current?.abort();

    const endpoint = joinUrl(apiUrl, "/agent");

    setError("");
    setStatus("connecting");

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      await streamSSE({
        url: endpoint,
        body: payload,
        signal: abort.signal,
        onFrame: (frame) => {
          setStatus("streaming");
          const raw = frame.data ?? "";

          const parsed = typeof raw === "string" ? safeJsonParse(raw) : null;
          const evtObj: AGUIEvent =
            parsed && typeof parsed === "object" ? (parsed as any) : { type: frame.event, data: raw };

          const evName = (frame.event ?? (evtObj.type as string) ?? "(unknown)") as string;
          pushEventLog(evName, evtObj);
          handleAGUIEvent(evtObj, evName);
        },
      });

      if (status !== "error") setStatus("finished");
    } catch (e: any) {
      if (e?.name === "AbortError") {
        setStatus("idle");
        pushSystem("aborted");
        return;
      }
      setStatus("error");
      setError(e?.message ?? String(e));
      pushSystem("stream error", e?.message ?? String(e));
    } finally {
      abortRef.current = null;
    }
  };

  const sendUserMessage = async () => {
    const text = input.trim();
    if (!text) return;

    setItems((prev) => [
      ...prev,
      {
        id: nowId("user"),
        kind: "user",
        createdAt: Date.now(),
        title: "user",
        text,
      },
    ]);
    setInput("");

    const message = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
    };

    const payload = {
      thread_id: threadId,
      run_id: nowId("run"),
      parent_run_id: null,
      state: {},
      messages: [message],
      tools: [],
      context: [],
      forwarded_props: {},
    };

    await run(payload);
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const startNewThread = () => {
    const tid = crypto.randomUUID();
    setThreadId(tid);
    setItems([]);
    setEvents([]);
    setError("");
    setStatus("idle");
  };

  const resumeWith = async (
    type: "accept" | "edit" | "ignore" | "response",
    args: any,
  ) => {
    const payload = {
      thread_id: threadId,
      run_id: nowId("run"),
      parent_run_id: null,
      state: {},
      messages: [],
      tools: [],
      context: [],
      forwarded_props: {
        command: {
          resume: [{ type, args }],
        },
      },
    };

    pushSystem(`resume: ${type}`, payload.forwarded_props);
    await run(payload);
  };

  return (
    <div className="app">
      <div className="header">
        <h1>AG-UI Events Demo (Route 2)</h1>
        <div className="meta">
          <span className="badge">API_URL: {apiUrl}</span>
          <span className="badge">threadId: {threadId || "(none)"}</span>
          <span className="badge">status: {status}</span>
        </div>
      </div>

      <div className="panel">
        <div className="panelHeader">
          <strong>Chat</strong>
          <div className="row">
            <button
              className="primary"
              onClick={startNewThread}
              disabled={status === "connecting" || status === "streaming"}
              title="Generate a new local threadId and clear UI"
            >
              New thread
            </button>
            <button className="danger" onClick={stop} disabled={status !== "streaming"}>
              Stop
            </button>
          </div>
        </div>
        <div className="panelBody">
          <div className="small">
            Tip: default setup uses Vite proxy, so API_URL should be <code>/api</code>.
            <br />
            If your backend supports CORS, you can point it directly to <code>http://localhost:8123</code>.
          </div>

          <div style={{ marginTop: 10 }}>
            <label className="small">API URL</label>
            <input
              value={apiUrl}
              onChange={(e) => setApiUrl(e.target.value)}
              placeholder="/api or http://localhost:8123"
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <label className="small">Thread ID (stored in localStorage)</label>
            <input
              value={threadId}
              onChange={(e) => setThreadId(e.target.value)}
              placeholder="leave empty to let server create one"
            />
          </div>

          <div style={{ marginTop: 10 }}>
            <label className="small">Message</label>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask something..."
            />
            <div className="footer" style={{ marginTop: 8 }}>
              <button className="primary" onClick={sendUserMessage} disabled={!canSend}>
                Send
              </button>
              {error ? <span className="small" style={{ color: "var(--danger)" }}>{error}</span> : null}
            </div>
          </div>

          {currentInterrupt ? (
            <InterruptCard
              key={currentInterrupt.id}
              item={currentInterrupt}
              onResume={resumeWith}
              disabled={!canSend}
            />
          ) : null}

          <div style={{ marginTop: 12 }}>
            {items.map((it) => (
              <ChatItemView key={it.id} item={it} />
            ))}
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panelHeader">
          <strong>Event Log</strong>
          <div className="row">
            <button
              onClick={() => setEvents([])}
              disabled={events.length === 0}
              title="Clear log"
            >
              Clear
            </button>
          </div>
        </div>
        <div className="panelBody">
          {events.length === 0 ? (
            <div className="small">No events yet.</div>
          ) : (
            events
              .slice()
              .reverse()
              .map((ev, idx) => (
                <div className="msg" key={`${ev.t}_${idx}`}>
                  <div className="msgHeader">
                    <span className="kind">{new Date(ev.t).toLocaleTimeString()}</span>
                    <span className="kind">{ev.event}</span>
                  </div>
                  <pre>{pretty(ev.data)}</pre>
                </div>
              ))
          )}
        </div>
      </div>
    </div>
  );
}

function ChatItemView({ item }: { item: ChatItem }) {
  const headerRight = new Date(item.createdAt).toLocaleTimeString();

  if (item.kind === "assistant") {
    return (
      <div className="msg">
        <div className="msgHeader">
          <span className="kind">assistant</span>
          <span className="kind">{headerRight}</span>
        </div>
        <pre>{item.text ?? ""}</pre>
      </div>
    );
  }

  if (item.kind === "user") {
    return (
      <div className="msg">
        <div className="msgHeader">
          <span className="kind">user</span>
          <span className="kind">{headerRight}</span>
        </div>
        <pre>{item.text ?? ""}</pre>
      </div>
    );
  }

  if (item.kind === "tool_call") {
    return (
      <div className="msg">
        <div className="msgHeader">
          <span className="kind">tool_call</span>
          <span className="kind">{headerRight}</span>
        </div>
        <div className="kv">
          <div>id</div>
          <div>
            <code style={{ fontFamily: "var(--mono)" }}>{item.toolCallId}</code>
          </div>
          <div>name</div>
          <div>
            <code style={{ fontFamily: "var(--mono)" }}>{item.toolName}</code>
          </div>
        </div>
        {item.toolArgsText ? <pre>{item.toolArgsText}</pre> : <div className="small">(no args streamed)</div>}
      </div>
    );
  }

  if (item.kind === "tool_result") {
    const raw = item.raw;
    const parsed = typeof raw === "string" ? safeJsonParse(raw) : raw;
    const links = collectLinkStrings(parsed ?? item.toolResultText ?? "");
    const httpLinks = links.filter((x) => x.startsWith("http"));
    const dataLinks = links.filter((x) => x.startsWith("data:"));

    return (
      <div className="msg">
        <div className="msgHeader">
          <span className="kind">tool_result</span>
          <span className="kind">{headerRight}</span>
        </div>
        {item.toolCallId ? (
          <div className="small">
            tool_call_id: <code style={{ fontFamily: "var(--mono)" }}>{item.toolCallId}</code>
          </div>
        ) : null}
        <pre>{item.toolResultText ?? ""}</pre>

        {(httpLinks.length > 0 || dataLinks.length > 0) && (
          <div className="media">
            {httpLinks.map((u) => (
              <MediaUrl key={u} url={u} />
            ))}
            {dataLinks.map((u, idx) => (
              <DataUrlDownload key={`${idx}_${u.slice(0, 30)}`} dataUrl={u} />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (item.kind === "interrupt") {
    return (
      <div className="msg">
        <div className="msgHeader">
          <span className="kind">interrupt</span>
          <span className="kind">{headerRight}</span>
        </div>
        <pre>{pretty(item.interrupt ?? item.raw)}</pre>
      </div>
    );
  }

  return (
    <div className="msg">
      <div className="msgHeader">
        <span className="kind">{item.kind}</span>
        <span className="kind">{headerRight}</span>
      </div>
      <pre>{item.text ?? pretty(item.raw)}</pre>
    </div>
  );
}

function MediaUrl({ url }: { url: string }) {
  const isImage = /\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(url) || url.includes("antv-studio.alipay.com/api/gpt-vis");

  return (
    <div>
      <div className="row" style={{ marginBottom: 6 }}>
        <a href={url} target="_blank" rel="noreferrer">
          {url}
        </a>
        <button
          onClick={async () => {
            const filename = guessFilenameFromUrl(url, "chart.png");
            await downloadUrlAsFile(url, filename);
          }}
        >
          Download
        </button>
      </div>
      {isImage ? <img src={url} alt="tool output" loading="lazy" /> : null}
    </div>
  );
}

function DataUrlDownload({ dataUrl }: { dataUrl: string }) {
  const ext = guessExtensionFromDataUrl(dataUrl);
  const filename = `tool-output.${ext}`;

  return (
    <div className="row">
      <span className="small" style={{ fontFamily: "var(--mono)" }}>
        {dataUrl.slice(0, 60)}...
      </span>
      <button onClick={() => downloadDataUrl(dataUrl, filename)}>Download</button>
    </div>
  );
}

function InterruptCard({
  item,
  onResume,
  disabled,
}: {
  item: ChatItem;
  onResume: (type: "accept" | "edit" | "ignore" | "response", args: any) => Promise<void>;
  disabled: boolean;
}) {
  const interrupt = item.interrupt;
  const cfg = interrupt?.config ?? {};

  const [editAction, setEditAction] = useState<string>(interrupt?.action_request?.action ?? "");
  const [editArgs, setEditArgs] = useState<string>(() => {
    const args = interrupt?.action_request?.args;
    if (args === undefined) return "";
    return typeof args === "string" ? args : JSON.stringify(args, null, 2);
  });
  const [responseText, setResponseText] = useState<string>("");

  const parsedEditArgs = useMemo(() => {
    const v = editArgs.trim();
    if (!v) return null;
    const parsed = safeJsonParse(v);
    return parsed ?? v;
  }, [editArgs]);

  return (
    <div className="msg" style={{ borderColor: "rgba(37,99,235,0.35)" }}>
      <div className="msgHeader">
        <span className="kind">interrupt</span>
        <span className="kind">{item.title}</span>
      </div>

      <div className="small" style={{ marginBottom: 8 }}>
        {interrupt?.description ?? "Agent requested confirmation."}
      </div>

      <div className="kv">
        <div>action</div>
        <div>
          <code style={{ fontFamily: "var(--mono)" }}>{interrupt?.action_request?.action ?? ""}</code>
        </div>
        <div>args</div>
        <div>
          <pre>{pretty(interrupt?.action_request?.args)}</pre>
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <div className="row">
          <button
            className="primary"
            disabled={disabled || cfg.allow_accept === false}
            onClick={() =>
              onResume("accept", {
                action: interrupt?.action_request?.action,
                args: interrupt?.action_request?.args,
              })
            }
          >
            Accept
          </button>
          <button
            disabled={disabled || cfg.allow_ignore === false}
            onClick={() => onResume("ignore", null)}
          >
            Ignore
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="small">Edit (action + args JSON) then resume</div>
        <div style={{ marginTop: 6 }}>
          <input
            value={editAction}
            onChange={(e) => setEditAction(e.target.value)}
            placeholder="action name"
          />
        </div>
        <div style={{ marginTop: 6 }}>
          <textarea
            value={editArgs}
            onChange={(e) => setEditArgs(e.target.value)}
            placeholder="args (JSON or string)"
          />
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <button
            className="primary"
            disabled={disabled || cfg.allow_edit === false}
            onClick={() =>
              onResume("edit", {
                action: editAction,
                args: parsedEditArgs,
              })
            }
          >
            Edit & Resume
          </button>
        </div>
      </div>

      <div style={{ marginTop: 12 }}>
        <div className="small">Response (adds a follow-up user message)</div>
        <div style={{ marginTop: 6 }}>
          <textarea
            value={responseText}
            onChange={(e) => setResponseText(e.target.value)}
            placeholder="Tell the agent what to do instead..."
          />
        </div>
        <div className="row" style={{ marginTop: 6 }}>
          <button
            className="primary"
            disabled={disabled || cfg.allow_respond === false || !responseText.trim()}
            onClick={() => onResume("response", responseText.trim())}
          >
            Response & Resume
          </button>
        </div>
      </div>

      <div className="small" style={{ marginTop: 10 }}>
        Resume payload shape: <code style={{ fontFamily: "var(--mono)" }}>forwarded_props.command.resume</code>
      </div>
    </div>
  );
}
