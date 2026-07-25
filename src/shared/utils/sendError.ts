import { Request, Response } from "express";
import { AppError } from "../errors/AppError";
import httpStatusCodes from "../constants/httpStatusCodes";

// Matches the spec's required error contract exactly:
// { "error": { "code": "...", "message": "...", "requestId": "..." } }
// Never leaks stack traces, DB errors, or other internal diagnostics -
// those go to the logger (via the caller), not the response body.
export default function sendError(req: Request, res: Response, err: unknown): void {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, requestId: req.id },
    });
    return;
  }

  res.status(httpStatusCodes.INTERNAL_SERVER).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      requestId: req.id,
    },
  });
}
