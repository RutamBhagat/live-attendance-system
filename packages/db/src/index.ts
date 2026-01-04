import { env } from "@100x-sem-1-assignment/env/server";
import { drizzle } from "drizzle-orm/node-postgres";

import { relations } from "./relations";

export const db = drizzle(env.DATABASE_URL, { relations });
export * from "./schema";
export { eq, and } from "drizzle-orm";
