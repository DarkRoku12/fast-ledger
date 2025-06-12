import DB from "./db-main";
import * as KyCtl from "kysely-ctl";

const migrations_folder = "./migrations" as const;

export default KyCtl.defineConfig({
  kysely: DB,
  migrations: {
    allowJS: false,
    migrationFolder: migrations_folder,
    migrationTableSchema: "public",
    migrationTableName: "app_migrations",
    migrationLockTableName: "app_migrations_lock",
    allowUnorderedMigrations: true,
  },
});
