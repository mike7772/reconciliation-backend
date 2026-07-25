import { NextFunction, Request, Response } from "express";
import httpStatusCodes from "../constants/httpStatusCodes";
import errorMessages from "../constants/errorMessages";

export default function authorize(...allowedRoles: number[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res
        .status(httpStatusCodes.UNAUTHORIZED)
        .json({ message: errorMessages.UNAUTHORIZED });
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res
        .status(httpStatusCodes.FORBIDDEN)
        .json({ message: errorMessages.FORBIDDEN });
      return;
    }

    next();
  };
}
