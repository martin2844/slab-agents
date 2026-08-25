export class OperationalError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(
    message: string,
    code = "OPERATION_REJECTED",
    status = 400,
  ) {
    super(message);
    this.name = "OperationalError";
    this.code = code;
    this.status = status;
  }
}
