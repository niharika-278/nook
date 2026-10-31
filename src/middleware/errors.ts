import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from "express";
import { ZodError } from "zod";
import { AppError, isPrismaUniqueConstraint } from "../domain/errors.js";

export const notFound: RequestHandler = (_req, _res, next) => {
  next(new AppError(404, "NOT_FOUND", "route not found"));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, req: Request, res: Response, _next: NextFunction) => {
  let appError: AppError;
  if (error instanceof AppError) {
    appError = error;
  } else if (error instanceof SyntaxError && typeof error === "object" && error !== null && "type" in error && error.type === "entity.parse.failed") {
    appError = new AppError(400, "INVALID_JSON", "request body must contain valid JSON");
  } else if (error instanceof ZodError) {
    appError = new AppError(400, "VALIDATION_ERROR", "request validation failed", error.flatten());
  } else if (isPrismaUniqueConstraint(error)) {
    appError = new AppError(409, "RESOURCE_CONFLICT", "the requested resource conflicts with an existing resource");
  } else if (error instanceof Error && error.message === "AUTHENTICATION_REQUIRED") {
    appError = new AppError(401, "AUTHENTICATION_REQUIRED", "authentication is required");
  } else if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number" && error.status >= 400 && error.status < 500) {
    const status = error.status;
    appError = new AppError(status, status === 413 ? "REQUEST_TOO_LARGE" : "REQUEST_INVALID", status === 413 ? "request body is too large" : "request could not be processed");
  } else {
    req.log.error({ err: error }, "unhandled request error");
    appError = new AppError(500, "INTERNAL_ERROR", "an unexpected error occurred");
  }

  const body: { error: { code: string; message: string; details?: unknown }; requestId?: string } = {
    error: { code: appError.code, message: appError.message },
  };
  if (appError.details !== undefined) body.error.details = appError.details;
  const requestId = req.id;
  if (requestId) body.requestId = String(requestId);
  res.status(appError.statusCode).json(body);
};
