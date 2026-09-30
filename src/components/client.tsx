"use client";

import { Check, Copy, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { btn, cx } from "./ui";

type Variant = Parameters<typeof btn>[0];
type Size = Parameters<typeof btn>[1];

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  pendingText,
  className,
  name,
  value,
  formAction,
}: {
  children: ReactNode;
  variant?: Variant;
  size?: Size;
  pendingText?: string;
  className?: string;
  name?: string;
  value?: string;
  formAction?: (fd: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} formAction={formAction} disabled={pending} className={cx(btn(variant, size), className)}>
      {pending && <LoaderCircle className="size-3.5 animate-spin" />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/**
 * Geri alınamayan işlemler için iki adımlı onay. confirm() diyaloğu yerine
 * buton kendisi "Emin misiniz?" hâline geçer; 4 saniye içinde tekrar basılmazsa geri döner.
 */
export function ConfirmButton({
  children,
  confirmText = "Emin misiniz? Tekrar basın",
  variant = "danger",
  size = "sm",
  className,
  formAction,
  name,
  value,
}: {
  children: ReactNode;
  confirmText?: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  formAction?: (fd: FormData) => void | Promise<void>;
  name?: string;
  value?: string;
}) {
  const [armed, setArmed] = useState(false);
  const { pending } = useFormStatus();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  if (!armed) {
    return (
      <button
        type="button"
        className={cx(btn(variant === "danger" ? "danger" : variant, size), className)}
        onClick={() => {
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 4000);
        }}
      >
        {children}
      </button>
    );
  }
  return (
    <button
      type="submit"
      name={name}
      value={value}
      formAction={formAction}
      disabled={pending}
      className={cx(btn(variant === "danger" ? "danger" : "primary", size), variant === "danger" && "bg-bad-soft", className)}
    >
      {pending && <LoaderCircle className="size-3.5 animate-spin" />}
      {confirmText}
    </button>
  );
}

export function CopyButton({ text, label = "Kopyala", className }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<"idle" | "done" | "failed">("idle");
  return (
    <button
      type="button"
      className={cx(btn("secondary", "sm"), className)}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setState("done");
        } catch {
          setState("failed");
        }
        setTimeout(() => setState("idle"), 1600);
      }}
    >
      {state === "done" ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {state === "done" ? "Kopyalandı" : state === "failed" ? "Seçip kopyalayın" : label}
    </button>
  );
}
