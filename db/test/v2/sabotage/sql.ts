// Building blocks for the v2 sql sabotage cases, which run as the superuser in a test file's fresh clone after its
// fixtures (TestDb.sabotage).
const q = (s: string) => `'${s.replaceAll("'", "''")}'`;

// Rewrites one function's body; raises unless the text occurs exactly once, so a stale case is an ERROR, never a red.
// CREATE OR REPLACE keeps the function's owner and grants.
export function mutate(fn: string, from: string, to: string): string {
  return `do $sabotage$
declare
  def text := pg_get_functiondef(${q(fn)}::regprocedure);
begin
  if array_length(string_to_array(def, ${q(from)}), 1) <> 2 then
    raise exception 'sabotage: % does not contain the text to break exactly once', ${q(fn)};
  end if;
  execute replace(def, ${q(from)}, ${q(to)});
end $sabotage$;`;
}

export const asOwner = (sql: string) => `set role munshi_owner; ${sql} reset role;`;
