export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
    readonly details?: unknown
  ) {
    super(message);
    this.name = "ServiceError";
  }
}

export function notFound(message: string): never {
  throw new ServiceError("NOT_FOUND", message, 404);
}

export function forbidden(message = "Not authorized for this organization"): never {
  throw new ServiceError("FORBIDDEN", message, 403);
}
