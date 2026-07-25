import { Request, Response } from "express";
import * as authService from "./auth.service";
import ResponseJSON from "../../shared/utils/ResponseJSON";
import handleControllerError from "../../shared/utils/handleControllerError";
import httpStatusCodes from "../../shared/constants/httpStatusCodes";

export async function register(req: Request, res: Response): Promise<void> {
  try {
    const result = await authService.register(req.body);
    res
      .status(httpStatusCodes.OK)
      .json(ResponseJSON("Registered successfully", httpStatusCodes.OK, false, result));
  } catch (err) {
    handleControllerError(err, res);
  }
}

export async function login(req: Request, res: Response): Promise<void> {
  try {
    const result = await authService.login(req.body);
    res
      .status(httpStatusCodes.OK)
      .json(ResponseJSON("Logged in successfully", httpStatusCodes.OK, false, result));
  } catch (err) {
    handleControllerError(err, res);
  }
}

export async function me(req: Request, res: Response): Promise<void> {
  res
    .status(httpStatusCodes.OK)
    .json(ResponseJSON("Current user", httpStatusCodes.OK, false, req.user));
}
