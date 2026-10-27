"use client";

import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { CountedTextarea, SubmitButton } from "@/components/client";
import { checkboxCls, Field, inputCls, selectCls, textareaCls } from "@/components/ui";
import { SIMILAR_REASON_LABEL, type SimilarMatch, type SimilarState } from "@/lib/ai/similar-core";
import { MODES, MODE_META } from "@/lib/bot-config";

const TYPE_LABEL: Record<string, string> = { qa: "SSS", correction: "Düzeltme" };

/**
 * SSS, düzeltme ve kaynak düzenleme formu. Sunucu eylemi benzer kayıt bulursa kayıt
 * oluşturmadan uyarıyı döndürür; form değerleri korunur ve "Benzer kayıt olsa da kaydet"
 * kutusu işaretlenip tekrar gönderilebilir. Başarıda eylem yönlendirir.
 */
export function SourceForm({
  action,
  idPrefix,
  hidden,
  showTitle = false,
  showQa = true,
  initial,
  answerMax,
  answerRows = 3,
  questionLabel = "Soru",
  questionHint,
  questionRows,
  answerLabel = "Cevap",
  answerName = "answer",
  modeName = "mode",
  modeOptions,
  submitLabel,
  pendingText,
  resetOnSuccess = false,
}: {
  action: (fd: FormData) => Promise<SimilarState | void>;
  idPrefix: string;
  hidden?: Record<string, string>;
  showTitle?: boolean;
  showQa?: boolean;
  initial?: { title?: string; question?: string; answer?: string; mode?: string };
  answerMax: number;
  answerRows?: number;
  questionLabel?: string;
  questionHint?: string;
  /** Verilirse soru çok satırlı alan olur. */
  questionRows?: number;
  answerLabel?: string;
  /** Cevap alanının form adı (varsayılan "answer"). */
  answerName?: string;
  /** Mod alanının form adı (varsayılan "mode"). */
  modeName?: string;
  /** Varsayılan: Tüm modlar + her mod. */
  modeOptions?: { value: string; label: string }[];
  submitLabel: string;
  pendingText: string;
  /** Ekleme formlarında başarıdan sonra alanlar boşaltılır. */
  resetOnSuccess?: boolean;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [question, setQuestion] = useState(initial?.question ?? "");
  const [answer, setAnswer] = useState(initial?.answer ?? "");
  const [mode, setMode] = useState(initial?.mode ?? "all");
  const [similar, setSimilar] = useState<SimilarMatch[]>([]);
  const [force, setForce] = useState(false);

  async function submit(fd: FormData) {
    try {
      const result = await action(fd);
      setSimilar(result?.similar ?? []);
      setForce(false);
    } catch (e) {
      // Başarıda eylem yönlendirir (Next bunu NEXT_REDIRECT hatasıyla bildirir). Ekleme formu, hata mesajına yönlenmediyse temizlenir; hata yine iletilir.
      const digest = String((e as { digest?: unknown } | null)?.digest ?? "");
      if (resetOnSuccess && digest.startsWith("NEXT_REDIRECT") && !digest.includes("hata=")) {
        setTitle("");
        setQuestion("");
        setAnswer("");
        setSimilar([]);
        setForce(false);
      }
      throw e;
    }
  }

  return (
    <form action={submit} className="grid gap-3">
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {showTitle && (
        <Field label="Başlık" htmlFor={`${idPrefix}-title`}>
          <input id={`${idPrefix}-title`} name="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputCls} />
        </Field>
      )}
      {showQa && (
        <>
          <Field label={questionLabel} hint={questionHint} htmlFor={`${idPrefix}-question`}>
            {questionRows ? (
              <textarea id={`${idPrefix}-question`} name="question" rows={questionRows} required value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000} className={textareaCls} />
            ) : (
              <input id={`${idPrefix}-question`} name="question" required value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={1000} className={inputCls} />
            )}
          </Field>
          <Field label={answerLabel} htmlFor={`${idPrefix}-answer`}>
            <CountedTextarea
              id={`${idPrefix}-answer`}
              name={answerName}
              rows={answerRows}
              required
              max={answerMax}
              value={answer}
              onChange={(e) => setAnswer(e.currentTarget.value)}
              className={textareaCls}
            />
          </Field>
        </>
      )}
      <Field label="Geçerli olduğu mod" htmlFor={`${idPrefix}-mode`}>
        <select id={`${idPrefix}-mode`} name={modeName} value={mode} onChange={(e) => setMode(e.target.value)} className={selectCls}>
          {(modeOptions ?? [{ value: "all", label: "Tüm modlar" }, ...MODES.map((m) => ({ value: m, label: `Yalnızca ${MODE_META[m].label}` }))]).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Field>

      {similar.length > 0 && (
        <div role="alert" className="grid gap-2 rounded-xl bg-warn-soft px-4 py-3 text-sm">
          <div className="flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
            <div className="min-w-0">
              <p className="font-medium">Benzer kayıt var; kaydedilmedi.</p>
              <ul className="mt-1.5 grid gap-1.5">
                {similar.map((m) => (
                  <li key={m.id} className="min-w-0">
                    <Link href={`/admin/egitim/bilgi-tabani/${m.id}`} className="font-medium text-accent break-words hover:underline">
                      {m.question}
                    </Link>
                    <span className="text-xs text-muted">
                      {" "}
                      · {TYPE_LABEL[m.type] ?? m.type} · {m.mode === "all" ? "Tüm modlar" : (MODE_META[m.mode as keyof typeof MODE_META]?.label ?? m.mode)} · {SIMILAR_REASON_LABEL[m.reason]}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="force" checked={force} onChange={(e) => setForce(e.target.checked)} className={checkboxCls} />
            Benzer kayıt olsa da kaydet
          </label>
        </div>
      )}

      <SubmitButton pendingText={pendingText}>{submitLabel}</SubmitButton>
    </form>
  );
}
