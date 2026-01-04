import { Hono } from "hono";
import { z } from "zod";
import { db } from "@100x-sem-1-assignment/db";
import { classes } from "@100x-sem-1-assignment/db/schema";
import { zValidator } from "@hono/zod-validator";

export const classRouter = new Hono();

const createClassSchema = z.object({
  className: z.string().min(1),
});

const addStudentSchema = z.object({
  studentId: z.uuid(),
});

classRouter.post(
  "/",
  zValidator("json", createClassSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: "Invalid request schema" }, 400);
    }
  }),
  async (c) => {
    const { className } = c.req.valid("json");

    const [newClass] = await db
      .insert(classes)
      .values({ className })
      .returning();

    if (!newClass) {
      return c.json({ success: false, error: "Failed to create class" }, 500);
    }

    return c.json({ success: true, data: newClass }, 201);
  }
);
