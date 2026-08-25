export class IntegrationConfigurationError extends Error {
  readonly code = "INVALID_INTEGRATION_CONFIGURATION";

  constructor(message: string) {
    super(message);
    this.name = "IntegrationConfigurationError";
  }
}

export class IntegrationVersionConflictError extends Error {
  readonly code = "INTEGRATION_VERSION_CONFLICT";

  constructor(
    message = "Integration changed while it was being saved. Reload the current configuration and try again.",
  ) {
    super(message);
    this.name = "IntegrationVersionConflictError";
  }
}

export class IntegrationNotFoundError extends Error {
  readonly code = "INTEGRATION_NOT_FOUND";

  constructor(message = "Integration not found.") {
    super(message);
    this.name = "IntegrationNotFoundError";
  }
}
