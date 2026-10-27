"use client";

import { LoaderCircle, ScrollText } from "lucide-react";
import { useMemo, useState } from "react";
import { ChatApp, type ModeInfo } from "@/components/chat/ChatApp";
import { Badge, btn, cx, Field, Notice, selectCls, textareaCls } from "@/components/ui";
import type { ChatMode } from "@/db/schema";
import type { PreviewResponse } from "@/lib/ai/prompt-preview-core";
import { describeMatch } from "@/lib/ai/retrieval-core";
import type { TurnTarget } from "@/lib/ai/turn-core";

export type VersionOption = { id: string; number: number; note: string | null; published: boolean };

type Props = {
  versions: VersionOption[];
  /** "draft" | "published" | "v:<sürüm kimliği>" */
  initialSelection: string;
  modes: ModeInfo[];
  initialMode: ChatMode;
  photosEnabled: boolean;
  maxPhotoMb: number;
  toolLabels: Record<string, string>;
};

const MAX_QUESTION = 4000;

export function PlaygroundShell({ versions, initialSelection, ...chat }: Props) {
  const [selection, setSelection] = useState(initialSelection);

  const { target, label } = useMemo<{ target: TurnTarget; label: string }>(() => {
    if (selection === "draft") return { target: "draft", label: "Taslak ayarlarla test" };
    if (selection === "published") {
      const pub = versions.find((v) => v.published);
      return { target: "published", label: pub ? `Yayındaki sürümle test (v${pub.number})` : "Yayındaki sürümle test" };
    }
    const id = selection.slice(2);
    const v = versions.find((x) => x.id === id);
    return { target: { versionId: id }, label: v ? `v${v.number} sürümüyle test` : "Sürümle test" };
  }, [selection, versions]);

  const published = versions.find((v) => v.published);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="Hangi ayarlarla denensin?"
          htmlFor="hedef"
          className="min-w-64"
          hint="Sürüm yayınlandığı andaki ayarları, bilgi tabanı kaynaklarını ve embedding modelini kullanır. Seçimi değiştirince yeni konuşma açılır."
        >
          <select id="hedef" value={selection} onChange={(e) => setSelection(e.target.value)} className={selectCls}>
            <option value="draft">Taslak (hazır tüm kaynaklar)</option>
            {published && <option value="published">Yayındaki sürüm (v{published.number})</option>}
            {versions.length > 0 && (
              <optgroup label="Belirli bir sürüm">
                {versions.map((v) => (
                  <option key={v.id} value={`v:${v.id}`}>
                    v{v.number}
                    {v.published ? " (yayında)" : ""}
                    {v.note ? ` · ${v.note.slice(0, 40)}` : ""}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </Field>
      </div>

      <div className="h-[min(760px,calc(100dvh-220px))] min-h-[480px] overflow-hidden rounded-2xl border border-line">
        <ChatApp
          key={selection}
          variant="playground"
          playgroundTarget={target}
          playgroundLabel={label}
          modes={chat.modes}
          initialMode={chat.initialMode}
          photosEnabled={chat.photosEnabled}
          maxPhotoMb={chat.maxPhotoMb}
          toolLabels={chat.toolLabels}
        />
      </div>

      <PromptPanel target={target} modes={chat.modes} initialMode={chat.initialMode} />
    </div>
  );
}

function PromptPanel({ target, modes, initialMode }: { target: TurnTarget; modes: ModeInfo[]; initialMode: ChatMode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<ChatMode>(initialMode);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PreviewResponse | null>(null);

  async function run() {
    if (busy || !text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/prompt-preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode, text: text.trim(), target }),
        cache: "no-store",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || "Prompt getirilemedi.");
      setResult(json as PreviewResponse);
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "Prompt getirilemedi.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-line bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-5 py-3.5 text-left text-[15px] font-semibold"
      >
        <ScrollText className="size-4 text-muted" /> Sistem promptunu göster
        <span className="ml-auto text-xs font-normal text-muted">{open ? "Gizle" : "Aç"}</span>
      </button>
      {open && (
        <div className="grid gap-4 border-t border-line p-5">
          <p className="text-[13px] leading-relaxed text-muted">
            Seçili hedef için modele gidecek sistem talimatını, bilgi tabanından gelen parçaları ve araçları gösterir. Model çağrılmaz, hiçbir kayıt oluşmaz. Eşik ayarını (benzerlik) buradan sınayın.
          </p>
          <div className="grid gap-3 sm:grid-cols-[12rem_1fr]">
            <Field label="Mod" htmlFor="pp-mod">
              <select id="pp-mod" value={mode} onChange={(e) => setMode(e.target.value as ChatMode)} className={selectCls}>
                {modes.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Örnek soru" htmlFor="pp-soru" hint={`${text.length}/${MAX_QUESTION}`}>
              <textarea
                id="pp-soru"
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={MAX_QUESTION}
                rows={2}
                placeholder="Örn. Salı sabahı ilaçlama yapabilir miyim?"
                className={textareaCls}
              />
            </Field>
          </div>
          <div>
            <button type="button" onClick={run} disabled={busy || !text.trim()} className={btn("secondary")}>
              {busy && <LoaderCircle className="size-4 animate-spin" />} Promptu getir
            </button>
          </div>
          {error && <Notice tone="warn">{error}</Notice>}
          {result && <PreviewResult r={result} />}
        </div>
      )}
    </section>
  );
}

function PreviewResult({ r }: { r: PreviewResponse }) {
  const inCtx = r.hits.filter((h) => h.inContext).length;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted">
        <Badge tone="accent">{r.targetLabel}</Badge>
        <span>{r.model ?? "model seçilmedi"}</span>
        <span>yaklaşık {r.approxInputTokens.toLocaleString("tr-TR")} token (sistem talimatı)</span>
        <span>
          {inCtx} / {r.hits.length} parça bağlama girdi
        </span>
      </div>
      {r.notes.map((n) => (
        <Notice key={n} tone="warn">
          {n}
        </Notice>
      ))}

      <div>
        <h3 className="mb-1.5 text-[13px] font-semibold">Sistem talimatı</h3>
        <pre className="max-h-96 overflow-auto rounded-lg bg-sunken p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">{r.instructions}</pre>
        {r.instructionsTruncated && <p className="mt-1 text-xs text-warn">Metin çok uzun olduğu için burada kısaltıldı; token tahmini tam metne göredir.</p>}
      </div>

      <div>
        <h3 className="mb-1.5 text-[13px] font-semibold">Bilgi tabanı parçaları</h3>
        {r.hits.length === 0 ? (
          <p className="text-sm text-muted">Bu soru için eşleşen parça bulunamadı.</p>
        ) : (
          <ul className="grid gap-2">
            {r.hits.map((h) => (
              <li key={h.chunkId} className={cx("rounded-lg border border-line p-3 text-sm", !h.inContext && "bg-sunken/60 text-muted")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{h.title}</span>
                  <Badge tone={h.inContext ? "good" : "neutral"}>{h.inContext ? "bağlama girdi" : h.relevant ? "bağlama girmedi (sıra dışı)" : "bağlama girmedi (eşik altı)"}</Badge>
                  <span className="text-xs">{describeMatch(h) ?? "eşleşme zayıf"}</span>
                </div>
                <p className="mt-1.5 line-clamp-3 text-[13px] whitespace-pre-wrap">
                  {h.content}
                  {h.contentTruncated ? "…" : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <h3 className="mb-1.5 text-[13px] font-semibold">Araçlar</h3>
        {r.toolsAvailable && r.tools.length > 0 ? (
          <ul className="list-disc pl-5 text-sm">
            {r.tools.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Bu istekte araç kullanılmıyor.</p>
        )}
      </div>
    </div>
  );
}
