import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL tanımlı değil. .env.local dosyasına bakın.");

// Geliştirmede her hot-reload yeni bir bağlantı havuzu açmasın.
const globalForDb = globalThis as unknown as { __hmSql?: ReturnType<typeof postgres> };
const client = globalForDb.__hmSql ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") globalForDb.__hmSql = client;

export const db = drizzle(client, { schema });
export const sqlClient = client;
export { schema };
