import path from "node:path";
import { existsSync } from "node:fs";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import pino from "pino";
import { pinoHttp } from "pino-http";
import type { PrismaClient } from "@prisma/client";
import type { AppEnv } from "./config/env.js";
import { registerRoutes } from "./http/routes.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { createAIProvider } from "./ai/provider.js";
import type { AIProvider } from "./ai/types.js";
import { createRateLimiter } from "./middleware/rate-limit.js";
import { AppError } from "./domain/errors.js";

export interface AppDependencies {
  env: AppEnv;
  prisma: PrismaClient;
  logger?: pino.Logger;
  provider?: AIProvider;
}

export function createApp({ env, prisma, logger = pino({ level: env.LOG_LEVEL }), provider = createAIProvider(env) }: AppDependencies) {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  const allowedDevelopmentOrigins = new Set([env.CORS_ORIGIN, "http://localhost:5173", "http://127.0.0.1:5173"]);
  app.use(cors({
    origin: (origin, callback) => {
      const isLocalExtension = env.NODE_ENV !== "production" && /^chrome-extension:\/\/[a-z0-9]+$/.test(origin ?? "");
      if (!origin || (env.NODE_ENV === "development" && allowedDevelopmentOrigins.has(origin)) || origin === env.CORS_ORIGIN || isLocalExtension) {
        callback(null, true);
        return;
      }
      callback(new AppError(403, "CORS_ORIGIN_BLOCKED", "request origin is not allowed"));
    },
  }));
  app.use(express.json({ limit: "1mb" }));
  app.use(pinoHttp({ logger }));
  app.use("/api/auth", createRateLimiter({ name: "auth", windowMs: 60_000, max: 20 }));
  app.use("/api", createRateLimiter({ name: "api", windowMs: 60_000, max: 300 }));

  const webDist = path.resolve(process.cwd(), "web", "dist");
  const webIndex = path.join(webDist, "index.html");
  if (existsSync(webIndex)) app.use(express.static(webDist));

  app.get("/", (_req, res) => {
    if (existsSync(webIndex)) {
      res.sendFile(webIndex);
      return;
    }
    res.type("html").send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>NOOK</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f5f1e8;color:#242424;font:16px system-ui,sans-serif}.card{max-width:560px;padding:48px;border-radius:24px;background:#fffdf8;box-shadow:0 18px 60px #24242418;text-align:center}.logo{width:min(100%,360px);height:auto}.status{margin-top:24px;color:#6f6a60}</style></head>
<body><main class="card"><img class="logo" src="/assets/logo.jpg" alt="NOOK"><p class="status">The NOOK backend is running. Sign in through a client to save and organize resources.</p></main></body></html>`);
  });

  const projectRoot = path.resolve(process.cwd());
  app.get("/assets/logo.jpg", (_req, res, next) => res.sendFile(path.join(projectRoot, "logo.jpg"), (error) => error && next(error)));
  app.get("/assets/icon.png", (_req, res, next) => res.sendFile(path.join(projectRoot, "icon.png"), (error) => error && next(error)));

  registerRoutes(app, prisma, env, provider);
  if (existsSync(webIndex)) {
    app.use((req, res, next) => {
      if (req.method === "GET" && !req.path.startsWith("/api/") && !req.path.startsWith("/assets/")) {
        res.sendFile(webIndex);
        return;
      }
      next();
    });
  }
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
