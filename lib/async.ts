export async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  let stopped = false;
  let hasFailure = false;
  let failure: unknown;
  const workerCount = Math.min(Math.max(1, concurrency), values.length);

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (!stopped && nextIndex < values.length) {
        const index = nextIndex++;
        try {
          results[index] = await mapper(values[index], index);
        } catch (error) {
          if (!hasFailure) {
            hasFailure = true;
            failure = error;
          }
          stopped = true;
        }
      }
    }),
  );
  if (hasFailure) throw failure;

  return results;
}
