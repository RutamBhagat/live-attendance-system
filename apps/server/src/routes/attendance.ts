import type { TAttendanceStatus } from "@100x-sem-1-assignment/db";
import { Hono } from "hono";
import { z } from "zod";
import { authMiddleware, requireRole } from "@/middleware/auth";
import { zValidator } from "@hono/zod-validator";
import { db } from "@100x-sem-1-assignment/db";
import type { AuthVariables } from "./auth";

export const attendanceRouter = new Hono<{ Variables: AuthVariables }>();

const startAttendanceSchema = z.object({
  classId: z.uuid(),
});

export type ActiveSession = {
  classId: string;
  startedAt: string;
  attendance: Record<string, TAttendanceStatus>;
} | null;

export let activeSession: ActiveSession = null;

export function clearActiveSession() {
  activeSession = null;
}

attendanceRouter.post(
  "/start",
  authMiddleware,
  requireRole("teacher"),
  zValidator("json", startAttendanceSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: "Invalid request schema" }, 400);
    }
  }),
  async (c) => {
    const { userId } = c.get("user");
    const { classId } = c.req.valid("json");

    const classData = await db.query.classes.findFirst({
      where: { id: classId },
    });

    if (!classData) {
      return c.json({ success: false, error: "Class not found" }, 404);
    }

    if (classData.teacherId !== userId) {
      return c.json(
        { success: false, error: "Forbidden, not class teacher" },
        403
      );
    }

    activeSession = {
      classId,
      startedAt: new Date().toISOString(),
      attendance: {},
    };

    return c.json({ success: true, data: activeSession }, 200);
  }
);
