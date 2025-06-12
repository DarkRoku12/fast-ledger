import * as Ky from "kysely";

export async function up(db: Ky.Kysely<any>): Promise<void> {
  await db.schema
    .createTable("events")
    .addColumn("id", "bigint", (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn("task_id", "text", (col) => col.notNull())
    .addColumn("account_id", "bigint", (col) => col.notNull())
    .addColumn("operation", "text", (col) => col.notNull())
    .addColumn("status", "text", (col) => col.notNull().defaultTo("p"))
    .addColumn("amount", "decimal(18, 6)", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(Ky.sql`now()`))
    .execute();

  /**
   Notes:
     [account_id]
        We won't create a FK for this, since 'SELECT ... FOR UPDATE' will block inserts to FKs as well.
        PostgreSQL provides an extension FOR NO KEY UPDATE to address this).
    [operation/task_id]
       In some database, we may prefer VARCHAR(n)
    [task_id]
       As long as we use UUID or similar we don't need to check for uniqueness (slows inserts).
    [created_at]
       For non-PG databases, use 'timestamp'.
  */
}

export async function down(db: Ky.Kysely<any>): Promise<void> {
  await db.schema.dropTable("events").execute();
}
