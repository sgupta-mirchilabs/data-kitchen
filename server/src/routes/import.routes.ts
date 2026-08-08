import type { FastifyInstance } from "fastify";
import "../types.js";
import { ImportService } from "../services/import.service.js";
import { suggestFieldMappings, type FieldMapping } from "../services/normalizer.js";
import { detectDuplicateSkus, countOverwrittenRows } from "../services/duplicate-detection.js";
import { findTemplateMatch, saveTemplate } from "../services/mapping-template.service.js";
import { ValidationError, FileTooLargeError } from "../errors/api-errors.js";
import { requirePermission } from "../auth/permissions.js";
import { writeAuditLog } from "../services/audit.service.js";

export async function importRoutes(app: FastifyInstance) {
  const importService = new ImportService(app.prisma, app.storage, app.config);

  app.post<{ Params: { catalogId: string } }>(
    "/catalogs/:catalogId/imports",
    async (request, reply) => {
      const ctx = request.tenantContext;
      requirePermission(ctx, "import:execute");

      const { catalogId } = request.params;

      const catalog = await app.prisma.catalog.findFirst({
        where: { id: catalogId, organizationId: ctx.organizationId },
      });
      if (!catalog) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Catalog not found: ${catalogId}` },
        });
      }

      const file = await request.file();
      if (!file) {
        throw new ValidationError("No file provided. Upload a CSV or JSON file.");
      }

      const buffer = await file.toBuffer();

      if (buffer.length === 0) {
        throw new ValidationError("Uploaded file is empty");
      }

      const maxBytes = app.config.upload.maxFileSizeMb * 1024 * 1024;
      if (buffer.length > maxBytes) {
        throw new FileTooLargeError(app.config.upload.maxFileSizeMb);
      }

      const sourceSystem = (request.body as Record<string, unknown>)?.source_system as string | undefined;

      const result = await importService.uploadAndPreview(
        ctx,
        catalogId,
        file.filename,
        buffer,
        sourceSystem,
      );

      const autoMappings = suggestFieldMappings(result.preview.headers);
      const fileType = file.filename.toLowerCase().endsWith(".json") ? "json" : "csv";

      // A saved template for this header shape takes precedence over
      // alias-based auto-suggestion — it reflects a real operator decision.
      const templateMatch = await findTemplateMatch(
        app.prisma, ctx.organizationId, result.preview.headers, fileType,
      );
      const suggestedMappings = { ...autoMappings, ...templateMatch.appliedMappings };

      // Warn about repeated business keys before the operator commits (KI-3).
      // Over the WHOLE file — preview.sampleRows is only the first 20 rows, so
      // scanning it would miss duplicates and understate the warning.
      const duplicateGroups = detectDuplicateSkus(result.allRows, suggestedMappings.sku);

      await writeAuditLog(app.prisma, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: "import.uploaded",
        resourceType: "import_batch",
        resourceId: result.importBatchId,
        requestId: request.requestId,
        result: "success",
        metadata: { filename: file.filename, totalRows: result.preview.totalRows, catalogId },
      });

      return reply.status(201).send({
        data: {
          importBatchId: result.importBatchId,
          preview: result.preview,
          suggestedMappings,
          templateMatch: {
            kind: templateMatch.kind,
            templateId: templateMatch.template?.id ?? null,
            version: templateMatch.template?.version ?? null,
            coverage: templateMatch.coverage,
            newHeaders: templateMatch.newHeaders,
            missingHeaders: templateMatch.missingHeaders,
          },
          duplicates: {
            groups: duplicateGroups,
            overwrittenRows: countOverwrittenRows(duplicateGroups),
          },
        },
      });
    },
  );

  app.get<{ Params: { catalogId: string }; Querystring: { page?: string; limit?: string } }>(
    "/catalogs/:catalogId/imports",
    async (request, reply) => {
      const ctx = request.tenantContext;
      requirePermission(ctx, "catalog:read");

      const { catalogId } = request.params;

      const catalog = await app.prisma.catalog.findFirst({
        where: { id: catalogId, organizationId: ctx.organizationId },
      });
      if (!catalog) {
        return reply.status(404).send({
          error: { code: "NOT_FOUND", message: `Catalog not found: ${catalogId}` },
        });
      }

      const page = Math.max(1, parseInt(request.query.page ?? "1", 10));
      const limit = Math.min(100, Math.max(1, parseInt(request.query.limit ?? "20", 10)));
      const skip = (page - 1) * limit;

      const [imports, total] = await Promise.all([
        app.prisma.importBatch.findMany({
          where: { catalogId, organizationId: ctx.organizationId },
          orderBy: { uploadedAt: "desc" },
          skip,
          take: limit,
        }),
        app.prisma.importBatch.count({ where: { catalogId, organizationId: ctx.organizationId } }),
      ]);

      return reply.send({
        data: imports,
        meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
      });
    },
  );

  app.get<{ Params: { id: string } }>("/imports/:id", async (request, reply) => {
    const ctx = request.tenantContext;
    requirePermission(ctx, "catalog:read");

    const batch = await app.prisma.importBatch.findFirst({
      where: { id: request.params.id, organizationId: ctx.organizationId },
    });

    if (!batch) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: `Import batch not found: ${request.params.id}` },
      });
    }

    return reply.send({ data: batch });
  });

  app.post<{ Params: { id: string }; Body: { fieldMappings: FieldMapping; templateMode?: "new-version" | "replace" } }>(
    "/imports/:id/confirm",
    async (request, reply) => {
      const ctx = request.tenantContext;
      requirePermission(ctx, "import:execute");

      const { fieldMappings } = request.body;

      if (!fieldMappings || typeof fieldMappings !== "object") {
        throw new ValidationError("fieldMappings is required and must be an object");
      }

      const results = await importService.confirmImport(ctx, request.params.id, fieldMappings);

      // Record the mapping the operator actually confirmed so the next upload of
      // the same shape needs no mapping work. Best-effort: a template failure
      // must never fail an import that already succeeded.
      let savedTemplate: { id: string; version: number; created: boolean } | null = null;
      if (results.status === "completed") {
        try {
          const batch = await app.prisma.importBatch.findUnique({
            where: { id: request.params.id },
            select: { detectedHeaders: true, fileType: true },
          });
          const headers = (batch?.detectedHeaders as string[] | null) ?? [];
          if (headers.length > 0) {
            savedTemplate = await saveTemplate(app.prisma, {
              organizationId: ctx.organizationId,
              sourceType: batch?.fileType ?? "csv",
              headers,
              mappings: fieldMappings as Record<string, string>,
              actor: ctx.displayName,
              mode: (request.body as { templateMode?: "new-version" | "replace" }).templateMode,
            });
          }
        } catch (err) {
          request.log.warn({ err, importBatchId: request.params.id }, "mapping template not saved");
        }
      }

      const auditAction = results.status === "completed" ? "import.completed" : "import.failed";
      await writeAuditLog(app.prisma, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: "import.confirmed",
        resourceType: "import_batch",
        resourceId: request.params.id,
        requestId: request.requestId,
        result: "success",
        metadata: { totalRows: results.totalRows, successfulRows: results.successfulRows, failedRows: results.failedRows },
      });
      await writeAuditLog(app.prisma, {
        organizationId: ctx.organizationId,
        userId: ctx.userId,
        action: auditAction,
        resourceType: "import_batch",
        resourceId: request.params.id,
        requestId: request.requestId,
        result: results.status === "completed" ? "success" : "failure",
        metadata: { createdProducts: results.createdProducts, updatedProducts: results.updatedProducts },
      });

      return reply.send({ data: { ...results, savedTemplate } });
    },
  );

  app.get<{ Params: { id: string } }>("/imports/:id/results", async (request, reply) => {
    const ctx = request.tenantContext;
    requirePermission(ctx, "catalog:read");

    const batch = await app.prisma.importBatch.findFirst({
      where: { id: request.params.id, organizationId: ctx.organizationId },
    });

    if (!batch) {
      return reply.status(404).send({
        error: { code: "NOT_FOUND", message: `Import batch not found: ${request.params.id}` },
      });
    }

    const [sourceRecordCounts, createdCount, updatedCount] = await Promise.all([
      app.prisma.sourceRecord.groupBy({
        by: ["parseStatus"],
        where: { importBatchId: batch.id },
        _count: true,
      }),
      app.prisma.sourceRecord.count({
        where: {
          importBatchId: batch.id,
          parseStatus: { in: ["success", "warning"] },
          canonicalProduct: { createdAt: { gte: batch.uploadedAt } },
        },
      }),
      app.prisma.sourceRecord.count({
        where: {
          importBatchId: batch.id,
          parseStatus: { in: ["success", "warning"] },
          canonicalProduct: { createdAt: { lt: batch.uploadedAt } },
        },
      }),
    ]);

    return reply.send({
      data: {
        importBatchId: batch.id,
        status: batch.status,
        totalRows: batch.totalRows,
        successfulRows: batch.successfulRows,
        warningRows: batch.warningRows,
        failedRows: batch.failedRows,
        createdProducts: createdCount,
        updatedProducts: updatedCount,
        errorSummary: batch.errorSummary,
        fieldMappings: batch.fieldMappings,
      },
    });
  });
}
