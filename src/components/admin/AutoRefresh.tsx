"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** İşlenmekte olan kaynak varken sayfayı birkaç saniyede bir tazeler. */
export function AutoRefresh({ active, every = 3000 }: { active: boolean; every?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [active, every, router]);
  return null;
}
