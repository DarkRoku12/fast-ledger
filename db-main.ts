import * as Ky from "kysely";
import * as Pg from "pg";
import Logger from "./logger";
import DBType from "./db-types";

const DB_URI = process.env.DB_URI!;
const DB_LOG = (process.env.DB_LOG || "").toLowerCase().trim() == "true";

if (!DB_URI) {
  Logger.error("[DB]: DB_URI is not set. Please set the DB_URI environment variable.");
  process.exit(1);
}

export const DB = new Ky.Kysely<DBType>({
  log: DB_LOG ? ["query", "error"] : ["error"],
  dialect: new Ky.PostgresDialect({
    pool: new Pg.Pool({
      connectionString: DB_URI,
      max: 4,
      ssl: false,
    }),
  }),
});

Logger.info("[DB]: Connecting to", { uri: `${DB_URI!.match(/@.*/g)![0]}`, log: DB_LOG });

export default DB;
