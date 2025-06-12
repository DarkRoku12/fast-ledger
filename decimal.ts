import Decimal from "decimal.js";
import _con from "console";

export type AnyNumber = number | Decimal;

declare interface IDecimal {
  (n: number | string): Decimal;
  div(a: AnyNumber, b: AnyNumber): Decimal;
  inv(a: AnyNumber): Decimal;
  mul(...args: AnyNumber[]): Decimal;
  minus(...args: AnyNumber[]): Decimal;
  plus(...args: AnyNumber[]): Decimal;
  B(n: BigInt): Decimal;
  Any(n: any): Decimal;
  ValidOr(n: any, def: number | string): Decimal;
  lib: typeof Decimal;
}

function callable(n: number) {
  return new Decimal(n);
}

callable.lib = Decimal;

callable.B = (n: BigInt) => new Decimal(n.toString());

callable.Any = (n: any) => new Decimal(String(n));

callable.ValidOr = (n: any, def: number | string) => {
  const valid = !isNaN(Number(n)) && isFinite(n);
  return valid ? new Decimal(n) : new Decimal(def);
};

callable.div = function (a: AnyNumber, b: AnyNumber) {
  return new Decimal(a).div(b);
};

callable.inv = function (a: AnyNumber) {
  return new Decimal(1).div(a);
};

callable.mul = function (...args: AnyNumber[]) {
  return (args as Decimal[]).reduce((a, b) => a.mul(b), new Decimal(1));
};

callable.minus = function (...args: AnyNumber[]) {
  let n = args[0];
  for (let i = 1; i < args.length; i++) n = new Decimal(n).minus(args[i]);
  return n;
};

callable.plus = function (...args: AnyNumber[]) {
  let n = args[0];
  for (let i = 1; i < args.length; i++) n = new Decimal(n).plus(args[i]);
  return n;
};

declare module "decimal.js" {
  export interface Decimal {
    toValue(decimals?: number): number;
    print(): Decimal;
  }
}

Decimal.prototype.toValue = function (decimals: number = 2) {
  return this.toDecimalPlaces(decimals, Decimal.ROUND_DOWN).toNumber();
};

Decimal.prototype.print = function () {
  _con.log(this);
  return this;
};

export default callable as IDecimal;
