import type { NextFunction, Request, RequestHandler, Response } from "express";
import { AppError } from "../domain/errors.js";

interface Bucket {
  count: number;
  resetAt: number;
}

export function createRateLimiter(options: { windowMs: number; max: number; name: string }): RequestHandler {
  const buckets = new Map<string, Bucket>();
  let lastCleanup = 0;

  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();
    if (now - lastCleanup > options.windowMs) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
      lastCleanup = now;
    }
    const key = `${options.name}:${req.ip || "unknown"}`;
    const current = buckets.get(key);
    const bucket = !current || current.resetAt <= now
      ? { count: 0, resetAt: now + options.windowMs }
      : current;
    bucket.count += 1;
    buckets.set(key, bucket);
    if (bucket.count > options.max) {
      next(new AppError(429, "RATE_LIMITED", "too many requests; try again later"));
      return;
    }
    next();
  };
}
