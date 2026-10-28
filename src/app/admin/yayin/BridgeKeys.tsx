"use client";

import { useActionState } from "react";
import { ConfirmButton, CopyButton, SubmitButton } from "@/components/client";
import { Badge, inputCls, Notice, TableWrap, td, th } from "@/components/ui";
import { createBridgeKey, revokeBridgeKey, type BridgeKeyState } from "./actions";

export type BridgeKeyRow = { id: string; name: string; hint: string; created: string; lastUsed: string; revoked: boolean };

export function BridgeKeys({ keys, baseUrl, maxActive }: { keys: BridgeKeyRow[]; baseUrl: string; maxActive: number }) {
  const [state, action] = useActionState<BridgeKeyState, FormData>(createBridgeKey, null);
  const active = keys.filter((k) => !k.revoked).length;
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <div className="text-[13px] font-medium">Temel adres</div>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-sunken px-3 py-2 font-mono text-sm">{baseUrl}</code>
          <CopyButton text={baseUrl} />
        </div>
      </div>

      {state?.ok && (
        <div className="grid gap-2" role="status">
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg bg-warn-soft px-3 py-2 font-mono text-sm">{state.key}</code>
            <CopyButton text={state.key} />
          </div>
          <p className="text-xs font-medium text-warn">Bu anahtar bir daha gösterilmeyecek. Şimdi kopyalayıp backend&apos;e girin.</p>
        </div>
      )}
      {state && !state.ok && (
        <p className="text-sm font-medium text-bad" role="alert">
          {state.error}
        </p>
      )}

      <form action={action} className="flex flex-wrap items-center gap-2">
        <input name="name" required maxLength={60} placeholder="Anahtar adı (ör. FastAPI üretim)" aria-label="Anahtar adı" className={`${inputCls} max-w-xs`} />
        <SubmitButton variant="secondary" pendingText="Oluşturuluyor…">
          Anahtar oluştur
        </SubmitButton>
        <span className="text-xs text-muted">
          {active} / {maxActive} etkin
        </span>
      </form>

      {keys.length > 0 && (
        <TableWrap>
          <thead>
            <tr>
              <th className={th}>Ad</th>
              <th className={th}>Anahtar</th>
              <th className={th}>Oluşturma</th>
              <th className={th}>Son kullanım</th>
              <th className={th}>Durum</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id}>
                <td className={td}>{k.name}</td>
                <td className={`${td} font-mono`}>••••{k.hint}</td>
                <td className={`${td} whitespace-nowrap`}>{k.created}</td>
                <td className={`${td} whitespace-nowrap`}>{k.lastUsed}</td>
                <td className={td}>{k.revoked ? <Badge tone="bad">İptal edildi</Badge> : <Badge tone="good">Etkin</Badge>}</td>
                <td className={`${td} text-right`}>
                  {!k.revoked && (
                    <form action={revokeBridgeKey}>
                      <input type="hidden" name="keyId" value={k.id} />
                      <ConfirmButton confirmText="Bu anahtar iptal edilsin mi?">İptal et</ConfirmButton>
                    </form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      <Notice>İptal en geç 30 sn içinde etkinleşir. Rotasyon için önce yeni anahtar oluşturun, backend&apos;e girin, sonra eskisini iptal edin.</Notice>
    </div>
  );
}
