import { Request, Response, NextFunction } from "express";
import { Logger } from "../ports/Logger";

export function createUncaughtErrorHandler(logger: Logger) {
  return function unCaughtErrorHandler(
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    logger.error("Unhandled request error", {
      error: err instanceof Error ? err.message : err,
      path: req.path,
      method: req.method,
    });
    res.status(500).json({ error: "Internal server error" });
  };
}

export function createApiErrorHandler(logger: Logger) {
  return function apiErrorHandler(
    err: any,
    req: Request,
    res: Response,
    message: string
  ): void {
    logger.error(message, {
      error: err instanceof Error ? err.message : err,
      path: req.path,
      method: req.method,
    });
    res.json({ Message: message });
  };
}
