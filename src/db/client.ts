import { neon } from "@neondatabase/serverless";

let sqlInstance: ReturnType<typeof neon> | null = null;

export function getSql() {
  if (sqlInstance) {
    return sqlInstance;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("Missing required environment variable: DATABASE_URL");
  }

  sqlInstance = neon(connectionString);
  return sqlInstance;
}
