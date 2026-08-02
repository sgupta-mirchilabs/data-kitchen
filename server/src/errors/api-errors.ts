export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(400, "VALIDATION_ERROR", message, details);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(404, "NOT_FOUND", `${resource} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

export class ParseError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(422, "PARSE_ERROR", message, details);
    this.name = "ParseError";
  }
}

export class StorageError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(500, "STORAGE_ERROR", message, details);
    this.name = "StorageError";
  }
}

export class FileTooLargeError extends AppError {
  constructor(maxMb: number) {
    super(413, "FILE_TOO_LARGE", `File exceeds maximum size of ${maxMb} MB`);
    this.name = "FileTooLargeError";
  }
}
