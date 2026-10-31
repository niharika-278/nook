import type { NextFunction, Request, Response } from "express";
import type { AppEnv } from "../config/env.js";
import { verifyToken } from "../services/auth-service.js";

export function authenticate(env: AppEnv) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.header("authorization");
    const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : undefined;
    if (!token) {
      next(new Error("AUTHENTICATION_REQUIRED"));
      return;
    }
    try {
      req.userId = verifyToken(token, env.JWT_SECRET);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireUser(req: Request): string {
  if (!req.userId) throw new Error("AUTHENTICATION_REQUIRED");
  return req.userId;
}
