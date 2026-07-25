import { NextFunction, Request, Response } from "express";
import { randomUUID } from "crypto";

const HEADER = "x-request-id";

export default function requestId(req: Request, res: Response, next: NextFunction): void {
  req.id = (req.header(HEADER) || randomUUID()) as string;
  res.setHeader("X-Request-Id", req.id);
  next();
}
