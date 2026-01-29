import { createRequire } from "node:module";
import type { ErrorObject } from "ajv";
import { getPinnedClawdbotSchema } from "./clawdbot-schema.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;

type AjvValidate = import("ajv").ValidateFunction;

export type ClawdbotSchemaValidationIssue = {
  path: Array<string | number>;
  message: string;
  keyword?: string;
  instancePath?: string;
  schemaPath?: string;
};

export type ClawdbotSchemaValidation = {
  ok: boolean;
  errors: string[];
  issues: ClawdbotSchemaValidationIssue[];
};

const pinnedSchema = getPinnedClawdbotSchema().schema as Record<string, unknown>;
let cachedPinnedValidator: AjvValidate | null = null;

function formatAjvError(err: ErrorObject): string {
  const pathBase = err.instancePath ? err.instancePath.replace(/^\//, "").replaceAll("/", ".") : "(root)";
  if (err.keyword === "required" && typeof (err.params as { missingProperty?: unknown })?.missingProperty === "string") {
    const missing = (err.params as { missingProperty?: string }).missingProperty;
    return `${pathBase === "(root)" ? missing : `${pathBase}.${missing}`}: ${err.message ?? "required"}`;
  }
  return `${pathBase}: ${err.message ?? "invalid"}`;
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

function parseInstancePath(path: string): Array<string | number> {
  if (!path) return [];
  return path
    .split("/")
    .slice(1)
    .map((segment) => decodeJsonPointerSegment(segment))
    .map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

function buildIssue(err: ErrorObject): ClawdbotSchemaValidationIssue {
  const basePath = parseInstancePath(err.instancePath || "");
  let path = basePath;
  if (err.keyword === "required" && typeof (err.params as { missingProperty?: unknown })?.missingProperty === "string") {
    const missing = (err.params as { missingProperty?: string }).missingProperty;
    if (missing) path = [...basePath, missing];
  }
  if (err.keyword === "additionalProperties" && typeof (err.params as { additionalProperty?: unknown })?.additionalProperty === "string") {
    const extra = (err.params as { additionalProperty?: string }).additionalProperty;
    if (extra) path = [...basePath, extra];
  }
  if (err.keyword === "unevaluatedProperties" && typeof (err.params as { unevaluatedProperty?: unknown })?.unevaluatedProperty === "string") {
    const extra = (err.params as { unevaluatedProperty?: string }).unevaluatedProperty;
    if (extra) path = [...basePath, extra];
  }
  if (err.keyword === "propertyNames" && typeof (err.params as { propertyName?: unknown })?.propertyName === "string") {
    const prop = (err.params as { propertyName?: string }).propertyName;
    if (prop) path = [...basePath, prop];
  }
  return {
    path,
    message: formatAjvError(err),
    keyword: err.keyword,
    instancePath: err.instancePath,
    schemaPath: err.schemaPath,
  };
}

function buildAjv(): import("ajv").default {
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    validateFormats: false,
  });
  return ajv;
}

function getValidator(schema: Record<string, unknown>): AjvValidate {
  if (schema === pinnedSchema) {
    if (cachedPinnedValidator) return cachedPinnedValidator;
    const ajv = buildAjv();
    cachedPinnedValidator = ajv.compile(schema);
    return cachedPinnedValidator;
  }
  const ajv = buildAjv();
  return ajv.compile(schema);
}

export function validateClawdbotConfig(value: unknown, schema?: Record<string, unknown>): ClawdbotSchemaValidation {
  const targetSchema = schema ?? pinnedSchema;
  const validate = getValidator(targetSchema);
  const ok = Boolean(validate(value));
  if (ok) return { ok: true, errors: [], issues: [] };
  const issues = (validate.errors || []).map(buildIssue);
  const errors = issues.map((issue) => issue.message);
  return { ok: false, errors, issues };
}
