import { Request, Response } from "express";
import Busboy from "busboy";
import { ImportService } from "./domain/ImportService";
import { providerIdSchema } from "./imports.validation";
import { AppError } from "../../shared/errors/AppError";
import sendError from "../../shared/utils/sendError";
import httpStatusCodes from "../../shared/constants/httpStatusCodes";
import { Logger } from "../../shared/ports/Logger";

const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES) || 2 * 1024 * 1024 * 1024;
const ALLOWED_EXTENSIONS = [".ndjson", ".jsonl"];

function fileExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();
}

export function createImportHandler(importService: ImportService, logger: Logger) {
  return async (req: Request, res: Response): Promise<void> => {
    const idempotencyKey = req.header("Idempotency-Key");
    if (!idempotencyKey) {
      sendError(
        req,
        res,
        new AppError(
          httpStatusCodes.BAD_REQUEST,
          "IDEMPOTENCY_KEY_REQUIRED",
          "Idempotency-Key header is required"
        )
      );
      return;
    }

    // Fast path: a retried request with an already-known key never touches
    // the (possibly very large) request body at all.
    const existing = await importService.findExistingByIdempotencyKey(idempotencyKey);
    if (existing) {
      res.status(httpStatusCodes.ACCEPTED).json({
        id: existing.id,
        status: existing.status,
        createdAt: existing.createdAt,
      });
      return;
    }

    if (!req.is("multipart/form-data")) {
      sendError(
        req,
        res,
        new AppError(
          httpStatusCodes.UNSUPPORTED_MEDIA_TYPE,
          "INVALID_CONTENT_TYPE",
          "Expected multipart/form-data"
        )
      );
      return;
    }

    let providerId: string | undefined;
    let sawFile = false;
    let responded = false;

    const respondOnce = (statusCode: number, body: unknown): void => {
      if (responded) return;
      responded = true;
      res.status(statusCode).json(body);
    };

    const errorOnce = (err: AppError): void => {
      if (responded) return;
      responded = true;
      sendError(req, res, err);
    };

    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
    });

    busboy.on("field", (name, value) => {
      if (name === "providerId") {
        providerId = value;
      }
    });

    busboy.on("file", (_name, fileStream, info) => {
      sawFile = true;

      if (!providerId) {
        fileStream.resume();
        errorOnce(
          new AppError(
            httpStatusCodes.BAD_REQUEST,
            "PROVIDER_ID_REQUIRED",
            "providerId field must be sent before the file part"
          )
        );
        return;
      }

      const providerIdResult = providerIdSchema.safeParse(providerId);
      if (!providerIdResult.success) {
        fileStream.resume();
        errorOnce(
          new AppError(httpStatusCodes.BAD_REQUEST, "INVALID_PROVIDER_ID", "providerId is invalid")
        );
        return;
      }

      const extension = fileExtension(info.filename);
      if (!ALLOWED_EXTENSIONS.includes(extension)) {
        fileStream.resume();
        errorOnce(
          new AppError(
            httpStatusCodes.UNSUPPORTED_MEDIA_TYPE,
            "UNSUPPORTED_FILE_TYPE",
            "Only .ndjson/.jsonl files are accepted"
          )
        );
        return;
      }

      fileStream.on("limit", () => {
        errorOnce(
          new AppError(
            httpStatusCodes.PAYLOAD_TOO_LARGE,
            "IMPORT_FILE_TOO_LARGE",
            "The uploaded file exceeds the allowed size"
          )
        );
      });

      importService
        .createImport({
          idempotencyKey,
          providerId: providerIdResult.data,
          fileStream,
          originalFilename: info.filename,
          mimeType: info.mimeType,
        })
        .then((created) => {
          respondOnce(httpStatusCodes.ACCEPTED, {
            id: created.id,
            status: created.status,
            createdAt: created.createdAt,
          });
        })
        .catch((err) => {
          if (responded) {
            logger.error("Import creation failed after response already sent", {
              error: err instanceof Error ? err.message : err,
            });
            return;
          }
          responded = true;
          sendError(req, res, err);
        });
    });

    busboy.on("error", (err) => {
      errorOnce(
        new AppError(
          httpStatusCodes.BAD_REQUEST,
          "MALFORMED_UPLOAD",
          err instanceof Error ? err.message : "Malformed upload"
        )
      );
    });

    busboy.on("close", () => {
      if (!sawFile) {
        errorOnce(
          new AppError(httpStatusCodes.BAD_REQUEST, "FILE_REQUIRED", "A file part is required")
        );
      }
    });

    req.pipe(busboy);
  };
}

export function createGetImportHandler(importService: ImportService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const found = await importService.getImport(req.params.id);
      res.status(httpStatusCodes.OK).json({
        id: found.id,
        status: found.status,
        progress: {
          processed: found.processedCount,
          accepted: found.acceptedCount,
          rejected: found.rejectedCount,
          duplicates: found.duplicateCount,
        },
        startedAt: found.startedAt,
        completedAt: found.completedAt,
        failureReason: found.failureReason,
      });
    } catch (err) {
      sendError(req, res, err);
    }
  };
}

export function createCancelImportHandler(importService: ImportService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const cancelled = await importService.cancelImport(req.params.id);
      res.status(httpStatusCodes.OK).json({
        id: cancelled.id,
        status: cancelled.status,
      });
    } catch (err) {
      sendError(req, res, err);
    }
  };
}

export function createSummaryHandler(importService: ImportService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const summary = await importService.getSummary(req.params.id);
      res.status(httpStatusCodes.OK).json({
        importId: req.params.id,
        totals: summary.totals,
        byCurrency: summary.byCurrency.map((c) => ({
          currency: c.currency,
          transactionCount: c.transactionCount,
          totalAmount: Number(c.totalAmount),
        })),
        byRiskLevel: summary.byRiskLevel,
      });
    } catch (err) {
      sendError(req, res, err);
    }
  };
}

const DEFAULT_REJECTIONS_LIMIT = 50;
const MAX_REJECTIONS_LIMIT = 200;

export function createRejectionsHandler(importService: ImportService) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const rawLimit = Number(req.query.limit);
      const limit =
        Number.isFinite(rawLimit) && rawLimit > 0
          ? Math.min(rawLimit, MAX_REJECTIONS_LIMIT)
          : DEFAULT_REJECTIONS_LIMIT;
      const cursor = typeof req.query.cursor === "string" ? req.query.cursor : null;

      const page = await importService.getRejections(req.params.id, limit, cursor);
      res.status(httpStatusCodes.OK).json({
        items: page.items.map((item) => ({
          lineNumber: item.lineNumber,
          reason: item.reasonCode,
          message: item.message,
          rawValue: item.rawValue,
        })),
        nextCursor: page.nextCursor,
      });
    } catch (err) {
      sendError(req, res, err);
    }
  };
}
