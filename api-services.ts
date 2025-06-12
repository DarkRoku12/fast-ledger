import DB from "./db-main";
import * as UUID from "uuid";

type InTransfer = {
  from: string; // Account ID to transfer from.
  type: "w" | "d"; // 'w' = withdraw | 'd' = deposit
  amount: string | number; // Amount to transfer.
};

/**
  Transfer money in/out of an account.
  - Check if the account exists, if not, create it with a random initial balance.
  - Insert the event into the `events` table with status 'p' (pending).
*/
export async function transfer(input: InTransfer) {
  const task_id = UUID.v4();

  const tx = await DB.startTransaction().execute();
  const account = await tx.selectFrom("accounts").where("id", "=", input.from).executeTakeFirst();
  const savepoint = await tx.savepoint("before_create_account").execute();

  // If the account does not exist, create it with a random initial balance.
  // This small check-n-create, simulates some business logic.
  if (!account) {
    const initial_balance = Math.random() * 1000; // Initialize with a random balance.

    /*
      We may use `ON CONFLICT` when using PostgreSQL.
      Alternatives for MariaDB and MySQL: ON DUPLICATE KEY
    */
    try {
      // Insert the account with the initial balance.
      await savepoint.insertInto("accounts").values({ id: input.from, balance: initial_balance }).execute();

      // Record the initial deposit in the transactions table.
      await savepoint
        .insertInto("transactions")
        .values({
          label: "id", // Initial deposit.
          operation: "d", // Deposit operation.
          created_at: new Date(),
          account_id: input.from,
          amount: initial_balance,
        })
        .execute();
    } catch (err) {
      // Can fail due to race condition.
      await savepoint.rollbackToSavepoint("before_create_account").execute();
    }
  }

  // Insert the event (and retrieve insert id, not implemented, but can be easily done in PG).
  await tx
    .insertInto("events")
    .values({
      task_id: task_id,
      status: "p", // pending.
      created_at: new Date(),
      account_id: input.from,
      operation: input.type,
      amount: input.amount,
    })
    .execute();

  // Commit the transaction.
  await savepoint.releaseSavepoint("before_create_account").execute();
  await tx.commit().execute();

  return { task_id };
}
