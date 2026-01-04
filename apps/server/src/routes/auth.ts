import { db, users } from "@100x-sem-1-assignment/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

export const authRouter = new Hono();

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  password: z.string().min(6),
  role: z.enum(["teacher", "student"]),
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string(),
});

authRouter.post("/signup", zValidator("json", signupSchema), async (c) => {
  const { name, email, password, role } = c.req.valid("json");

  const existingUser = await db.query.users.findFirst({
    where: {
      email: email,
    },
  });
  if (existingUser) {
    return c.json({ success: false, error: "Email already exists" }, 400);
  }
  const user = await db
    .insert(users)
    .values({ name, email, password, role })
    .returning({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    });
  return c.json({ success: true, data: user[0] }, 201);
});
