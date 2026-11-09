export type DiffLine = { kind: "same" | "removed" | "added"; text: string };

// Bound quadratic work for large documents. Common leading/trailing lines
// are removed first; very large replacements still display every changed line.
export function documentLineDiff(before: string, after: string): DiffLine[] {
  const left = before ? before.split("\n") : [];
  const right = after ? after.split("\n") : [];
  let start = 0;
  while (
    start < left.length &&
    start < right.length &&
    left[start] === right[start]
  )
    start++;
  let end = 0;
  while (
    end < left.length - start &&
    end < right.length - start &&
    left[left.length - 1 - end] === right[right.length - 1 - end]
  )
    end++;
  const a = left.slice(start, left.length - end),
    b = right.slice(start, right.length - end);
  const result: DiffLine[] = left
    .slice(0, start)
    .map((text) => ({ kind: "same", text }));
  if ((a.length + 1) * (b.length + 1) > 500_000) {
    result.push(
      ...a.map((text) => ({ kind: "removed" as const, text })),
      ...b.map((text) => ({ kind: "added" as const, text })),
    );
  } else {
    const width = b.length + 1,
      matrix = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        matrix[i * width + j] =
          a[i] === b[j]
            ? matrix[(i + 1) * width + j + 1]! + 1
            : Math.max(
                matrix[(i + 1) * width + j]!,
                matrix[i * width + j + 1]!,
              );
    let i = 0,
      j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        result.push({ kind: "same", text: a[i++]! });
        j++;
      } else if (
        i < a.length &&
        (j === b.length ||
          matrix[(i + 1) * width + j]! >= matrix[i * width + j + 1]!)
      )
        result.push({ kind: "removed", text: a[i++]! });
      else result.push({ kind: "added", text: b[j++]! });
    }
  }
  result.push(
    ...left
      .slice(left.length - end)
      .map((text) => ({ kind: "same" as const, text })),
  );
  return result;
}
