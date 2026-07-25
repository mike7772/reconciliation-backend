import { Application } from "express";
import authRoutes from "../modules/auth/auth.routes";
import createHealthRoutes from "../modules/health/health.routes";
import createImportRoutes from "../modules/imports/imports.routes";
import { Container } from "../composition/container";

export default class Routes {
  constructor(app: Application, container: Container) {
    app.use(createHealthRoutes(container));
    app.use("/api/auth", authRoutes);
    // Spec-mandated paths (no /api prefix): POST /v1/imports, etc.
    app.use(createImportRoutes(container));
  }
}
