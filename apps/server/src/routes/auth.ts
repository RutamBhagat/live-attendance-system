import { db, UserRoleSchema, users } from "@100x-sem-1-assignment/db";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";
import bcrypt from "bcrypt";
import { env } from "@100x-sem-1-assignment/env/server";
import jwt from "jsonwebtoken";

export const authRouter = new Hono();

const signupSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  password: z.string().min(6),
  role: UserRoleSchema,
});

const loginSchema = z.object({
  email: z.email(),
  password: z.string(),
});

authRouter.post(
  "/signup",
  zValidator("json", signupSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: "Invalid request schema" }, 400);
    }
  }),
  async (c) => {
    const { name, email, password, role } = c.req.valid("json");

    const existingUser = await db.query.users.findFirst({
      where: {
        email: email,
      },
    });

    if (existingUser) {
      return c.json({ success: false, error: "Email already exists" }, 400);
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const [user] = await db
      .insert(users)
      .values({ name, email, password: hashedPassword, role })
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
      });

    if (!user) {
      return c.json({ success: false, error: "Failed to create user" }, 500);
    }

    return c.json({ success: true, data: user }, 201);
  }
);

authRouter.post(
  "/login",
  zValidator("json", loginSchema, (result, c) => {
    if (!result.success) {
      return c.json({ success: false, error: "Invalid request schema" }, 400);
    }
  }),
  async (c) => {
    const { email, password } = c.req.valid("json");

    const user = await db.query.users.findFirst({
      where: {
        email: email,
      },
    });

    if (!user) {
      return c.json(
        { success: false, error: "Invalid email or password" },
        400
      );
    }

    const valid = await bcrypt.compare(password, user.password);

    if (!valid) {
      return c.json(
        { success: false, error: "Invalid email or password" },
        400
      );
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    return c.json({ success: true, data: { token } }, 200);
  }
);
