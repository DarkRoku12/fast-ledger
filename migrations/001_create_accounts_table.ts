import * as Ky from "kysely";

export async function up(db: Ky.Kysely<any>): Promise<void> {
  await db.schema
    .createTable("accounts")
    .addColumn("id", "bigint", (col) => col.generatedByDefaultAsIdentity().primaryKey())
    .addColumn("balance", "decimal(18, 6)", (col) => col.notNull().defaultTo("0"))
    .execute();

  /**
    Notes:
      [balance]
        For Crypto handling, I'd recommend DECIMAL(28,12)
  */
}

export async function down(db: Ky.Kysely<any>): Promise<void> {
  await db.schema.dropTable("accounts").execute();
}
