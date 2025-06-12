import * as Ky from "kysely";

export async function up(db: Ky.Kysely<any>) {
  await db.schema
    .createTable("workers")
    .addColumn("id", "text", (col) => col.primaryKey())
    .addColumn("from_event_id", "bigint", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(Ky.sql`now()`))
    .addColumn("updated_at", "timestamptz", (c) => c.notNull().defaultTo(Ky.sql`now()`))
    .execute();
}

export async function down(db: Ky.Kysely<any>) {
  await db.schema.dropTable("workers").execute();
}
