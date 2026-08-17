interface BuildEnvironment {
  NEXT_DIST_DIR?: string;
  NODE_ENV?: string;
}

export function resolveNextDistDir(
  environment: BuildEnvironment = process.env,
): string {
  const override = environment.NEXT_DIST_DIR?.trim();

  if (override) return override;

  return environment.NODE_ENV === "development" ? ".next-dev" : ".next";
}
