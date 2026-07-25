import { Response } from "express";
import ApiError from "../errors/ApiError";
import ResponseJSON from "./ResponseJSON";
import httpStatusCodes from "../constants/httpStatusCodes";
import errorMessages from "../constants/errorMessages";

export default function handleControllerError(err: unknown, res: Response): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json(ResponseJSON(err.message, err.statusCode, true));
    return;
  }

  res
    .status(httpStatusCodes.INTERNAL_SERVER)
    .json(ResponseJSON(errorMessages.INTERNAL_SERVER, httpStatusCodes.INTERNAL_SERVER, true));
}
