// Placeholder logger (options are Pino, Winston, etc.)
import _con from "console";

export default {
  info: (...args: any[]) => {
    _con.info(...args);
  },
  warn: (...args: any[]) => {
    _con.warn(...args);
  },
  error: (...args: any[]) => {
    _con.error(...args);
  },
  debug: (...args: any[]) => {
    if (process.env.DEBUG) {
      _con.debug(...args);
    }
  },
  log: (...args: any[]) => {
    _con.log(...args);
  },
};
