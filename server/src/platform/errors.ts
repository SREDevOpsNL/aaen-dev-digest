/**
 * Domain error taxonomy + structured API error envelope. The UX taxonomy
 * (toast/inline/full-screen) is the frontend's concern; the API returns a
 * stable structured body (ApiErrorBody): { error: { code, message, details } }.
 */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found', details?: unknown) {
    super('not_found', message, 404, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed', details?: unknown) {
    super('validation_error', message, 422, details);
  }
}

export class ExternalServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super('external_service_error', message, 502, details);
  }
}

export class ConfigError extends AppError {
  constructor(message: string, details?: unknown) {
    super('config_error', message, 500, details);
  }
}

/** An agent already has the maximum number of linked skills; adding another is refused. */
export class SkillLimitError extends AppError {
  constructor(max: number) {
    super('skill_limit_reached', `An agent can have at most ${max} skills. Unlink one before adding another.`, 422, { max });
  }
}

/** The request conflicts with current state (e.g. an experiment slot already used or in flight). */
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super('conflict', message, 409, details);
  }
}

/** The caller is known but lacks the workspace role this action needs. */
export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden', details?: unknown) {
    super('forbidden', message, 403, details);
  }
}

/**
 * A review would put skill content into the system message that no workspace
 * owner approved (or whose approval is stale or revoked), or the approval
 * state could not be read. Raised before any model request.
 */
export class SkillNotApprovedError extends AppError {
  constructor(message: string, details?: unknown) {
    super('skill_not_approved', message, 409, details);
  }
}
