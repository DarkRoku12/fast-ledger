import "dotenv-flow/config";
import * as Zod from "zod";
import * as Hono from "hono";
import * as HonoServer from "@hono/node-server";
import * as HonoFactory from "hono/factory";
import * as HonoZod from "@hono/zod-validator";
import * as Services from "./api-services";
import * as Worker from "./worker-services";
import D from "./decimal";
import Logger from "./logger";

const App = new Hono.Hono();

const MiddlewareLogger = HonoFactory.createMiddleware(async (c, next) => {
  const now = Date.now();
  Logger.log(`[in] ${c.req.method} -> ${c.req.url}`);
  await next();
  const duration = Date.now() - now;
  Logger.log(`[out] ${c.req.method} -> ${c.req.url}`, { duration });
});

const InTransferSchema = Zod.object({
  from: Zod.number(),
  amount: Zod.coerce.string().refine((val) => D.ValidOr(val, 0).greaterThan(0), "amount must be positive"),
  type: Zod.enum(["withdraw", "deposit"]).transform((v) => v[0] as "w" | "d"),
});

App.get("/health", MiddlewareLogger, async (c) => {
  return c.json({ status: "ok" });
});

/**
 Transfer money in/out of an account.
 - Inserts do not block (lock table rows).
 - The events table is used to track the status transfer operations.
   It can implement some non-authoritative checks, like checking the likeness of having 'enough balance' (probably cached),
   or perhaps checking different parameters to determine if the transfer is legit (no fraudulent, or a potential double-spending).
   This check can at max set the initial state to 'failed (f)', else it will be set to 'pending (p)'. 
   The final status will be determined by a background worker that will process the events table.
 - This also offloads some of the responsibility of fraud detection, by running quick, preliminary checks, then final ones within the background worker.
 - It is not imperative to use PostgreSQL (or any relational database), we may use in-memory or non-SQL that works great with sharding/geo-distribution.
*/
App.post("/transfer", MiddlewareLogger, HonoZod.zValidator("json", InTransferSchema), async (c) => {
  const body = c.req.valid("json");
  const result = await Services.transfer({
    from: String(body.from), // Convert to string if needed.
    type: body.type,
    amount: body.amount,
  });
  return c.json(result);
});

/**
 * See transfer endpoint (uses the same underlying service).
 * This is a test endpoint that fills with random values, useful for testing with HTTP benchmarking/load testing tools.
 */
App.post("/transfer/test", MiddlewareLogger, async (c) => {
  const result = await Services.transfer({
    from: String(1 + (Math.floor(Math.random() * 1000) % 30)), // Random account ID. (low number to guarantee targeting existing accounts, useful to test 'locking' scenarios).
    type: Math.random() > 0.5 ? "w" : "d", // Random operation type.
    amount: 1 + Math.random() * 25, // Random amount between 1 and 26.
  });
  return c.json(result);
});

App.onError((err, c) => {
  Logger.error("[api-error]", { error: err });
  return c.json({ error: "Internal Server Error" }, 500);
});

HonoServer.serve(
  {
    fetch: App.fetch,
    port: 7574,
  },
  (info) => {
    Logger.log(`Server is listening on http://localhost:${info.port}`);

    /// Run in Single Server Mode (SSM) if configured.
    if ((process.env.SSM || "").trim().toLowerCase() == "true") {
      Logger.log("[worker] Running in Single Server Mode (SSM)");
      Logger.log("[worker] Starting worker (SSM)");
      Worker.start_worker_task();
    }
  },
);
