import * as Ky from "kysely";

export async function up(db: Ky.Kysely<any>) {
  await db.schema
    .createTable("transactions")
    .addColumn("id", "bigint", (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn("event_id", "bigint")
    .addColumn("account_id", "bigint", (col) => col.notNull())
    .addColumn("operation", "text", (col) => col.notNull())
    .addColumn("label", "text", (col) => col.notNull())
    .addColumn("amount", "decimal(18, 6)", (col) => col.notNull())
    .addColumn("created_at", "timestamptz", (c) => c.notNull().defaultTo(Ky.sql`now()`))
    .execute();

  await db.schema.createIndex("transactions_account_id_idx").on("transactions").columns(["account_id"]).execute();

  /**
   If using PostgreSQL we can add the INCLUDE clause to the index: 
     CREATE INDEX transactions_account_id_idx ON transactions (account_id) INCLUDE (operation, amount);
     to achieve a index-only scan. 
  */
}

export async function down(db: Ky.Kysely<any>) {
  await db.schema.dropTable("transactions").execute();
}
