import { Fragment, type ReactNode } from "react";

/*
 * Model cevapları için küçük ve güvenli bir biçimlendirici: paragraflar,
 * madde işaretleri, numaralı liste, **kalın**, `kod`, bağlantılar ve e-posta adresleri.
 * Başlıklar (## / ###) yalnızca headings verildiğinde başlık olarak çizilir (yasal sayfalar).
 * HTML asla yorumlanmaz; bağlantılar yalnızca http(s) ya da mailto olabilir.
 */

const TOKEN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"]|[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,})/gi;

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (tok.startsWith("**")) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`"))
      out.push(
        <code key={key} className="rounded bg-black/5 px-1 font-mono text-[0.92em] dark:bg-white/10">
          {tok.slice(1, -1)}
        </code>,
      );
    else if (!/^https?:/i.test(tok))
      out.push(
        <a key={key} href={`mailto:${tok}`} className="text-accent underline underline-offset-2 [overflow-wrap:anywhere]">
          {tok}
        </a>,
      );
    else
      out.push(
        <a key={key} href={tok} target="_blank" rel="noopener noreferrer" className="break-all text-accent underline underline-offset-2">
          {tok.replace(/^https?:\/\//, "")}
        </a>,
      );
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Düz metindeki bağlantıları tıklanabilir yapar (KVKK metni gibi). */
export function Linkify({ text }: { text: string }) {
  return <>{inline(text, "l")}</>;
}

const BULLET = /^\s*[-*•]\s+/;
const NUMBER = /^\s*\d+[.)]\s+/;
const HEADING = /^(#{2,3})\s+/;
type Group = { kind: "p" | "ul" | "ol" | "h2" | "h3"; lines: string[] };

/**
 * Satırları ardışık gruplara ayırır. Modeller çoğu zaman "Özet:" satırının hemen
 * altına boş satır bırakmadan madde yazar; blok bazlı ayırma bunu kaçırıyordu.
 */
function group(text: string, headings: boolean): Group[] {
  const out: Group[] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (!line.trim()) {
      out.push({ kind: "p", lines: [] }); // paragraf sonu
      continue;
    }
    const h = headings ? HEADING.exec(line) : null;
    if (h) {
      out.push({ kind: h[1].length === 2 ? "h2" : "h3", lines: [line.slice(h[0].length)] });
      continue;
    }
    const kind = BULLET.test(line) ? "ul" : NUMBER.test(line) ? "ol" : "p";
    const last = out[out.length - 1];
    if (last && last.kind === kind && (kind !== "p" || last.lines.length)) last.lines.push(line);
    else out.push({ kind, lines: [line] });
  }
  return out.filter((g) => g.lines.length);
}

export function Markdown({ text, headings = false, className = "grid gap-2" }: { text: string; headings?: boolean; className?: string }) {
  return (
    <div className={className}>
      {group(text, headings).map((g, gi) => {
        if (g.kind === "h2")
          return (
            <h2 key={gi} className="mt-6 text-lg font-semibold tracking-tight text-ink">
              {inline(g.lines[0], `${gi}`)}
            </h2>
          );
        if (g.kind === "h3")
          return (
            <h3 key={gi} className="mt-3 font-semibold text-ink">
              {inline(g.lines[0], `${gi}`)}
            </h3>
          );
        if (g.kind === "ul" || g.kind === "ol") {
          const List = g.kind;
          const re = g.kind === "ul" ? BULLET : NUMBER;
          return (
            <List key={gi} className={`grid gap-1 pl-5 ${g.kind === "ul" ? "list-disc" : "list-decimal"}`}>
              {g.lines.map((l, li) => (
                <li key={li}>{inline(l.replace(re, ""), `${gi}-${li}`)}</li>
              ))}
            </List>
          );
        }
        return (
          <p key={gi}>
            {g.lines.map((l, li) => (
              <Fragment key={li}>
                {li > 0 && <br />}
                {inline(l.replace(/^#{1,4}\s+/, ""), `${gi}-${li}`)}
              </Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
