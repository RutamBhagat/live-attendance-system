import { pgTable, text, uuid, pgEnum } from "drizzle-orm/pg-core";

const userRole = pgEnum("user_role", ["teacher", "student"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: userRole("role").notNull().default("student"),
});

export const classes = pgTable("classes", {
  id: uuid("id").primaryKey().defaultRandom(),
  className: text("class_name").notNull(),
  teacherId: uuid("teacher_id").references(() => users.id),
  studentIds: uuid("student_ids").array().notNull().default([]),
});

const attendanceStatus = pgEnum("attendance_status", ["present", "absent"]);

export const attendance = pgTable("attendance", {
  id: uuid("id").primaryKey().defaultRandom(),
  classId: uuid("class_id").references(() => classes.id),
  studentId: uuid("student_id").references(() => users.id),
  status: attendanceStatus("status").notNull().default("absent"),
});
