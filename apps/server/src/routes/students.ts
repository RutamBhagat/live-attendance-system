import { Hono } from "hono";
import { authMiddleware, requireRole } from "@/middleware/auth";
import type { AuthVariables } from "./auth";
import { db } from "@100x-sem-1-assignment/db";

export const studentsRouter = new Hono<{ Variables: AuthVariables }>();

studentsRouter.get("/", authMiddleware, requireRole("teacher"), async (c) => {
  const students = await db.query.users.findMany({
    where: { role: "student" },
    columns: {
      id: true,
      name: true,
      email: true,
    },
  });
  return c.json({ success: true, data: students });
});
