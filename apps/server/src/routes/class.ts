import { Hono } from "hono";
import { z } from "zod";
import { db } from "@100x-sem-1-assignment/db";
import { classes, classEnrollments } from "@100x-sem-1-assignment/db/schema";
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

    return c.json(
      { success: true, data: { ...newClass, studentIds: [] } },
      201
    );
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

    const existing = await db.query.classEnrollments.findFirst({
      where: {
        classId: id,
        studentId,
      },
    });

    if (!existing) {
      await db.insert(classEnrollments).values({
        classId: id,
        studentId,
      });
    }

    const updatedClass = await db.query.classes.findFirst({
      where: { id },
      with: { enrollments: true },
    });

    if (!updatedClass) {
      return c.json(
        { success: false, error: "Failed to add student to class" },
        500
      );
    }

    const studentIds = updatedClass.enrollments.map((e) => e.studentId);
    return c.json(
      { success: true, data: { ...updatedClass, studentIds } },
      200
    );
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

  if (role === "student") {
    const enrollment = await db.query.classEnrollments.findFirst({
      where: {
        classId: id,
        studentId: userId,
      },
    });

    if (!enrollment) {
      return c.json(
        { success: false, error: "Forbidden, not class teacher" },
        403
      );
    }
  }

  const enrollments = await db.query.classEnrollments.findMany({
    where: { classId: id },
    with: {
      student: {
        columns: { id: true, name: true, email: true },
      },
    },
  });

  const students = enrollments.map((e) => e.student);
  const studentIds = enrollments.map((e) => e.studentId);

  return c.json(
    {
      success: true,
      data: { ...classData, students, studentIds },
    },
    200
  );
});
