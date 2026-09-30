// drizzle-kit eklenti oluşturmaz; şema itilmeden önce pgvector açılmalı.
import postgres from "postgres";

const sql = postgres(process.env.DATABASE_URL!, { max: 1 });
await sql`create extension if not exists vector`;
const [{ extversion }] = await sql`select extversion from pg_extension where extname = 'vector'`;
console.log(`pgvector hazır (sürüm ${extversion})`);
await sql.end();
