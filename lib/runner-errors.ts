export class RunnerRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RunnerRequestError";
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
