import { Fragment, type ReactNode } from "react";

/*
 * Model cevapları için küçük ve güvenli bir biçimlendirici: paragraflar,
 * madde işaretleri, numaralı liste, **kalın**, `kod` ve bağlantılar.
 * HTML asla yorumlanmaz; bağlantılar yalnızca http(s) olabilir.
 */

const TOKEN = /(\*\*[^*\n]+\*\*|`[^`\n]+`|https?:\/\/[^\s<>()]*[^\s<>().,;:!?'"])/g;

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
type Group = { kind: "p" | "ul" | "ol"; lines: string[] };

/**
 * Satırları ardışık gruplara ayırır. Modeller çoğu zaman "Özet:" satırının hemen
 * altına boş satır bırakmadan madde yazar; blok bazlı ayırma bunu kaçırıyordu.
 */
function group(text: string): Group[] {
  const out: Group[] = [];
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (!line.trim()) {
      out.push({ kind: "p", lines: [] }); // paragraf sonu
      continue;
    }
    const kind = BULLET.test(line) ? "ul" : NUMBER.test(line) ? "ol" : "p";
    const last = out[out.length - 1];
    if (last && last.kind === kind && (kind !== "p" || last.lines.length)) last.lines.push(line);
    else out.push({ kind, lines: [line] });
  }
  return out.filter((g) => g.lines.length);
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="grid gap-2">
      {group(text).map((g, gi) => {
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
