import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { CurrentUser } from "../types/express";
import httpStatusCodes from "../constants/httpStatusCodes";
import errorMessages from "../constants/errorMessages";

export default function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length)
    : undefined;

  if (!token) {
    res
      .status(httpStatusCodes.UNAUTHORIZED)
      .json({ message: errorMessages.UNAUTHORIZED });
    return;
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET as string) as CurrentUser;
    next();
  } catch {
    res
      .status(httpStatusCodes.UNAUTHORIZED)
      .json({ message: errorMessages.UNAUTHORIZED });
  }
}
