import "dotenv-flow/config";
import * as Worker from "./worker-services";
import DB from "./db-main";

Worker.log_db_latency().then(() => DB.destroy());
