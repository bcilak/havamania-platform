import { prepareTurn, streamTurn, type ChatInput } from "./turn";

/* Orkestratör src/lib/ai/turn.ts içindedir; bu dosya geriye uyumlu giriş noktasıdır. */
export { ChatError, type ChatInput } from "./turn";

export async function handleChat(input: ChatInput): Promise<Response> {
  return streamTurn(await prepareTurn(input));
}
