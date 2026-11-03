# 4. The schema is ordered files, rebuilt from scratch

Status: accepted · October 2026

## Context

The schema changed daily while the product took shape. A growing chain of migrations would have hidden the current
shape of each table across many files, and every migration would have needed its own review for grants and policies.

## Decision

- The schema is the ordered files `db/schema/00_bootstrap.sql` to `90_seal.sql` (PostgreSQL 17), one area per file.
  The build drops every Munshi schema and applies them in order, each file in its own transaction, as the migrator.
- A fix is made in place, in the file that owns the table. Every prefix of the files must build on its own: a key to a
  later file's table is added by that later file.
- Each file has a manifest listing its tables, grants, policies and indexes; gates check the built database against
  them, and `90_seal.sql` checks the whole (no function executable by PUBLIC, every search path pinned, every command
  writing a books table).
- The build refuses to run on a database marked live, and the app refuses a database built from other files than its
  own.

## Consequences

- Reading one file shows a table's current truth: columns, grants, policies and triggers together.
- Tests build the whole schema from scratch for every run, so the build itself is tested constantly.
- There is no migration history. Once a database holds real shops' data, changes must move to forward migrations; that
  switch is still ahead.

Code: [`db/schema`](../../db/schema), [`db/src/build.ts`](../../db/src/build.ts).
