/** Integration tests truncate every table, so they refuse to touch anything that is not a *_test database. */
export function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL || "postgresql://dorocity:dorocity_local_only@127.0.0.1:54329/dorocity_test";
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith("_test")) throw new Error(`Refusing to run integration tests against database "${name}" (name must end in _test).`);
  // Larger pool so the concurrency tests contend on rows, not on connections.
  return url.includes("connection_limit") ? url : `${url}${url.includes("?") ? "&" : "?"}connection_limit=30&pool_timeout=30`;
}
