"use client";

import { useEffect, useRef } from "react";
import { LandingEngine } from "./engine";

/** Sunucuda üretilen işaretlemeyi basar, ardından kaydırma motorunu bağlar. */
export function LandingMount({ html }: { html: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const engine = new LandingEngine(ref.current, { atmosphere: true, particleDensity: 1, scrollLength: 1 });
    engine.componentDidMount();
    return () => engine.componentWillUnmount();
  }, [html]);
  return <div ref={ref} className="hm-landing" dangerouslySetInnerHTML={{ __html: html }} />;
}
