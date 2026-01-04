import { defineRelations } from "drizzle-orm";
import * as schema from "./schema";

export const relations = defineRelations(schema, (r) => ({
  users: {
    taughtClasses: r.many.classes(),
    attendanceRecords: r.many.attendance(),
    enrollments: r.many.classEnrollments(),
  },
  classes: {
    teacher: r.one.users({
      from: r.classes.teacherId,
      to: r.users.id,
    }),
    attendanceRecords: r.many.attendance(),
    enrollments: r.many.classEnrollments(),
  },
  attendance: {
    class: r.one.classes({
      from: r.attendance.classId,
      to: r.classes.id,
    }),
    student: r.one.users({
      from: r.attendance.studentId,
      to: r.users.id,
    }),
  },
  classEnrollments: {
    class: r.one.classes({
      from: r.classEnrollments.classId,
      to: r.classes.id,
    }),
    student: r.one.users({
      from: r.classEnrollments.studentId,
      to: r.users.id,
    }),
  },
}));
