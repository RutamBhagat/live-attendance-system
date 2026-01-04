import { Hono } from "hono";
import { z } from "zod";
import { db, eq } from "@100x-sem-1-assignment/db";
import { classes } from "@100x-sem-1-assignment/db/schema";
import { zValidator } from "@hono/zod-validator";
import { authMiddleware, requireRole } from "@/middleware/auth";
import type { AuthVariables } from "./auth";

export const classRouter = new Hono<{ Variables: AuthVariables }>();

const createClassSchema = z.object({
  className: z.string().min(1),
});

const addStudentSchema = z.object({
  studentId: z.uuid(),
});

classRouter.post(
  "/",
  authMiddleware,
  requireRole("teacher"),
  zValidator("json", createClassSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: "Invalid request schema" }, 400);
    }
  }),
  async (c) => {
    const { userId } = c.get("user");
    const { className } = c.req.valid("json");

    const [newClass] = await db
      .insert(classes)
      .values({ className, teacherId: userId })
      .returning();

    if (!newClass) {
      return c.json({ success: false, error: "Failed to create class" }, 500);
    }

    return c.json({ success: true, data: newClass }, 201);
  }
);

classRouter.post(
  "/:id/add-student",
  authMiddleware,
  requireRole("teacher"),
  zValidator("json", addStudentSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: "Invalid request schema" }, 400);
    }
  }),
  async (c) => {
    const { userId } = c.get("user");
    const id = c.req.param("id");
    const { studentId } = c.req.valid("json");

    const classData = await db.query.classes.findFirst({
      where: {
        id,
      },
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

    const student = await db.query.users.findFirst({
      where: { id: studentId, role: "student" },
    });

    if (!student) {
      return c.json({ success: false, error: "Student not found" }, 404);
    }

    const newStudentIds = classData.studentIds.includes(studentId)
      ? classData.studentIds
      : [...classData.studentIds, studentId];

    const [updatedClass] = await db
      .update(classes)
      .set({
        studentIds: newStudentIds,
      })
      .where(eq(classes.id, id))
      .returning();

    if (!updatedClass) {
      return c.json(
        { success: false, error: "Failed to add student to class" },
        500
      );
    }

    return c.json({ success: true, data: updatedClass }, 200);
  }
);

classRouter.get("/:id", authMiddleware, async (c) => {
  const { userId, role } = c.get("user");
  const id = c.req.param("id");

  const classData = await db.query.classes.findFirst({
    where: { id },
  });

  if (!classData) {
    return c.json({ success: false, error: "Class not found" }, 404);
  }

  if (role === "teacher" && classData.teacherId !== userId) {
    return c.json(
      { success: false, error: "Forbidden, not class teacher" },
      403
    );
  }

  if (role === "student" && !classData.studentIds.includes(userId)) {
    return c.json(
      { success: false, error: "Forbidden, not class teacher" },
      403
    );
  }

  const students = [];

  for (const studentId of classData.studentIds) {
    const student = await db.query.users.findFirst({
      where: { id: studentId },
    });
    if (student) {
      students.push({
        id: student.id,
        name: student.name,
        email: student.email,
      });
    }
  }
  return c.json({ success: true, data: { ...classData, students } }, 200);
});
