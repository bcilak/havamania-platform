"use client";

import { useActionState } from "react";
import { SubmitButton } from "@/components/client";
import { selectCls } from "@/components/ui";
import { testIntegration, type TestState } from "./actions";

export function LiveTest({ tools }: { tools: { id: string; label: string }[] }) {
  const [state, action] = useActionState<TestState, FormData>(testIntegration, null);
  return (
    <>
      <form action={action} className="flex gap-2">
        <select name="test" defaultValue={state?.tool ?? tools[0]?.id} className={selectCls} aria-label="Araç">
          {tools.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        <SubmitButton variant="secondary" pendingText="Deneniyor…">
          Dene
        </SubmitButton>
      </form>
      {state && (
        <div className="mt-4 grid gap-2">
          <div className={state.ok ? "text-sm font-medium text-good" : "text-sm font-medium text-bad"}>
            {state.ok ? "Başarılı" : `Başarısız${state.code ? ` (${state.code})` : ""}`}
          </div>
          <pre className="max-h-80 overflow-auto rounded-lg bg-sunken p-3 font-mono text-[12px] whitespace-pre-wrap">{state.body}</pre>
        </div>
      )}
    </>
  );
}
