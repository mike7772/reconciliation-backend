import { Application } from "express";
import authRoutes from "../modules/auth/auth.routes";

export default class Routes {
  constructor(app: Application) {
    app.use("/api/auth", authRoutes);
  }
}
