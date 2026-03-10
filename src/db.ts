import { Pool, PoolClient } from "pg";
import { neon, NeonQueryFunction } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config();

// ─── Query helper types ────────────────────────────────────────────────────────
interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
}

type QueryFn = (text: string, params?: (string | number | null | undefined)[]) => Promise<QueryResult>;

// ─── Driver selection ──────────────────────────────────────────────────────────
let query: QueryFn;
let pool: Pool | null = null;

if (process.env.NODE_ENV === "production") {
  const sql: NeonQueryFunction<false, false> = neon(process.env.DATABASE_URL!);

  query = async (text: string, params?: (string | number | null | undefined)[]): Promise<QueryResult> => {
    const result = await sql(text, params as (string | number | null | boolean | undefined)[]);
    return { rows: result as Record<string, unknown>[] };
  };
} else {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  query = async (text: string, params?: (string | number | null | undefined)[]): Promise<QueryResult> => {
    return pool!.query(text, params);
  };
}

// ─── Client helper (transactions — dev only) ───────────────────────────────────
const getClient = async (): Promise<PoolClient> => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Transactions not supported in serverless mode directly");
  }
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
  }
  return pool.connect();
};

// ─── Database initialisation ───────────────────────────────────────────────────
const initDB = async (): Promise<void> => {
  await query(`
    CREATE TABLE IF NOT EXISTS contact (
      id              SERIAL PRIMARY KEY,
      "phoneNumber"   VARCHAR(20),
      email           VARCHAR(255),
      "linkedId"      INTEGER REFERENCES contact(id),
      "linkPrecedence" VARCHAR(10) NOT NULL CHECK ("linkPrecedence" IN ('primary', 'secondary')),
      "createdAt"     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "updatedAt"     TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "deletedAt"     TIMESTAMP WITH TIME ZONE
    )
  `);

  await query(`CREATE INDEX IF NOT EXISTS idx_contact_email ON contact(email)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_contact_phone ON contact("phoneNumber")`);
  await query(`CREATE INDEX IF NOT EXISTS idx_contact_linkedId ON contact("linkedId")`);

  console.log("✅ Database initialised — contact table & indexes ready");
};

export { query, getClient, initDB };
