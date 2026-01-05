import { env } from "@100x-sem-1-assignment/env/server";
import jwt from "jsonwebtoken";
import type { WSContext } from "hono/ws";
import type { JWTPayload } from "@/middleware/auth";
import type { Context } from "hono";
import {
  attendance,
  db,
  type TAttendanceStatus,
} from "@100x-sem-1-assignment/db";
import { getActiveSession, clearActiveSession } from "./routes/attendance";

const clients = new Map<WSContext, JWTPayload>();

function broadcast(message: object) {
  const payload = JSON.stringify(message);
  for (const [ws, _] of clients) {
    if (ws.readyState === 1) {
      // WebSocket.OPEN
      ws.send(payload);
    }
  }
}

async function handleAttendanceMarked(
  data: { studentId: string; status: TAttendanceStatus },
  ws: WSContext,
  user: JWTPayload
) {
  if (user.role !== "teacher") {
    ws.send(
      JSON.stringify({
        event: "ERROR",
        data: { message: "Forbidden, teacher event only" },
      })
    );
    return;
  }

  const activeSession = getActiveSession();
  if (!activeSession) {
    ws.send(
      JSON.stringify({
        event: "ERROR",
        data: { message: "No active attendance session" },
      })
    );
    return;
  }

  const { studentId, status } = data;
  activeSession.attendance[studentId] = status;
  broadcast({ event: "ATTENDANCE_MARKED", data: { studentId, status } });
}

async function handleTodaySummary(ws: WSContext, user: JWTPayload) {
  if (user.role !== "teacher") {
    ws.send(
      JSON.stringify({
        event: "ERROR",
        data: { message: "Forbidden, teacher event only" },
      })
    );
    return;
  }

  const activeSession = getActiveSession();
  if (!activeSession) {
    ws.send(
      JSON.stringify({
        event: "ERROR",
        data: { message: "No active attendance session" },
      })
    );
    return;
  }

  const statuses = Object.values(activeSession.attendance);
  const present = statuses.filter((s) => s === "present").length;
  const absent = statuses.filter((s) => s === "absent").length;
  const total = statuses.length;

  broadcast({ event: "TODAY_SUMMARY", data: { present, absent, total } });
}

async function handleMyAttendance(ws: WSContext, user: JWTPayload) {
  if (user.role !== "student") {
    ws.send(
      JSON.stringify({
        event: "ERROR",
        data: { message: "Forbidden, student event only" },
      })
    );
    return;
  }

  const activeSession = getActiveSession();
  if (!activeSession) {
    ws.send(
      JSON.stringify({
        event: "ERROR",
        data: { message: "No active attendance session" },
      })
    );
    return;
  }

  const status = activeSession.attendance[user.userId] || "not yet updated";

  ws.send(
    JSON.stringify({
      event: "MY_ATTENDANCE",
      data: { status },
    })
  );
}

async function handleDone(ws: WSContext, user: JWTPayload) {
  if (user.role !== "teacher") {
    ws.send(
      JSON.stringify({
        event: "ERROR",
        data: { message: "Forbidden, teacher event only" },
      })
    );
    return;
  }

  const activeSession = getActiveSession();
  if (!activeSession) {
    ws.send(
      JSON.stringify({
        event: "ERROR",
        data: { message: "No active attendance session" },
      })
    );
    return;
  }

  const enrollments = await db.query.classEnrollments.findMany({
    where: {
      classId: activeSession.classId,
    },
  });

  const finalAttendance = { ...activeSession.attendance };
  for (const enrollment of enrollments) {
    if (!(enrollment.studentId in finalAttendance)) {
      finalAttendance[enrollment.studentId] = "absent";
    }
  }

  const records = Object.entries(finalAttendance).map(
    ([studentId, status]) => ({
      classId: activeSession.classId,
      studentId,
      status: status,
    })
  );

  await db.insert(attendance).values(records);

  const statuses = Object.values(finalAttendance);
  const present = statuses.filter((s) => s === "present").length;
  const absent = statuses.filter((s) => s === "absent").length;
  const total = statuses.length;

  clearActiveSession();

  broadcast({
    event: "DONE",
    data: { message: "Attendance persisted", present, absent, total },
  });
}

async function handleMessage(msg: any, ws: WSContext, user: JWTPayload) {
  switch (msg.event) {
    case "ATTENDANCE_MARKED":
      await handleAttendanceMarked(msg.data, ws, user);
      break;
    case "TODAY_SUMMARY":
      await handleTodaySummary(ws, user);
      break;
    case "MY_ATTENDANCE":
      await handleMyAttendance(ws, user);
      break;
    case "DONE":
      await handleDone(ws, user);
      break;
    default:
      ws.send(
        JSON.stringify({
          event: "ERROR",
          data: { message: "Unknown event" },
        })
      );
      break;
  }
}

export function createWebSocketHandler() {
  return (c: Context) => {
    const token = c.req.query("token");

    if (!token) {
      return {
        onOpen(event: any, ws: WSContext) {
          ws.send(
            JSON.stringify({
              event: "ERROR",
              data: { message: "Unauthorized or invalid token" },
            })
          );
          ws.close();
        },
        onMessage(event: any, ws: WSContext) {},
        onClose(event: any, ws: WSContext) {},
      };
    }

    let user: JWTPayload;
    try {
      user = jwt.verify(token, env.JWT_SECRET) as JWTPayload;
    } catch {
      return {
        onOpen(event: any, ws: WSContext) {
          ws.send(
            JSON.stringify({
              event: "ERROR",
              data: { message: "Unauthorized or invalid token" },
            })
          );
          ws.close();
        },
        onMessage(event: any, ws: WSContext) {},
        onClose(event: any, ws: WSContext) {},
      };
    }

    return {
      onOpen(event: any, ws: WSContext) {
        clients.set(ws, user);
      },

      async onMessage(event: any, ws: WSContext) {
        try {
          const msg = JSON.parse(event.data.toString());
          await handleMessage(msg, ws, user);
        } catch {
          ws.send(
            JSON.stringify({
              event: "ERROR",
              data: { message: "Invalid message format" },
            })
          );
        }
      },
      onClose(event: any, ws: WSContext) {
        clients.delete(ws);
      },
    };
  };
}
