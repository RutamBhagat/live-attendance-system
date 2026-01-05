# Live Attendance System - Backend + WebSocket

## Commands

### Development
- `pnpm dev` - Start all apps in development (default: server at port 3000)
- `pnpm dev:server` - Start only the server
- `pnpm check-types` - Type check all apps

### Database (Drizzle)
- `pnpm db:push` - Push schema changes to PostgreSQL without migrations
- `pnpm db:generate` - Generate migrations from schema
- `pnpm db:migrate` - Apply migrations to database
- `pnpm db:studio` - Open Drizzle Studio UI
- `pnpm db:start` - Start PostgreSQL via Docker Compose (detached)
- `pnpm db:watch` - Start PostgreSQL via Docker Compose (attached)
- `pnpm db:stop` - Stop PostgreSQL container
- `pnpm db:down` - Stop and remove PostgreSQL container

### Build & Test
- `pnpm build` - Build all apps
- `pnpm test` - Run tests with Vitest UI
- `pnpm check` - Run oxlint and oxfmt (auto-fix)

### Server-specific (from apps/server/)
- `tsx watch src/index.ts` - Run dev server with hot reload
- `pnpm compile` - Compile server to standalone binary with Bun

## Architecture

### Monorepo Structure (Turborepo)
- `apps/server/` - Hono-based HTTP + WebSocket server
- `packages/db/` - Drizzle ORM schema, connection, queries
- `packages/env/` - Zod-validated environment variables
- `packages/config/` - Shared TypeScript configs

### Server Application (Hono)
Entry point: `apps/server/src/index.ts`

**HTTP Routes:**
- `routes/auth.ts` - User registration, login (JWT auth)
- `routes/class.ts` - Class CRUD, enrollment management
- `routes/students.ts` - Student listing
- `routes/attendance.ts` - Start/clear attendance sessions

**WebSocket:**
- `websocket.ts` - Real-time attendance updates
- Auth via `?token=` query param
- Events: `ATTENDANCE_MARKED`, `TODAY_SUMMARY`, `MY_ATTENDANCE`, `DONE`
- In-memory attendance session state (cleared on `DONE` or `/attendance/clear-session`)

**Auth:**
- `middleware/auth.ts` - JWT verification middleware + `requireRole()` helper
- JWT payload: `{ userId: uuid, role: "teacher" | "student" }`

### Database (PostgreSQL + Drizzle)
Schema: `packages/db/src/schema.ts`

**Tables:**
- `users` - id, name, email, password (bcrypt), role (enum: teacher/student)
- `classes` - id, className, teacherId (FK users)
- `class_enrollments` - id, classId (FK classes), studentId (FK users)
- `attendance` - id, classId (FK classes), studentId (FK users), status (enum: present/absent)

Relations: `packages/db/src/relations.ts`

**Database Config:**
- Connection: `packages/db/src/index.ts` (Drizzle client exported as `db`)
- Drizzle config: `packages/db/drizzle.config.ts` (reads `apps/server/.env`)
- Requires `DATABASE_URL` in `apps/server/.env`

### Environment Setup
Required env vars in `apps/server/.env`:
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret for JWT signing
- `CORS_ORIGIN` - Allowed CORS origin

Validation: `packages/env/src/server.ts` (Zod schemas)

### WebSocket Flow
1. Teacher starts attendance via POST `/attendance/start` (creates in-memory session)
2. Teacher/students connect to `/ws?token=<jwt>`
3. Teacher sends `ATTENDANCE_MARKED` events (broadcast to all)
4. Students query `MY_ATTENDANCE` (unicast response)
5. Teacher sends `TODAY_SUMMARY` (broadcast summary)
6. Teacher sends `DONE` (persists to DB, clears session, broadcasts final summary)

### Key Implementation Details
- In-memory attendance state in `routes/attendance.ts` (activeSession)
- WebSocket clients tracked in Map with authenticated user data
- Enrollment used to mark unmarked students as absent on `DONE`
- No frontend included (API-only backend)
