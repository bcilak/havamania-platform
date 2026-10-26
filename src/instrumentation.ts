/* Sunucu açılışında bir kez çalışır (yalnızca Node çalışma zamanı). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { warnIfLocalTargetsAllowed } = await import("@/lib/net/local-targets");
  warnIfLocalTargetsAllowed();
}
