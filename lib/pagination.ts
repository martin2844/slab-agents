export type OffsetPage<T> = {
  items: T[];
  total?: number | null;
  hasMore?: boolean;
};

export async function collectOffsetPages<T>(input: {
  pageSize: number;
  maxItems: number;
  label: string;
  fetchPage: (limit: number, offset: number) => Promise<OffsetPage<T>>;
}) {
  const items: T[] = [];
  for (let offset = 0; ; ) {
    if (items.length === input.maxItems) {
      const probe = await input.fetchPage(1, offset);
      if (probe.items.length === 0) return items;
      throw new Error(
        `${input.label} exceeded the ${input.maxItems}-item control-plane safety limit.`,
      );
    }

    const requestLimit = Math.min(
      input.pageSize,
      input.maxItems - items.length,
    );
    const page = await input.fetchPage(requestLimit, offset);
    items.push(...page.items);
    if (items.length > input.maxItems) {
      throw new Error(
        `${input.label} exceeded the ${input.maxItems}-item control-plane safety limit.`,
      );
    }
    const hasKnownTotal = Number.isFinite(page.total);
    const knownMore =
      page.hasMore === true ||
      (hasKnownTotal && items.length < Number(page.total));
    if (page.items.length === 0) {
      if (knownMore) {
        throw new Error(`${input.label} returned an empty page before its end.`);
      }
      return items;
    }
    if (
      page.hasMore === false ||
      (hasKnownTotal && items.length >= Number(page.total)) ||
      (!knownMore && page.items.length < requestLimit)
    )
      return items;
    offset += page.items.length;
  }
}
