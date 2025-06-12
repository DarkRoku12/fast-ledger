import D from "./decimal";
import DB from "./db-main";
import Logger from "./logger";
import * as Schema from "./db-types"; // Adjust the import based on your actual DB schema type.
import * as Ky from "kysely";

type InProcessEventBatch = {
  /** Start processing from this event Id (inclusive) */
  from_event_id: bigint | string | number;
  /** End processing at this `from_event_id + batch_size - 1` (inclusive) */
  batch_size: number;
};

/**
  Transfer money in/out of an account.
  - Check if the account exists, if not, create it with a random initial balance.
  - Insert the event into the `events` table with status 'p' (pending).
  - Returns the number of processed events.
*/
export async function process_event_batch(input: InProcessEventBatch) {
  const range_start = input.from_event_id;
  const range_end = D.Any(input.from_event_id).add(input.batch_size).minus(1).toFixed();

  Logger.log("[process_event_batch] Processing started with", {
    range_start,
    range_end,
    batch_size: input.batch_size,
  });

  /// Read events and balances from the database.
  const read = await DB.transaction().execute(async (tx) => {
    const [events, evt_accounts_ids] = await Promise.all([
      tx
        .selectFrom("events")
        .selectAll()
        .where((w) => w.between("id", range_start, range_end))
        .where("status", "=", "p") // Only pending events.
        .orderBy("account_id", "asc")
        .orderBy("id", "asc")
        .execute(),
      tx
        .selectFrom("events")
        .select("account_id")
        .distinct()
        .where((w) => w.between("id", range_start, range_end))
        .where("status", "=", "p") // Only pending events.
        .execute(),
    ]);

    const accounts_ids = evt_accounts_ids.map((a) => a.account_id);
    const accounts = accounts_ids.length
      ? await tx.selectFrom("accounts").selectAll().where("id", "in", accounts_ids).execute()
      : [];

    /**
        We are able to pull both [account id, account balance] in one go by joining.
        But to do so the events table must be in the same database instance as the accounts table.
        Not compatible with having a different database for events and accounts.

        ```sql
          WITH account_ids AS (
            SELECT DISTINCT account_id FROM events WHERE id BETWEEN 0 AND 100
          )
          SELECT accounts.* FROM account_ids aids
          INNER JOIN accounts ON accounts.id = aids.account_id
        ``` 
      */

    return { events, accounts_ids, accounts };
  });

  if (read.events.length == 0) {
    Logger.log("[process_event_batch] No events found in the specified range", { range_start, range_end });
    return 0;
  }

  const accounts_map = new Map(read.accounts.map((a) => [a.id, a.balance]));

  const push_failed_events: Schema.Big[] = [];
  const push_success_events: Schema.Big[] = [];
  const push_transactions: Ky.Insertable<Schema.Database["transactions"]>[] = [];

  for (const event of read.events) {
    const account_balance = D.Any(accounts_map.get(event.account_id) ?? 0);

    // Withdrawal flow.
    if (event.operation == "w") {
      // Not enough balance.
      if (account_balance.lessThan(event.amount)) {
        push_failed_events.push(event.id);
        continue;
      }
      // Enough balance, proceed with the withdrawal.
      else {
        push_success_events.push(event.id);
        push_transactions.push({
          label: "et", // Event transfer.
          created_at: new Date(),
          amount: D.Any(event.amount).abs().neg().toFixed(),
          event_id: event.id, // Link the transaction to the event.
          account_id: event.account_id,
          operation: event.operation,
        });
      }
    }
    // Deposit flow (always succeeds).
    else if (event.operation == "d") {
      push_success_events.push(event.id);
      push_transactions.push({
        label: "et", // Event transfer.
        amount: D.Any(event.amount).abs().toFixed(),
        created_at: new Date(),
        event_id: event.id, // Link the transaction to the event.
        account_id: event.account_id,
        operation: event.operation,
      });
    }
    // Invalid operation type.
    else {
      Logger.error("[process_event_batch] Invalid operation type", { event_id: event.id, operation: event.operation });
      push_failed_events.push(event.id);
      continue;
    }
  }

  /// Update balances from the transactions history.
  const write = await DB.transaction().execute(async (tx) => {
    // Update failed events to 'f' (failed).
    if (push_failed_events.length) {
      await tx
        .updateTable("events")
        .set({ status: "f" }) // failed.
        .where("id", "in", push_failed_events)
        .where("status", "=", "p") // Only update pending events.
        .execute();
    }

    // Update successful events to 's' (success).
    if (push_success_events.length) {
      await tx
        .updateTable("events")
        .set({ status: "s" }) // success.
        .where("id", "in", push_success_events)
        .where("status", "=", "p") // Only update pending events.
        .execute();
    }

    // Insert transactions.
    if (push_transactions.length) {
      await tx.insertInto("transactions").values(push_transactions).execute();
    }

    // Calculate balances.
    const balances = await tx
      .selectFrom("transactions")
      .select("account_id")
      .select((s) => s.fn.sum("amount").as("balance"))
      .where("account_id", "in", read.accounts_ids)
      .groupBy("account_id")
      .execute();

    // Update balances.
    if (balances.length) {
      const updates = balances.map((b) => /*SQL*/ `UPDATE accounts SET balance = ${b.balance} WHERE id = ${b.account_id}`);
      const updates_batched = updates.join(";\n") + ";";
      await DB.executeQuery(Ky.CompiledQuery.raw(updates_batched));
    }
  });

  return read.events.length;
}

const worker_state = { idle: false };

/**
  Starts a 'worker' to process events in batches.
  - Ensure only one worker is processing a given row at a time.
  - Create a new worker (record) if it doesn't exist.
  - Update the worker's `from_event_id` after processing.
*/
export async function process_from_worker() {
  const worker_id = "worker-1"; // Example worker ID.
  const batch_size = 200; // Example batch size.
  const starting_event_id = 1; // Starting event ID for the worker.

  const result = await DB.transaction().execute(async (tx) => {
    const now = Date.now();
    // For update needed to ensure only one worker is processing such row at a given time.
    let worker = await tx.selectFrom("workers").forUpdate().selectAll().where("id", "=", worker_id).executeTakeFirst();

    if (!worker) {
      // Create a new worker if it doesn't exist.
      worker = await tx
        .insertInto("workers")
        .values({ id: worker_id, from_event_id: starting_event_id, created_at: new Date(), updated_at: new Date() })
        .returningAll()
        .executeTakeFirst();

      if (!worker) {
        Logger.error("[process_from_worker] Failed to create worker", { worker_id });
        throw new Error("WORKER_CREATION_FAILED");
      }
    }

    const last_event = await tx.selectFrom("events").select("id").orderBy("id", "desc").limit(1).executeTakeFirst();
    const last_event_id = D.Any(last_event ? last_event.id : starting_event_id);

    if (!last_event || last_event_id.lessThan(worker.from_event_id as any)) {
      if (!worker_state.idle) {
        worker_state.idle = true;
        Logger.log("[process_from_worker] IDLE", { worker_id, from_event_id: worker.from_event_id });
      }
      return { worker_id, from_event_id: worker.from_event_id, batch_size };
    } else {
      if (worker_state.idle) {
        worker_state.idle = false;
        Logger.log("[process_from_worker] Worker resumed", { worker_id, from_event_id: worker.from_event_id });
      }
    }

    // Execute the batch processing.
    await process_event_batch({
      from_event_id: worker.from_event_id,
      batch_size: batch_size,
    });

    // Update the worker parameters.
    const from_event_id_max = D.Any(worker.from_event_id).add(batch_size);
    const from_event_id_min = D.Any(last_event_id).add(1);

    await tx
      .updateTable("workers")
      .set({
        from_event_id: D.lib.min(from_event_id_min, from_event_id_max).toFixed(),
        updated_at: new Date(),
      })
      .execute();

    const ret = { worker_id, from_event_id: worker.from_event_id, batch_size, time: Date.now() - now };
    Logger.log("[process_from_worker] Worker processed", ret);
    return ret;
  });
}

/** [Utility] In case we like to reset the database tables. */
export async function reset_db() {
  const reset_query = Ky.sql`
    TRUNCATE TABLE accounts RESTART IDENTITY CASCADE;
    TRUNCATE TABLE events RESTART IDENTITY CASCADE;
    TRUNCATE TABLE transactions RESTART IDENTITY CASCADE;
    TRUNCATE TABLE workers RESTART IDENTITY CASCADE;
  `;

  const now = Date.now();
  await reset_query.execute(DB);
  Logger.log("[reset_db] Database reset completed", { time: Date.now() - now });
  return true;
}

/** [Utility] Log database latency. */
export async function log_db_latency() {
  for (let i = 0; i < 5; i++) {
    const now = Date.now();
    const query = Ky.sql`SELECT 1`; // Simple query to measure latency.
    const result = await query.execute(DB);
    const took = Date.now() - now;
    Logger.log("[log_db_latency]", { iteration: String(i).padStart(2, "0"), time: `${took} ms` });
  }
}

/** [Utility] Event pooler. */
export function start_worker_task() {
  const SSM = (process.env.SSM || "").trim().toLowerCase() == "true"; // Single Server Mode (SSM).
  const cool_down_timer = SSM ? 40 : 20; // Cool down timer in milliseconds.
  process_from_worker().then(() => {
    setTimeout(() => {
      start_worker_task();
    }, cool_down_timer); // Allow some time to 'cool down' before the next batch. (run GC, other operations, etc.)
  });
}
