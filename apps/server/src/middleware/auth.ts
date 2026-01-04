import type { Context, Next } from "hono";
import jwt from "jsonwebtoken";
import { env } from "@100x-sem-1-assignment/env/server";
import {
  UserRoleSchema,
  type UserRole,
} from "@100x-sem-1-assignment/db/schema";
import { z } from "zod";

export const JWTPayloadSchema = z.object({
  userId: z.uuid(),
  role: UserRoleSchema,
});

export const authMiddleware = async (c: Context, next: Next) => {
  const token = c.req.header("Authorization");

  if (!token) {
    return c.json(
      { success: false, error: "Unauthorized, token missing or invalid" },
      401
    );
  }

  try {
    const decoded = JWTPayloadSchema.parse(jwt.verify(token, env.JWT_SECRET));
    c.set("user", decoded);
    await next();
  } catch (error) {
    return c.json(
      { success: false, error: "Unauthorized, token missing or invalid" },
      401
    );
  }
};

export const requireRole = (role: UserRole) => {
  return async (c: Context, next: Next) => {
    const user = JWTPayloadSchema.safeParse(c.get("user"));
    if (!user.success || user.data.role !== role) {
      return c.json(
        { success: false, error: `Forbidden, ${role} access required` },
        403
      );
    }
    await next();
  };
};
