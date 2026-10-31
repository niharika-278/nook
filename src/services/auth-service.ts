import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { PrismaClient, User } from "@prisma/client";
import type { AppEnv } from "../config/env.js";
import { AppError, isPrismaUniqueConstraint } from "../domain/errors.js";
import type { LoginInput, RegisterInput } from "../schemas/auth.js";

const passwordCost = 12;

export type PublicUser = Pick<User, "id" | "email" | "displayName" | "createdAt">;

export interface AuthResult {
  token: string;
  user: PublicUser;
}

function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}

export async function registerUser(prisma: PrismaClient, env: AppEnv, input: RegisterInput): Promise<AuthResult> {
  const passwordHash = await bcrypt.hash(input.password, passwordCost);
  let user: User;
  try {
    user = await prisma.user.create({
      data: {
        email: input.email,
        passwordHash,
        ...(input.displayName === undefined ? {} : { displayName: input.displayName }),
      },
    });
  } catch (error) {
    if (isPrismaUniqueConstraint(error)) {
      throw new AppError(409, "EMAIL_ALREADY_REGISTERED", "an account with that email already exists");
    }
    throw error;
  }
  return { token: issueToken(user.id, env.JWT_SECRET), user: toPublicUser(user) };
}

export async function loginUser(prisma: PrismaClient, env: AppEnv, input: LoginInput): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email: input.email } });
  const valid = user ? await bcrypt.compare(input.password, user.passwordHash) : false;
  if (!user || !valid) throw new AppError(401, "INVALID_CREDENTIALS", "email or password is incorrect");
  return { token: issueToken(user.id, env.JWT_SECRET), user: toPublicUser(user) };
}

export function issueToken(userId: string, secret: string): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: "7d", issuer: "nook" });
}

export function verifyToken(token: string, secret: string): string {
  try {
    const payload = jwt.verify(token, secret, { issuer: "nook" });
    if (typeof payload === "string" || typeof payload.sub !== "string") throw new Error("missing subject");
    return payload.sub;
  } catch {
    throw new AppError(401, "INVALID_TOKEN", "authentication is required");
  }
}
