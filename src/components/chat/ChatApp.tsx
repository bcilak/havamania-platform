"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import {
  ArrowUp,
  BookOpen,
  Camera,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
  Square,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMode } from "@/db/schema";
import { cx } from "@/components/ui";
import { Linkify, Markdown } from "./Markdown";

export type ModeInfo = { id: ChatMode; label: string; greeting: string; suggestions: string[]; disclaimer?: string };

type Props = {
  variant: "widget" | "playground";
  botKey?: string;
  modes: ModeInfo[];
  initialMode: ChatMode;
  photosEnabled: boolean;
  maxPhotoMb: number;
  toolLabels: Record<string, string>;
};

type Init = {
  deviceId: string;
  platform: "ios" | "android" | "web";
  userToken?: string;
  mode?: ChatMode;
  lockMode?: boolean;
  appVersion?: string;
  locale?: string;
  location?: { lat: number; lon: number; name?: string } | null;
};

type Pending = { id: string; previewUrl: string; mediaType: string; uploading: boolean; error?: string };

type Debug = {
  model: string | null;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  unanswered: boolean;
  error: string | null;
  sources: { title: string; score: number; snippet: string }[];
  toolCalls: { name: string; input: unknown; output: unknown }[];
};

/* ---------- Native köprü ---------- */

declare global {
  interface Window {
    __HAVAMANIA_INIT__?: Partial<Init>;
    havamania?: { init: (data: Partial<Init>) => void };
    webkit?: { messageHandlers?: { havamania?: { postMessage: (m: unknown) => void } } };
    HavamaniaAndroid?: { postMessage: (m: string) => void };
  }
}

function hasBridge(): boolean {
  try {
    return Boolean(window.webkit?.messageHandlers?.havamania || window.HavamaniaAndroid || window.parent !== window);
  } catch {
    return false;
  }
}

function toNative(msg: { type: string; [k: string]: unknown }) {
  try {
    if (window.webkit?.messageHandlers?.havamania) window.webkit.messageHandlers.havamania.postMessage(msg);
    else if (window.HavamaniaAndroid) window.HavamaniaAndroid.postMessage(JSON.stringify(msg));
    else if (window.parent !== window) window.parent.postMessage({ source: "havamania-chat", ...msg }, "*");
  } catch {
    /* köprü yoksa sessizce geç */
  }
}

function readInit(): Init {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.slice(1));
  const injected = window.__HAVAMANIA_INIT__ ?? {};
  let deviceId = q.get("deviceId") || injected.deviceId || "";
  if (!deviceId) {
    try {
      deviceId = localStorage.getItem("hm_device") || crypto.randomUUID();
      localStorage.setItem("hm_device", deviceId);
    } catch {
      deviceId = crypto.randomUUID();
    }
  }
  const lat = Number(q.get("lat"));
  const lon = Number(q.get("lon"));
  const platform = (q.get("platform") || injected.platform || "web") as Init["platform"];
  return {
    deviceId,
    platform: ["ios", "android", "web"].includes(platform) ? platform : "web",
    userToken: h.get("token") || injected.userToken || undefined,
    mode: (q.get("mode") as ChatMode) || injected.mode,
    lockMode: q.get("lockMode") === "1" || injected.lockMode,
    appVersion: q.get("appVersion") || injected.appVersion,
    locale: q.get("locale") || injected.locale || navigator.language,
    location: Number.isFinite(lat) && Number.isFinite(lon) && q.get("lat") ? { lat, lon, name: q.get("place") || undefined } : (injected.location ?? null),
  };
}

function errorText(e: Error | undefined): string | null {
  if (!e) return null;
  try {
    const parsed = JSON.parse(e.message);
    if (parsed?.error) return String(parsed.error);
  } catch {
    /* düz metin */
  }
  return e.message && e.message.length < 200 ? e.message : "Bağlantı sorunu oluştu. Tekrar deneyin.";
}

function textOf(m: UIMessage): string {
  return m.parts
    .filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n");
}

/* ---------- Dış kabuk: oturum ve onay ---------- */

export function ChatApp(props: Props) {
  const [init, setInit] = useState<Init | null>(null);
  const [session, setSession] = useState<
    | { state: "loading" }
    | { state: "consent"; text: string; version: number }
    | { state: "ready"; token: string | null; conversationId: string; mode: ChatMode; history: UIMessage[] }
    | { state: "error"; message: string }
  >({ state: "loading" });
  // Kapat/Vazgeç yalnızca kapatabilecek bir taraf (uygulama ya da gömen site) varsa gösterilir.
  const [bridge, setBridge] = useState(false);
  useEffect(() => setBridge(hasBridge()), []);

  const startSession = useCallback(
    async (data: Init, consentVersion?: number) => {
      if (props.variant === "playground") {
        setSession({ state: "ready", token: null, conversationId: crypto.randomUUID(), mode: props.initialMode, history: [] });
        return;
      }
      setSession({ state: "loading" });
      try {
        const res = await fetch("/api/widget/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ botKey: props.botKey, ...data, consentVersion }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Oturum açılamadı.");
        if (json.consentRequired) {
          setSession({ state: "consent", text: json.consentText, version: json.consentVersion });
          return;
        }
        // Mod: uygulamanın istediği > son konuşmanınki > varsayılan. Kapatılmış bir mod asla seçilmez.
        const enabled = (m: unknown): m is ChatMode => typeof m === "string" && props.modes.some((x) => x.id === m);
        const last = json.conversation as { id: string; mode: string; messages: UIMessage[] } | null;
        const mode: ChatMode = enabled(data.mode) ? data.mode : enabled(last?.mode) ? last.mode : props.initialMode;
        // Geçmiş yalnızca aynı moddaysa devam ettirilir; aksi hâlde yeni konuşma açılır.
        const resume = last && last.mode === mode ? last : null;
        setSession({
          state: "ready",
          token: json.token,
          conversationId: resume?.id ?? crypto.randomUUID(),
          mode,
          history: resume?.messages ?? [],
        });
        toNative({ type: "ready" });
      } catch (e) {
        setSession({ state: "error", message: e instanceof Error ? e.message : "Oturum açılamadı." });
      }
    },
    [props.variant, props.botKey, props.modes, props.initialMode],
  );

  useEffect(() => {
    const data = props.variant === "playground" ? ({ deviceId: "playground", platform: "web" } as Init) : readInit();
    setInit(data);
    void startSession(data);
    // Uygulama sonradan kimlik/konum gönderebilir: window.havamania.init({...})
    window.havamania = {
      init: (extra) => {
        const merged = { ...data, ...extra };
        setInit(merged);
        void startSession(merged);
      },
    };
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type === "havamania:init" && e.data.data) window.havamania?.init(e.data.data);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [props.variant, startSession]);

  if (session.state === "loading" || !init) {
    return (
      <div className="grid h-full place-items-center text-muted">
        <LoaderCircle className="size-5 animate-spin" />
      </div>
    );
  }
  if (session.state === "error") {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <CircleAlert className="mx-auto mb-2 size-6 text-bad" />
          <p className="text-sm">{session.message}</p>
          <button onClick={() => startSession(init)} className="mt-3 text-sm font-medium text-accent">
            Tekrar dene
          </button>
        </div>
      </div>
    );
  }
  if (session.state === "consent") {
    return (
      <div className="flex h-full flex-col justify-end p-4 sm:justify-center">
        <div className="mx-auto w-full max-w-md rounded-2xl border border-line bg-surface p-5">
          <h2 className="text-base font-semibold">Başlamadan önce</h2>
          <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-muted">
            <Linkify text={session.text} />
          </p>
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => startSession(init, session.version)}
              className="h-11 flex-1 rounded-xl bg-accent text-[15px] font-medium text-white hover:bg-accent-hover"
            >
              Kabul ediyorum
            </button>
            {bridge && (
              <button onClick={() => toNative({ type: "close" })} className="h-11 rounded-xl px-4 text-[15px] text-muted hover:bg-sunken">
                Vazgeç
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
  return (
    <Conversation
      key={session.conversationId}
      {...props}
      init={init}
      token={session.token}
      conversationId={session.conversationId}
      startMode={session.mode}
      history={session.history}
      bridge={bridge}
      onNew={(mode) => setSession({ ...session, conversationId: crypto.randomUUID(), mode, history: [] })}
      onReconnect={() => startSession(init)}
    />
  );
}

/* ---------- Konuşma ---------- */

function Conversation({
  variant,
  modes,
  photosEnabled,
  maxPhotoMb,
  toolLabels,
  init,
  token,
  conversationId,
  startMode,
  history,
  bridge,
  onNew,
  onReconnect,
}: Props & {
  init: Init;
  token: string | null;
  conversationId: string;
  startMode: ChatMode;
  history: UIMessage[];
  bridge: boolean;
  onNew: (mode: ChatMode) => void;
  onReconnect: () => void;
}) {
  const [mode, setMode] = useState<ChatMode>(startMode);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [debug, setDebug] = useState<Record<string, Debug>>({});
  const [voted, setVoted] = useState<Record<string, 1 | -1>>({});
  const [commentFor, setCommentFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;

  // Yazdıkça büyüyen mesaj kutusu (field-sizing iOS WebView'da yok). En fazla ~5 satır.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 132)}px`;
  }, [input]);

  const auth = useMemo<Record<string, string>>(() => (token ? { Authorization: `Bearer ${token}` } : ({} as Record<string, string>)), [token]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        headers: auth,
        prepareSendMessagesRequest: ({ id, messages, body }) => ({
          body: {
            conversationId: id,
            text: textOf(messages[messages.length - 1]),
            mode: modeRef.current,
            location: init.location ?? null,
            playground: variant === "playground",
            ...(body ?? {}),
          },
        }),
      }),
    [auth, init.location, variant],
  );

  const { messages, sendMessage, status, error, stop, clearError } = useChat({ id: conversationId, messages: history, transport });
  const busy = status === "submitted" || status === "streaming";
  const current = modes.find((m) => m.id === mode) ?? modes[0];
  const lockMode = variant === "widget" && init.lockMode;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, status]);

  // Test alanında cevap bitince kaynakları ve araç çağrılarını getir.
  useEffect(() => {
    if (variant !== "playground" || status !== "ready") return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "assistant" || debug[last.id]) return;
    let alive = true;
    const load = async (attempt = 0) => {
      const res = await fetch(`/api/admin/messages/${last.id}`);
      if (res.ok) {
        const d = await res.json();
        if (alive) setDebug((prev) => ({ ...prev, [last.id]: d }));
      } else if (attempt < 4) setTimeout(() => load(attempt + 1), 600);
    };
    void load();
    return () => {
      alive = false;
    };
  }, [variant, status, messages, debug]);

  async function attach(files: FileList | null) {
    if (!files?.length) return;
    for (const file of Array.from(files).slice(0, 4 - pending.length)) {
      const tempId = crypto.randomUUID();
      const previewUrl = URL.createObjectURL(file);
      if (!file.type.startsWith("image/")) continue;
      if (file.size > maxPhotoMb * 1024 * 1024) {
        setPending((p) => [...p, { id: tempId, previewUrl, mediaType: file.type, uploading: false, error: `En fazla ${maxPhotoMb} MB` }]);
        continue;
      }
      setPending((p) => [...p, { id: tempId, previewUrl, mediaType: file.type, uploading: true }]);
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await fetch("/api/widget/upload", { method: "POST", headers: auth, body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Yüklenemedi");
        setPending((p) => p.map((x) => (x.id === tempId ? { ...x, id: json.id, uploading: false } : x)));
      } catch (e) {
        setPending((p) => p.map((x) => (x.id === tempId ? { ...x, uploading: false, error: e instanceof Error ? e.message : "Yüklenemedi" } : x)));
      }
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  function send(text: string) {
    const ready = pending.filter((p) => !p.uploading && !p.error);
    if (busy || (!text.trim() && !ready.length) || pending.some((p) => p.uploading)) return;
    clearError();
    void sendMessage(
      {
        text: text.trim(),
        files: ready.map((p) => ({ type: "file" as const, mediaType: p.mediaType, url: p.previewUrl })),
      },
      { body: { attachmentIds: ready.map((p) => p.id) } },
    );
    setInput("");
    setPending([]);
  }

  async function vote(messageId: string, rating: 1 | -1, comment?: string) {
    setVoted((v) => ({ ...v, [messageId]: rating }));
    await fetch("/api/widget/feedback", {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ messageId, rating, comment }),
    }).catch(() => {});
  }

  const lastIsUser = messages[messages.length - 1]?.role === "user";
  const err = errorText(error);

  return (
    <div className="flex h-full min-h-0 flex-col bg-ground">
      {/* Başlık */}
      <header className="shrink-0 border-b border-line bg-surface/95 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-2.5 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{current.label}</div>
            {variant === "playground" && <div className="text-xs text-muted">Taslak ayarlarla test</div>}
          </div>
          <button
            type="button"
            onClick={() => onNew(mode)}
            className="grid size-9 place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink"
            aria-label="Yeni konuşma"
            title="Yeni konuşma"
          >
            <RotateCcw className="size-4" />
          </button>
          {variant === "widget" && bridge && (
            <button
              type="button"
              onClick={() => toNative({ type: "close" })}
              className="grid size-10 place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink"
              aria-label="Kapat"
            >
              <X className="size-5" />
            </button>
          )}
        </div>
        {!lockMode && modes.length > 1 && (
          <div className="mt-2 flex gap-1.5" role="tablist" aria-label="Mod">
            {modes.map((m) => (
              <button
                key={m.id}
                role="tab"
                aria-selected={m.id === mode}
                onClick={() => {
                  if (m.id === mode) return;
                  if (messages.length) onNew(m.id);
                  else setMode(m.id);
                }}
                className={cx(
                  "h-7 rounded-full px-3 text-[13px] transition-colors",
                  m.id === mode ? "bg-ink text-surface" : "bg-sunken text-muted hover:text-ink",
                )}
              >
                {m.id === "genel" ? "Hava" : m.id === "agro" ? "Agro" : "Fly"}
              </button>
            ))}
          </div>
        )}
      </header>

      {/* Mesajlar */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        <div className="mx-auto grid max-w-2xl gap-3">
          <div className="max-w-[88%] rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-2.5 text-[15px] leading-relaxed [overflow-wrap:anywhere]">
            {current.greeting}
          </div>
          {!messages.length && current.suggestions.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {current.suggestions.map((s) => (
                <button key={s} onClick={() => send(s)} className="rounded-full border border-line-strong bg-surface px-3 py-1.5 text-left text-[13.5px] hover:border-accent hover:text-accent">
                  {s}
                </button>
              ))}
            </div>
          )}

          {messages.map((m, idx) => {
            const isUser = m.role === "user";
            const isLast = idx === messages.length - 1;
            const text = textOf(m);
            const files = m.parts.filter((p) => p.type === "file") as { url: string; mediaType: string }[];
            const tools = m.parts.filter((p) => p.type.startsWith("tool-")) as { type: string; state?: string }[];
            const d = debug[m.id];
            return (
              <div key={m.id} className={cx("grid gap-1.5", isUser ? "justify-items-end" : "justify-items-start")}>
                {files.length > 0 && (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {files.map((f, i) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={i} src={f.url} alt="Gönderilen fotoğraf" className="size-28 rounded-xl border border-line object-cover" />
                    ))}
                  </div>
                )}
                {tools.length > 0 && !isUser && (
                  <div className="flex flex-wrap gap-1.5">
                    {tools.map((t, i) => {
                      const name = t.type.slice(5);
                      const running = t.state === "input-streaming" || t.state === "input-available";
                      return (
                        <span key={i} className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-2.5 py-1 text-xs text-muted">
                          {running ? <LoaderCircle className="size-3 animate-spin" /> : <Wrench className="size-3" />}
                          {toolLabels[name] ?? name}
                        </span>
                      );
                    })}
                  </div>
                )}
                {(text || (!isUser && isLast && busy)) && (
                  <div
                    className={cx(
                      "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[15px] leading-relaxed [overflow-wrap:anywhere]",
                      isUser ? "rounded-br-md bg-accent whitespace-pre-wrap text-white" : "rounded-bl-md border border-line bg-surface",
                    )}
                  >
                    {isUser ? text : text ? <Markdown text={text} /> : <TypingDots />}
                  </div>
                )}
                {!isUser && text && !(isLast && busy) && (
                  <div className="grid max-w-[88%] gap-1.5">
                    {current.disclaimer && <p className="px-1 text-[11.5px] leading-snug text-muted">{current.disclaimer}</p>}
                    {variant === "widget" && (
                      <div className="flex items-center gap-1 px-0.5">
                        <button
                          aria-label="Faydalı"
                          disabled={!!voted[m.id]}
                          onClick={() => vote(m.id, 1)}
                          className={cx("grid size-7 place-items-center rounded-full hover:bg-sunken", voted[m.id] === 1 ? "text-good" : "text-faint")}
                        >
                          <ThumbsUp className="size-3.5" />
                        </button>
                        <button
                          aria-label="Faydalı değil"
                          disabled={!!voted[m.id]}
                          onClick={() => {
                            void vote(m.id, -1);
                            setCommentFor(m.id);
                          }}
                          className={cx("grid size-7 place-items-center rounded-full hover:bg-sunken", voted[m.id] === -1 ? "text-bad" : "text-faint")}
                        >
                          <ThumbsDown className="size-3.5" />
                        </button>
                        {voted[m.id] && commentFor !== m.id && <span className="text-xs text-muted">Teşekkürler</span>}
                      </div>
                    )}
                    {commentFor === m.id && (
                      <form
                        className="flex gap-1.5"
                        onSubmit={(e) => {
                          e.preventDefault();
                          const c = new FormData(e.currentTarget).get("c");
                          if (c) void vote(m.id, -1, String(c));
                          setCommentFor(null);
                        }}
                      >
                        <input
                          name="c"
                          autoFocus
                          placeholder="Neyi yanlış buldunuz? (isteğe bağlı)"
                          maxLength={1000}
                          className="h-9 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface px-2.5 text-[16px] sm:text-[13px]"
                        />
                        <button className="h-8 rounded-lg bg-sunken px-3 text-[13px]">Gönder</button>
                      </form>
                    )}
                    {variant === "playground" && d && <DebugPanel d={d} />}
                  </div>
                )}
              </div>
            );
          })}
          {busy && lastIsUser && (
            <div className="w-fit rounded-2xl rounded-bl-md border border-line bg-surface px-3.5 py-3">
              <TypingDots />
            </div>
          )}
          {err && (
            <div role="alert" className="flex items-start gap-2 rounded-xl bg-bad-soft px-3.5 py-2.5 text-sm">
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-bad" />
              <span className="min-w-0 flex-1">{err}</span>
              {/oturum süresi doldu/i.test(err) && (
                <button type="button" onClick={onReconnect} className="shrink-0 font-medium text-accent">
                  Yeniden bağlan
                </button>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>
      </div>

      {/* Yazma alanı */}
      <form
        className="shrink-0 border-t border-line bg-surface px-3 pt-2.5 pb-[max(env(safe-area-inset-bottom),0.625rem)]"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <div className="mx-auto max-w-2xl">
          {pending.length > 0 && (
            <div className="mb-2 flex gap-2">
              {pending.map((p) => (
                <div key={p.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previewUrl} alt="" className={cx("size-14 rounded-lg object-cover", (p.uploading || p.error) && "opacity-50")} />
                  {p.uploading && <LoaderCircle className="absolute inset-0 m-auto size-4 animate-spin text-white" />}
                  {p.error && <span className="absolute inset-x-0 bottom-0 rounded-b-lg bg-bad px-1 text-center text-[9px] text-white">{p.error}</span>}
                  <button
                    type="button"
                    onClick={() => setPending((all) => all.filter((x) => x.id !== p.id))}
                    className="absolute -top-1.5 -right-1.5 grid size-5 place-items-center rounded-full bg-ink text-surface"
                    aria-label="Fotoğrafı kaldır"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            {photosEnabled && (
              <>
                <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => attach(e.target.files)} />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={pending.length >= 4}
                  className="grid size-10 shrink-0 place-items-center rounded-full text-muted hover:bg-sunken hover:text-ink disabled:opacity-40"
                  aria-label="Fotoğraf ekle"
                >
                  <Camera className="size-5" />
                </button>
              </>
            )}
            <textarea
              ref={inputRef}
              value={input}
              maxLength={4000}
              enterKeyHint="send"
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              rows={1}
              placeholder="Bir şey sorun…"
              aria-label="Mesaj"
              // 16px: iOS, daha küçük yazılı kutuya odaklanınca sayfayı zorla yakınlaştırır.
              className="min-h-10 flex-1 resize-none overflow-y-auto rounded-2xl border border-line-strong bg-ground px-3.5 py-2 text-[16px] leading-6 focus:outline-2 focus:-outline-offset-1 focus:outline-accent sm:text-[15px]"
            />
            {busy ? (
              <button type="button" onClick={() => stop()} className="grid size-10 shrink-0 place-items-center rounded-full bg-ink text-surface" aria-label="Durdur">
                <Square className="size-3.5 fill-current" />
              </button>
            ) : (
              <button
                type="submit"
                disabled={pending.some((p) => p.uploading) || (!input.trim() && !pending.some((p) => !p.uploading && !p.error))}
                className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white disabled:opacity-40"
                aria-label="Gönder"
              >
                <ArrowUp className="size-5" />
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1" aria-label="Yazıyor">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-bounce rounded-full bg-faint" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </span>
  );
}

function DebugPanel({ d }: { d: Debug }) {
  return (
    <div className="grid gap-2 rounded-xl border border-dashed border-line-strong bg-surface p-3 text-xs">
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted">
        {d.model && <span className="font-mono">{d.model}</span>}
        {d.latencyMs != null && <span>{(d.latencyMs / 1000).toFixed(1)} sn</span>}
        {d.inputTokens != null && (
          <span>
            {d.inputTokens} + {d.outputTokens} token
          </span>
        )}
        {d.costUsd != null && <span>${Number(d.costUsd).toFixed(4)}</span>}
        {d.unanswered && <span className="font-medium text-warn">Bilgi tabanında karşılık yok</span>}
      </div>
      {d.error && <div className="font-mono break-all text-bad">{d.error}</div>}
      {d.sources.length > 0 && (
        <details>
          <summary className="flex cursor-pointer items-center gap-1.5 text-muted">
            <BookOpen className="size-3.5" /> {d.sources.length} kaynak
          </summary>
          <ul className="mt-1.5 grid gap-1.5">
            {d.sources.map((s, i) => (
              <li key={i}>
                <span className="font-medium">{s.title}</span> <span className="text-muted">· {Math.round(s.score * 100)}</span>
                <p className="line-clamp-2 text-muted">{s.snippet}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      {d.toolCalls.length > 0 && (
        <details>
          <summary className="flex cursor-pointer items-center gap-1.5 text-muted">
            <Wrench className="size-3.5" /> {d.toolCalls.map((t) => t.name).join(", ")}
          </summary>
          <pre className="mt-1.5 max-h-48 overflow-auto rounded bg-sunken p-2 font-mono text-[11px] whitespace-pre-wrap">
            {JSON.stringify(d.toolCalls, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
