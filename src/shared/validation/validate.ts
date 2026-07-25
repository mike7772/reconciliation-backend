import { NextFunction, Request, Response } from "express";
import { ZodType } from "./zod";
import httpStatusCodes from "../constants/httpStatusCodes";
import errorMessages from "../constants/errorMessages";

export default function validate(schema: ZodType) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(httpStatusCodes.BAD_REQUEST).json({
        message: errorMessages.BAD_REQUEST,
        errors: result.error.flatten().fieldErrors,
      });
      return;
    }

    req.body = result.data;
    next();
  };
}
