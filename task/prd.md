# Backend Assignment: Live Attendance System

**Tech Stack:** Node.js, Hono, PostgreSQL, Drizzle ORM, Zod, JWT, bcrypt, `ws` (WebSocket)

**Duration:** 3 hours

---

## Overview

Build a complete backend system with:

- Authentication (signup, login, me)
- Role-based access control (teacher & student)
- Class management CRUD
- WebSocket-based live attendance
- Attendance persistence to PostgreSQL

**Key Assumption:** Only **ONE class session** can be active at a time on WebSocket. No room management needed - all broadcasts go to all connected clients.

---

## Project Structure

```
apps/
  server/
    src/
      index.ts          # Hono server setup
      routes/
        auth.ts         # Auth routes
        class.ts        # Class routes
        attendance.ts   # Attendance routes
      middleware/
        auth.ts         # JWT middleware
      websocket.ts      # WebSocket server
packages/
  db/
    src/
      schema.ts         # Drizzle schema
      relations.ts      # Drizzle relations
      index.ts          # DB exports
    drizzle.config.ts
  env/
    src/
      server.ts         # Environment validation
```

---

## Environment Variables

Add to `/packages/env/src/server.ts`:

```typescript
import { createEnv } from '@t3-oss/env-core';
import { z } from 'zod';

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    NODE_ENV: z.enum(['development', 'production', 'test']),
    CORS_ORIGIN: z.string().url()
  },
  runtimeEnv: process.env
});
```

**Required variables:**
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret for JWT signing (min 32 chars)
- `NODE_ENV` - Environment mode
- `CORS_ORIGIN` - Allowed CORS origin

---

## Response Format Standard

### Success Response

```json
{
  "success": true,
  "data": { ... }
}
```

### Error Response

```json
{
  "success": false,
  "error": "Error message"
}
```

**All HTTP responses MUST follow this format!**

---

## JWT Authentication

### JWT Payload Structure

```typescript
type JWTPayload = {
  userId: string;  // UUID
  role: "teacher" | "student";
}
```

### HTTP Requests

Send token via header:

```
Authorization: <JWT_TOKEN>
```

**No "Bearer" prefix - just the token directly**

### WebSocket Connection

```
ws://localhost:3000/ws?token=<JWT_TOKEN>
```

---

## Database Schema (Drizzle)

### File: `/packages/db/src/schema.ts`

```typescript
import { pgTable, text, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').unique().notNull(),
  password: text('password').notNull(),  // bcrypt hashed
  role: text('role').$type<'teacher' | 'student'>().notNull()
});

export const classes = pgTable('classes', {
  id: uuid('id').primaryKey().defaultRandom(),
  className: text('class_name').notNull(),
  teacherId: uuid('teacher_id').notNull().references(() => users.id),
  studentIds: text('student_ids').array().notNull().default([])
});

export const attendance = pgTable('attendance', {
  id: uuid('id').primaryKey().defaultRandom(),
  classId: uuid('class_id').notNull().references(() => classes.id),
  studentId: uuid('student_id').notNull().references(() => users.id),
  status: text('status').$type<'present' | 'absent'>().notNull()
});
```

### File: `/packages/db/src/relations.ts`

```typescript
import { relations } from 'drizzle-orm';
import { users, classes, attendance } from './schema';

export const usersRelations = relations(users, ({ many }) => ({
  taughtClasses: many(classes),
  attendanceRecords: many(attendance)
}));

export const classesRelations = relations(classes, ({ one, many }) => ({
  teacher: one(users, {
    fields: [classes.teacherId],
    references: [users.id]
  }),
  attendanceRecords: many(attendance)
}));

export const attendanceRelations = relations(attendance, ({ one }) => ({
  class: one(classes, {
    fields: [attendance.classId],
    references: [classes.id]
  }),
  student: one(users, {
    fields: [attendance.studentId],
    references: [users.id]
  })
}));
```

### Database Setup Commands

```bash
pnpm db:push       # Push schema to database
pnpm db:generate   # Generate migration files
pnpm db:migrate    # Run migrations
pnpm db:studio     # Open Drizzle Studio
```

---

## Zod Validation Schemas

```typescript
import { z } from 'zod';

export const signupSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['teacher', 'student'])
});

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string()
});

export const classSchema = z.object({
  className: z.string().min(1)
});

export const addStudentSchema = z.object({
  studentId: z.string().uuid()
});

export const startAttendanceSchema = z.object({
  classId: z.string().uuid()
});
```

---

## Error Codes Reference

### Validation Error (400)

```json
{
  "success": false,
  "error": "Invalid request schema"
}
```

**When to use:** Zod validation fails

### Unauthorized (401)

```json
{
  "success": false,
  "error": "Unauthorized, token missing or invalid"
}
```

**When to use:** Missing token, invalid JWT, or expired token

### Forbidden - Role Check (403)

```json
{
  "success": false,
  "error": "Forbidden, teacher access required"
}
```

**When to use:** Student tries to access teacher-only endpoint

### Forbidden - Ownership Check (403)

```json
{
  "success": false,
  "error": "Forbidden, not class teacher"
}
```

**When to use:** Teacher tries to modify another teacher's class

### Forbidden - Enrollment Check (403)

```json
{
  "success": false,
  "error": "Forbidden, not enrolled in class"
}
```

**When to use:** Student tries to access a class they're not enrolled in

### Not Found (404)

```json
{
  "success": false,
  "error": "Class not found"
}
```

```json
{
  "success": false,
  "error": "User not found"
}
```

```json
{
  "success": false,
  "error": "Student not found"
}
```

**When to use:** Resource doesn't exist in database

---

## Middleware Implementation

### JWT Authentication Middleware

```typescript
import { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';
import { env } from '@repo/env';

type JWTPayload = { userId: string; role: 'teacher' | 'student' };

export async function authMiddleware(c: Context, next: Next) {
  const token = c.req.header('Authorization');

  if (!token) {
    return c.json(
      { success: false, error: 'Unauthorized, token missing or invalid' },
      401
    );
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JWTPayload;
    c.set('user', decoded);
    await next();
  } catch {
    return c.json(
      { success: false, error: 'Unauthorized, token missing or invalid' },
      401
    );
  }
}
```

### Role-Based Access Control

```typescript
export function requireRole(role: 'teacher' | 'student') {
  return async (c: Context, next: Next) => {
    const user = c.get('user') as JWTPayload;

    if (user.role !== role) {
      return c.json(
        {
          success: false,
          error: `Forbidden, ${role} access required`
        },
        403
      );
    }

    await next();
  };
}
```

### Zod Validation Middleware

```typescript
import { zValidator } from '@hono/zod-validator';

// Usage in routes:
app.post('/auth/signup',
  zValidator('json', signupSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: 'Invalid request schema' }, 400);
    }
  }),
  async (c) => {
    // Route handler
  }
);
```

---

## In-Memory Attendance State

The server maintains a single global state for the active session:

```typescript
type ActiveSession = {
  classId: string;
  startedAt: string;  // ISO 8601 string
  attendance: Record<string, 'present' | 'absent'>;
} | null;

let activeSession: ActiveSession = null;
```

**Example:**

```typescript
activeSession = {
  classId: "550e8400-e29b-41d4-a716-446655440000",
  startedAt: "2025-03-11T10:00:00.000Z",
  attendance: {
    "123e4567-e89b-12d3-a456-426614174000": "present",
    "234e5678-e89b-12d3-a456-426614174001": "absent"
  }
};
```

**Important:**
- `startedAt` must be ISO string: `new Date().toISOString()`
- `attendance` object maps studentId (UUID) to status
- Only ONE session active at a time
- Clear session with `activeSession = null` after DONE event

---

## HTTP API Routes

### 1. POST /auth/signup

**Description:** Register a new user (teacher or student)

**Auth Required:** No

**Zod Schema:**

```typescript
{
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  role: z.enum(['teacher', 'student'])
}
```

**Implementation Example:**

```typescript
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import bcrypt from 'bcrypt';
import { db } from '@repo/db';
import { users } from '@repo/db/schema';
import { eq } from 'drizzle-orm';

app.post('/auth/signup',
  zValidator('json', signupSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: 'Invalid request schema' }, 400);
    }
  }),
  async (c) => {
    const { name, email, password, role } = c.req.valid('json');

    // Check for duplicate email
    const existing = await db.query.users.findFirst({
      where: eq(users.email, email)
    });

    if (existing) {
      return c.json({ success: false, error: 'Email already exists' }, 400);
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const [newUser] = await db.insert(users)
      .values({ name, email, password: hashedPassword, role })
      .returning();

    return c.json({
      success: true,
      data: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role
      }
    }, 201);
  }
);
```

**Success (201):**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Rahul",
    "email": "rahul@example.com",
    "role": "student"
  }
}
```

**Duplicate Email (400):**

```json
{
  "success": false,
  "error": "Email already exists"
}
```

---

### 2. POST /auth/login

**Description:** Login and receive JWT token

**Auth Required:** No

**Zod Schema:**

```typescript
{
  email: z.string().email(),
  password: z.string()
}
```

**Implementation:**

```typescript
app.post('/auth/login',
  zValidator('json', loginSchema, ...),
  async (c) => {
    const { email, password } = c.req.valid('json');

    // Find user
    const user = await db.query.users.findFirst({
      where: eq(users.email, email)
    });

    if (!user) {
      return c.json({
        success: false,
        error: 'Invalid email or password'
      }, 400);
    }

    // Verify password
    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return c.json({
        success: false,
        error: 'Invalid email or password'
      }, 400);
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    return c.json({
      success: true,
      data: { token }
    });
  }
);
```

**Success (200):**

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

**Invalid Credentials (400):**

```json
{
  "success": false,
  "error": "Invalid email or password"
}
```

---

### 3. GET /auth/me

**Description:** Get current user information

**Auth Required:** Yes

**Implementation:**

```typescript
app.get('/auth/me',
  authMiddleware,
  async (c) => {
    const { userId } = c.get('user') as JWTPayload;

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, name: true, email: true, role: true }
    });

    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }

    return c.json({
      success: true,
      data: user
    });
  }
);
```

**Success (200):**

```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "Rahul",
    "email": "rahul@example.com",
    "role": "student"
  }
}
```

---

### 4. POST /class

**Description:** Create a new class (teacher only)

**Auth Required:** Yes (Teacher only)

**Zod Schema:**

```typescript
{
  className: z.string().min(1)
}
```

**Implementation:**

```typescript
app.post('/class',
  authMiddleware,
  requireRole('teacher'),
  zValidator('json', classSchema, ...),
  async (c) => {
    const { userId } = c.get('user') as JWTPayload;
    const { className } = c.req.valid('json');

    const [newClass] = await db.insert(classes)
      .values({
        className,
        teacherId: userId,
        studentIds: []
      })
      .returning();

    return c.json({
      success: true,
      data: newClass
    }, 201);
  }
);
```

**Success (201):**

```json
{
  "success": true,
  "data": {
    "id": "660e8400-e29b-41d4-a716-446655440000",
    "className": "Maths 101",
    "teacherId": "550e8400-e29b-41d4-a716-446655440000",
    "studentIds": []
  }
}
```

---

### 5. POST /class/:id/add-student

**Description:** Add a student to a class

**Auth Required:** Yes (Teacher only, must own the class)

**Zod Schema:**

```typescript
{
  studentId: z.string().uuid()
}
```

**Implementation:**

```typescript
import { sql } from 'drizzle-orm';

app.post('/class/:id/add-student',
  authMiddleware,
  requireRole('teacher'),
  zValidator('json', addStudentSchema, ...),
  async (c) => {
    const { userId } = c.get('user') as JWTPayload;
    const classId = c.req.param('id');
    const { studentId } = c.req.valid('json');

    // Check class exists and user owns it
    const classData = await db.query.classes.findFirst({
      where: eq(classes.id, classId)
    });

    if (!classData) {
      return c.json({ success: false, error: 'Class not found' }, 404);
    }

    if (classData.teacherId !== userId) {
      return c.json({
        success: false,
        error: 'Forbidden, not class teacher'
      }, 403);
    }

    // Check student exists
    const student = await db.query.users.findFirst({
      where: and(eq(users.id, studentId), eq(users.role, 'student'))
    });

    if (!student) {
      return c.json({ success: false, error: 'Student not found' }, 404);
    }

    // Add student if not already in class
    const updatedIds = classData.studentIds.includes(studentId)
      ? classData.studentIds
      : [...classData.studentIds, studentId];

    const [updated] = await db.update(classes)
      .set({ studentIds: updatedIds })
      .where(eq(classes.id, classId))
      .returning();

    return c.json({
      success: true,
      data: updated
    });
  }
);
```

**Success (200):**

```json
{
  "success": true,
  "data": {
    "id": "660e8400-e29b-41d4-a716-446655440000",
    "className": "Maths 101",
    "teacherId": "550e8400-e29b-41d4-a716-446655440000",
    "studentIds": ["770e8400-e29b-41d4-a716-446655440000"]
  }
}
```

---

### 6. GET /class/:id

**Description:** Get class details with populated students

**Auth Required:** Yes (Teacher who owns class OR Student enrolled in class)

**Implementation:**

```typescript
import { inArray } from 'drizzle-orm';

app.get('/class/:id',
  authMiddleware,
  async (c) => {
    const { userId, role } = c.get('user') as JWTPayload;
    const classId = c.req.param('id');

    const classData = await db.query.classes.findFirst({
      where: eq(classes.id, classId)
    });

    if (!classData) {
      return c.json({ success: false, error: 'Class not found' }, 404);
    }

    // Authorization check
    const isTeacher = role === 'teacher' && classData.teacherId === userId;
    const isEnrolled = role === 'student' && classData.studentIds.includes(userId);

    if (!isTeacher && !isEnrolled) {
      return c.json({
        success: false,
        error: 'Forbidden, not class teacher'
      }, 403);
    }

    // Fetch student details
    const students = classData.studentIds.length > 0
      ? await db.query.users.findMany({
          where: inArray(users.id, classData.studentIds),
          columns: { id: true, name: true, email: true }
        })
      : [];

    return c.json({
      success: true,
      data: {
        id: classData.id,
        className: classData.className,
        teacherId: classData.teacherId,
        students
      }
    });
  }
);
```

**Success (200):**

```json
{
  "success": true,
  "data": {
    "id": "660e8400-e29b-41d4-a716-446655440000",
    "className": "Maths 101",
    "teacherId": "550e8400-e29b-41d4-a716-446655440000",
    "students": [
      {
        "id": "770e8400-e29b-41d4-a716-446655440000",
        "name": "Rahul",
        "email": "rahul@test.com"
      }
    ]
  }
}
```

---

### 7. GET /students

**Description:** Get all students (teacher only)

**Auth Required:** Yes (Teacher only)

**Implementation:**

```typescript
app.get('/students',
  authMiddleware,
  requireRole('teacher'),
  async (c) => {
    const studentsList = await db.query.users.findMany({
      where: eq(users.role, 'student'),
      columns: { id: true, name: true, email: true }
    });

    return c.json({
      success: true,
      data: studentsList
    });
  }
);
```

**Success (200):**

```json
{
  "success": true,
  "data": [
    {
      "id": "770e8400-e29b-41d4-a716-446655440000",
      "name": "Rahul",
      "email": "rahul@test.com"
    },
    {
      "id": "880e8400-e29b-41d4-a716-446655440000",
      "name": "Priya",
      "email": "priya@test.com"
    }
  ]
}
```

---

### 8. GET /class/:id/my-attendance

**Description:** Get student's persisted attendance for a class

**Auth Required:** Yes (Student only, must be enrolled in class)

**Implementation:**

```typescript
app.get('/class/:id/my-attendance',
  authMiddleware,
  requireRole('student'),
  async (c) => {
    const { userId } = c.get('user') as JWTPayload;
    const classId = c.req.param('id');

    // Check class exists
    const classData = await db.query.classes.findFirst({
      where: eq(classes.id, classId)
    });

    if (!classData) {
      return c.json({ success: false, error: 'Class not found' }, 404);
    }

    // Check enrollment
    if (!classData.studentIds.includes(userId)) {
      return c.json({
        success: false,
        error: 'Forbidden, not enrolled in class'
      }, 403);
    }

    // Check for persisted attendance
    const record = await db.query.attendance.findFirst({
      where: and(
        eq(attendance.classId, classId),
        eq(attendance.studentId, userId)
      )
    });

    return c.json({
      success: true,
      data: {
        classId,
        status: record?.status ?? null
      }
    });
  }
);
```

**Success (200) - Attendance Persisted:**

```json
{
  "success": true,
  "data": {
    "classId": "660e8400-e29b-41d4-a716-446655440000",
    "status": "present"
  }
}
```

**Success (200) - Not Persisted Yet:**

```json
{
  "success": true,
  "data": {
    "classId": "660e8400-e29b-41d4-a716-446655440000",
    "status": null
  }
}
```

---

### 9. POST /attendance/start

**Description:** Start a new attendance session

**Auth Required:** Yes (Teacher only, must own the class)

**Zod Schema:**

```typescript
{
  classId: z.string().uuid()
}
```

**Implementation:**

```typescript
app.post('/attendance/start',
  authMiddleware,
  requireRole('teacher'),
  zValidator('json', startAttendanceSchema, ...),
  async (c) => {
    const { userId } = c.get('user') as JWTPayload;
    const { classId } = c.req.valid('json');

    // Check class exists and user owns it
    const classData = await db.query.classes.findFirst({
      where: eq(classes.id, classId)
    });

    if (!classData) {
      return c.json({ success: false, error: 'Class not found' }, 404);
    }

    if (classData.teacherId !== userId) {
      return c.json({
        success: false,
        error: 'Forbidden, not class teacher'
      }, 403);
    }

    // Set active session
    activeSession = {
      classId,
      startedAt: new Date().toISOString(),
      attendance: {}
    };

    return c.json({
      success: true,
      data: {
        classId,
        startedAt: activeSession.startedAt
      }
    });
  }
);
```

**Success (200):**

```json
{
  "success": true,
  "data": {
    "classId": "660e8400-e29b-41d4-a716-446655440000",
    "startedAt": "2025-03-11T10:00:00.000Z"
  }
}
```

---

## WebSocket Server

### Setup with Hono

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import jwt from 'jsonwebtoken';
import { env } from '@repo/env';

const wss = new WebSocketServer({ noServer: true });

// Extend WebSocket type
type ExtendedWebSocket = WebSocket & {
  user: JWTPayload;
};

// Upgrade handler
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);
  const token = url.searchParams.get('token');

  if (!token) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as JWTPayload;

    wss.handleUpgrade(request, socket, head, (ws) => {
      (ws as ExtendedWebSocket).user = decoded;
      wss.emit('connection', ws, request);
    });
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
  }
});
```

### Connection URL

```
ws://localhost:3000/ws?token=<JWT_TOKEN>
```

### Connection Flow

1. **Extract token** from query parameter
2. **Verify JWT** - if invalid, send ERROR and close connection
3. **Attach user info** to WebSocket: `ws.user = { userId, role }`
4. Connection is now ready to receive/send messages

**No room management needed!** All messages broadcast to all connected clients.

---

### WebSocket Message Format

**All messages (client → server and server → client) use:**

```json
{
  "event": "EVENT_NAME",
  "data": { ... }
}
```

---

## WebSocket Events

### Event 1: ATTENDANCE_MARKED

**Direction:** Teacher → Server → Broadcast to ALL

**Teacher Sends:**

```json
{
  "event": "ATTENDANCE_MARKED",
  "data": {
    "studentId": "770e8400-e29b-41d4-a716-446655440000",
    "status": "present"
  }
}
```

**Server Actions:**

1. Verify `ws.user.role === "teacher"`
2. If `activeSession` is null, send ERROR
3. Update in-memory: `activeSession.attendance[studentId] = status`
4. Broadcast to ALL connected clients

**Implementation:**

```typescript
wss.on('connection', (ws: ExtendedWebSocket) => {
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());

      switch (message.event) {
        case 'ATTENDANCE_MARKED': {
          if (ws.user.role !== 'teacher') {
            ws.send(JSON.stringify({
              event: 'ERROR',
              data: { message: 'Forbidden, teacher event only' }
            }));
            return;
          }

          if (!activeSession) {
            ws.send(JSON.stringify({
              event: 'ERROR',
              data: { message: 'No active attendance session' }
            }));
            return;
          }

          const { studentId, status } = message.data;
          activeSession.attendance[studentId] = status;

          // Broadcast to all
          broadcast('ATTENDANCE_MARKED', { studentId, status });
          break;
        }
      }
    } catch {
      ws.send(JSON.stringify({
        event: 'ERROR',
        data: { message: 'Invalid message format' }
      }));
    }
  });
});

function broadcast(event: string, data: any) {
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ event, data }));
    }
  });
}
```

**Broadcast Message:**

```json
{
  "event": "ATTENDANCE_MARKED",
  "data": {
    "studentId": "770e8400-e29b-41d4-a716-446655440000",
    "status": "present"
  }
}
```

---

### Event 2: TODAY_SUMMARY

**Direction:** Teacher → Server → Broadcast to ALL

**Teacher Sends:**

```json
{
  "event": "TODAY_SUMMARY"
}
```

**Server Actions:**

1. Verify `ws.user.role === "teacher"`
2. Calculate from `activeSession.attendance`
3. Broadcast to ALL connected clients

**Implementation:**

```typescript
case 'TODAY_SUMMARY': {
  if (ws.user.role !== 'teacher') {
    ws.send(JSON.stringify({
      event: 'ERROR',
      data: { message: 'Forbidden, teacher event only' }
    }));
    return;
  }

  if (!activeSession) {
    ws.send(JSON.stringify({
      event: 'ERROR',
      data: { message: 'No active attendance session' }
    }));
    return;
  }

  const statuses = Object.values(activeSession.attendance);
  const present = statuses.filter(s => s === 'present').length;
  const absent = statuses.filter(s => s === 'absent').length;
  const total = statuses.length;

  broadcast('TODAY_SUMMARY', { present, absent, total });
  break;
}
```

**Broadcast Message:**

```json
{
  "event": "TODAY_SUMMARY",
  "data": {
    "present": 18,
    "absent": 4,
    "total": 22
  }
}
```

---

### Event 3: MY_ATTENDANCE

**Direction:** Student → Server → Response to THAT student only (unicast)

**Student Sends:**

```json
{
  "event": "MY_ATTENDANCE"
}
```

**Server Actions:**

1. Verify `ws.user.role === "student"`
2. Check `activeSession.attendance[ws.user.userId]`
3. Send response ONLY to the requesting socket (unicast)

**Implementation:**

```typescript
case 'MY_ATTENDANCE': {
  if (ws.user.role !== 'student') {
    ws.send(JSON.stringify({
      event: 'ERROR',
      data: { message: 'Forbidden, student event only' }
    }));
    return;
  }

  if (!activeSession) {
    ws.send(JSON.stringify({
      event: 'ERROR',
      data: { message: 'No active attendance session' }
    }));
    return;
  }

  const status = activeSession.attendance[ws.user.userId] || 'not yet updated';

  ws.send(JSON.stringify({
    event: 'MY_ATTENDANCE',
    data: { status }
  }));
  break;
}
```

**Response to Student (marked):**

```json
{
  "event": "MY_ATTENDANCE",
  "data": {
    "status": "present"
  }
}
```

**Response to Student (not marked):**

```json
{
  "event": "MY_ATTENDANCE",
  "data": {
    "status": "not yet updated"
  }
}
```

---

### Event 4: DONE

**Direction:** Teacher → Server → Persist to DB → Broadcast to ALL

**Teacher Sends:**

```json
{
  "event": "DONE"
}
```

**Server Actions:**

1. Verify teacher role
2. Get all students in active class from database
3. Mark absent students in memory (those not in attendance object)
4. Persist all attendance to PostgreSQL
5. Calculate final summary
6. Clear memory: `activeSession = null`
7. Broadcast final summary to ALL

**Implementation:**

```typescript
case 'DONE': {
  if (ws.user.role !== 'teacher') {
    ws.send(JSON.stringify({
      event: 'ERROR',
      data: { message: 'Forbidden, teacher event only' }
    }));
    return;
  }

  if (!activeSession) {
    ws.send(JSON.stringify({
      event: 'ERROR',
      data: { message: 'No active attendance session' }
    }));
    return;
  }

  // Get all students in class
  const classData = await db.query.classes.findFirst({
    where: eq(classes.id, activeSession.classId)
  });

  // Mark unmarked students as absent
  for (const studentId of classData!.studentIds) {
    if (!activeSession.attendance[studentId]) {
      activeSession.attendance[studentId] = 'absent';
    }
  }

  // Persist to database
  const records = Object.entries(activeSession.attendance).map(([studentId, status]) => ({
    classId: activeSession!.classId,
    studentId,
    status
  }));

  await db.insert(attendance).values(records);

  // Calculate final summary
  const statuses = Object.values(activeSession.attendance);
  const present = statuses.filter(s => s === 'present').length;
  const absent = statuses.filter(s => s === 'absent').length;
  const total = statuses.length;

  // Clear session
  activeSession = null;

  // Broadcast
  broadcast('DONE', {
    message: 'Attendance persisted',
    present,
    absent,
    total
  });
  break;
}
```

**Broadcast Message:**

```json
{
  "event": "DONE",
  "data": {
    "message": "Attendance persisted",
    "present": 18,
    "absent": 4,
    "total": 22
  }
}
```

---

## WebSocket Error Handling

### Error Message Format

```json
{
  "event": "ERROR",
  "data": {
    "message": "Error description"
  }
}
```

### Common Errors

**Invalid JWT:**

```json
{
  "event": "ERROR",
  "data": {
    "message": "Unauthorized or invalid token"
  }
}
```

**Teacher-Only Event:**

```json
{
  "event": "ERROR",
  "data": {
    "message": "Forbidden, teacher event only"
  }
}
```

**Student-Only Event:**

```json
{
  "event": "ERROR",
  "data": {
    "message": "Forbidden, student event only"
  }
}
```

**No Active Session:**

```json
{
  "event": "ERROR",
  "data": {
    "message": "No active attendance session"
  }
}
```

**Invalid Message Format:**

```json
{
  "event": "ERROR",
  "data": {
    "message": "Invalid message format"
  }
}
```

**Unknown Event:**

```json
{
  "event": "ERROR",
  "data": {
    "message": "Unknown event"
  }
}
```

---

## Testing

### Run Tests

```bash
pnpm test
```

### Test Database Setup

Tests expect the server to be running at `http://localhost:3000` and WebSocket at `ws://localhost:3000/ws`.

**Note:** All test IDs will use UUIDs, not MongoDB ObjectIds. Update test fixtures accordingly.

---

## Deployment

### Environment Setup

Create `.env` file:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/attendance"
JWT_SECRET="your-secret-key-minimum-32-characters-long"
NODE_ENV="development"
CORS_ORIGIN="http://localhost:5173"
```

### Database Migration

```bash
pnpm db:push      # Push schema to database
```

### Start Server

```bash
pnpm dev          # Development
pnpm build        # Production build
pnpm start        # Production
```

---

## Security Best Practices

1. **Password Hashing:** Use bcrypt with salt rounds = 10
2. **JWT Expiry:** Set token expiration (e.g., 7 days)
3. **CORS:** Configure allowed origins properly
4. **Input Validation:** Always use Zod schemas
5. **SQL Injection:** Drizzle ORM prevents this by default
6. **Error Messages:** Don't leak sensitive information

---

**Good luck!**

Remember: Focus on getting the basics working first, then refine.

TEST APPLICATION:
https://github.com/rahul-MyGit/mid-test
