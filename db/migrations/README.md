# Database migrations

Migration filenames are immutable after release because Knex records the full
filename in `knex_migrations`. Never rename an applied migration to repair its
numeric prefix.

Two historical migrations share the `202608240024` prefix. Their complete
filenames are distinct and both have shipped, so this is safe for Knex and is
preserved for deployed databases. New migrations must use a new, unique numeric
prefix and remain append-only.
