export class RunnerRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "RunnerRequestError";
    this.status = status;
  }
}

export class RunnerBudgetCompatibilityError extends RunnerRequestError {
  constructor(message: string) {
    super(message, 409);
    this.name = "RunnerBudgetCompatibilityError";
  }
}

export function isRunnerRunNotFound(
  error: unknown,
): error is RunnerRequestError {
  return (
    error instanceof RunnerRequestError &&
    error.status === 404 &&
    error.message === "Run was not found"
  );
}
