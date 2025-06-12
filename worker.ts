import "dotenv-flow/config";
import * as Worker from "./worker-services";
import Logger from "./logger";

if ((process.env.SSM || "").trim().toLowerCase() != "true") {
  Logger.log("[worker] Starting worker");
  Worker.start_worker_task();
} else {
  const msg =
    "[worker] Single Server Mode (SSM) is enabled, worker will start in the same server as the API." +
    " \nOr disable SSM (.env) to start the worker separately.";
  Logger.log(msg);
}
