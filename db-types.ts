import { Generated } from "kysely";

export type Decimal = string | number; // DECIMAL is represented as string in TypeScript.
export type Big = bigint | string | number; // BigInt is represented as string in TypeScript.

export type AccountsTable = {
  id: Generated<Big>;
  balance: Decimal; // DECIMAL is represented as string in TypeScript
};

export type EventsTable = {
  id: Generated<Big>;
  task_id: string; // UUID or similar.
  account_id: Big;
  /** 'w' = withdraw | 'd' = deposit */
  operation: "w" | "d";
  /** 'p' = pending | 'l' = locked | 's' = success | 'f' = failed */
  status: "p" | "l" | "s" | "f";
  amount: Decimal;
  created_at: Date;
};

export type TransactionsTable = {
  id: Generated<Big>;
  event_id?: Big; // Optional, can be null if not linked to an event.
  account_id: Big;
  /** 'w' = withdraw | 'd' = deposit */
  operation: "w" | "d";
  /** 'id' = initial deposit | 'et' = event transfer */
  label: "id" | "et";
  amount: Decimal;
  created_at: Date;
};

export type WorkersTable = {
  id: Generated<Big>;
  /** The event id to start processing from. */
  from_event_id: Big;
  created_at: Date;
  updated_at: Date;
};

export type Database = {
  accounts: AccountsTable;
  events: EventsTable;
  transactions: TransactionsTable;
  workers: WorkersTable;
};

export default Database;
