import type { Logger } from "pino";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
      log: Logger;
    }
  }
}

export {};
