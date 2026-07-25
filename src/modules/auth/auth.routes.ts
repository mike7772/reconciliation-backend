import { Router } from "express";
import * as authController from "./auth.controller";
import validate from "../../shared/validation/validate";
import authenticate from "../../shared/middleware/authenticate";
import { registerSchema, loginSchema } from "./auth.validation";

const router = Router();

router.post("/register", validate(registerSchema), authController.register);
router.post("/login", validate(loginSchema), authController.login);
router.get("/me", authenticate, authController.me);

export default router;
