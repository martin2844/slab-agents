export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 max-w-3xl">
        {eyebrow && (
          <p className="mb-1 font-mono text-[0.68rem] font-medium uppercase tracking-[0.02em] text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h1 className="font-heading text-[clamp(2rem,3vw,2.5rem)] font-[675] leading-[0.98] tracking-[-0.045em]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-5 text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {actions && (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      )}
    </header>
  );
}
