
## The goal 

The primary goal is to design a system that: 
- Can be built in a short time.
- Can squeeze Node.js (libuv) I/O performance.
- Is optimized for database [DOD](https://en.wikipedia.org/wiki/Data-oriented_design)
- Is capable of handling a great number of TPS (Transactions Per Second).

Amazon handles ~12M TPD (Transactions Per Day), that's ~140 TPS. <br>
PayPal handles ~41M TPD, that would be around 474 TPS. <br>
Verifone claims one of their advanced PoS models (Omni 3750) can process a transaction within 3-4 seconds, that's ~1/3 TPS. <br>
Ethereum blockchain processes a new block every ~12 seconds; each block often averages ~180 transactions, that give us ~15 TPS. <br>

## The target

The ultimate goal is to reach a at least over 280 TPS (twice than Amazon avg).

The reason is that given our simplified business logic, almost 0ms network delay (localhost), 
and CPU (measuring in a Ryzen 7 9800X3D with 6200 MHz memory) so, cloud VPC will be slower and cloud
VPC also uses ECC RAM which is a bit slower if we were to compare a 1:1 CPU core to vCores.

By favoring a 'naive' architecture and making clever, informed decisions about the way we treat data, we can
outperform the 'best' architectural approach, while keeping simplicity.

This small project borrows inspiration from the book [Data Oriented Design for Games](https://www.manning.com/books/data-oriented-design-for-games).

## The strategy

We're going to utilize a 'anti-pattern' architecture (by Microservices purist), but that is simple enough to be implemented
in a couple of hours, and that does not require all the deployment and development hassle that comes with 'event-driven communication',
'protobuffers (gRPC)', 'N databases', and of course, the convulsed and pricey monitoring tools.

This is the 'Shared database', as we'll only feature two 'micro'-services, one for running our API (handling incoming transfer requests),
and one for processing all those transfers.

You can see a glance of the (anti)-pattern [here](https://microservices.io/patterns/data/shared-database.html).

For event handling, we're using the 'naive' 'pooling' approach, instead of using the recommended 'push' one.

But our services will meet two criteria:
- Be decoupled enough at schema level so we can migrate to a 'N-database' (1:1 database for each micro-service, rejoice purists!).
- Be as SQL compliant as possible to facilitate migration to even no-SQL databases.

### __Service 1. API Server__

This service features a single endpoint that has the task to: transfer money in/out of an account.

Responsibilities:
- Create pending events to represent a state request to be performance.
- Return the associated task id.
- [@] Conduct preliminary checks to off load some (not all) fraud detection mechanism and avoid spam attack saturation.

[@] = Not implemented, but an idea of an bigger systems.

Main Files:
- `./api-server.ts` (entry point)
- `./api-services.ts`
Check them for comments; there are plenty of explanations there!

### __Service 2. Ledger Worker__

Responsibilities:
- Process pending events and fill transactions for every successful event.
- [@] Conduct final checks for fraud detection.

[@] = Not implemented, but an idea of a bigger system.

Main Files:
- `./worker.ts` (entry point)
- `./worker-service.ts`
Check them for comments, there are plenty of explanations there!

### __Performance secrets__

1. Database Latency.
We NEED a database that is as close as possible for the API Server, this is not that imperative for the Ledger Worker, but quite critical
for the API to reach peak TPS.

Use the small utility `pnpm db-latency` to benchmark connection latency.

2. Insert abuse.
Both services are abusing of insert-only operations. Ever wonder why no-SQL (document) databases claim to be so fast at inserting
and replicating? Because of the few checks they need to do compared to traditional databases, often, in SQL databases you have: several indexes,
FK constraints, arbitrary checks, parametrized values, schema/type enforcement and coercing, and finally ACID handling.

We can get rid of the most problematic two (that also eases the transition to utilize 1:1 service to databases), but also
give us the capability of using other databases with a lot of flexibility; these two are: non-primary indexes and FK constraints.

With these considerations, our inserts will be blazingly fasts.

3. Batch queries as much as possible.

When inspecting the code, we can realize that we are carefully using 'UPDATE' statements,
our updates and inserts within the Ledger Worker are either performing one operation, or being sent off in a single batch.

Doing this, we can keep our transaction small and efficient. And here is the thing, by taking inspiration from [WAL](https://en.wikipedia.org/iki/Write-ahead_logging), instead of updating every time an account balance is affected, we can create a re-buildable record by recording
all transactions that modify our balance.

4. Efficient I/O.
As long as we delegate 'heavy' operations to a database (we can have many of them, and even specialized replicas), 
Node.js will be efficient in doing what it is intended to do, orchestrating.

Within the Ledger Worker, processing events in 200~500 batches gives us enough room to even run both the API Server and the Worker in the same
processing thread, this is to show how efficient our processing is.

## FAQs

### __Events should be processed in a single thread, since they should be processed in order, how it can scale it?__

We can divide our processing by allocating accounts/wallets/cards to a particular 'bucket', each bucket is essentially 
a processing queue that handles the event in order.

Money can be moved in four ways:
- Deposited: Coming from an external system.
- Withdrawn: Sent off to an external system.
- Transferred: Money stays in the same system but moves between accounts.
- Disbursed: A fan-out version of a transfer, money is transferred from a single account to others (external or internal).

A transfer is basically a withdrawal followed by a deposit (but treated as a single operation).

If account 'A' in in Bucket X, and account 'B' is in bucket 'Y', if B transfers to A, then we'll:
- Re-route the transfer request (API) to our worker that lies in bucket 'Y' (flow always will start in the bucket withdrawing money, this also work for disbursements). Here, we'll also conduct any fraud checks and such.
- Create traceable events within 'Y' that will be compensated (acknowledged) by 'X' or any other bucket receiving the money.
- 'X' and every other bucket involved, will have their respective 'deposit' transaction.

In this way, we don't incur in locks, and our system is made resilient and durable.

### __Why not directly updating each account balance after each operation?__

This provides few benefits beside performances.

1. As we update the balance directly from our transaction records, we won't face inconsistencies across the way
decimal precision is handled across systems; your database may be rounding up, down, or truncating, and if you don't replicate the
very same operation, with the very same precision, you'll incur into a discrepancy between the account balance and the transaction history.

2. We have only a single source of truth (the transaction history), if there is any misleading calculation involved in the update statement, you'll have a huge discrepancy that could compromise the system and the precision of any fraud check as well as potentially leaking assets.

### __Ok, what if we have a lot of transactions from a single account?__

If re-computing the account balance out of the transaction history turns out to be expensive for a hot account (like a master wallet/treasury), then, we can do it incrementally and calculate breakpoints.

Table breakpoints:
- id
- account_id
- amount_difference
- previous_balance
- current_balance
- transactions_start_id
- transactions_end_id
- created_at

Then the actual balance would be the latest breakpoint's balance, and we only need to add the balance from the 
range [transactions_end_id + 1 : last_transaction_for_the_account].

Since our transaction history is immutable, each breakpoint also is and will be a condensed view of all transactions aggregated.

## Running it

### __Step 1 - Configure environment__

Install packages, prefer using `pnpm` => `pnpm install`.

Either set system variables, or create an `.env` file at the root of this project.
```conf
DB_URI="postgresql://username:password@host:port/database_name"
SSM=false|true
```

`SSM` = Single Server Mode, which we could use to run only one instance (the API) and it will also function as the worker.

### __Step 2.1 - Running individual instances__

In separate processes: <br>
`pnpm start-api` <br>
`pnpm start-server` (only if `SSM=false`). <br>

### __Step 2.1 - Running using PM2__

Useful PM2 resources. <br>
[PM2 process management](https://pm2.keymetrics.io/docs/usage/process-management/) <br>
[PM2 log management](https://pm2.keymetrics.io/docs/usage/log-management/) <br>

Start/restart -> `npx pm2 start cluster.json`<br>
Stop -> `npx pm2 delete cluster.json` <br>
Clear logs -> `npx pm2 flush` <br>
List running -> `npx pm2 list` <br>
Tail logs -> `npx pm2 logs --lines 20 4`, where `4` represents the process id/name (given be the list command). <br>

### The results

Disclaimer: Your mileage may vary, depending on the machine you're using, database, and overall network.

My database is a dockerized instance of __TimescaleDB__, using `PostgreSQL 16.6 on x86_64-pc-linux-musl, compiled by gcc (Alpine 13.2.1_git20240309) 13.2.1 20240309, 64-bit`.

We're benchmarking and mass sending requests using [todo](bombardier)
With: `bombardier -t 10s -c 100 -n 200 -l -m POST localhost:7574/transfer/test`

__See local latency__
<br>
![db-latency](./results/database-latency.jpg).

__API__
- When using a single instance (+localhost database), my machine achieves ~700 TPS, with some peaks to ~800.
- When using a cluster mode (PM2, 4 instances), my machine achieves a peak of ~2900 TPS, That's 250M transactions per day on avg!
![api-cluster-mode](./results/api-cluster-tps.jpg)

__Ledger Worker__
Since the ledger worker only runs in one core (we cannot parallelize since we should process events => transactions in strict order).
But there are two modes, the first is running it separate from API (`SSM=false`), and with the API (`SSM=true`).
In this time, we're only running as well 1 instance of the API to receive the requests

With `SSM=false` and single API instance we're achieving for API ~890 TPS, and the worker was processing whole batches of 200 events at 10~13ms, that would be 15~20 TPms, that's a whopping 15K-20K TPS. (TPms = Transactions per millisecond).

With `SSM=true`, the thing does not change much, but consider is the same Node.js server (no clustering) receiving the events and processing it, and we slowed down the batch processing 7%~60%. But the API could still deliver up to ~730 TPS, and the worker 12.5 TPms at worst.

`SSM=false`
![worker-ssm-false](./results/worker-ssm-false.jpg)
`SSM=true`
![worker-ssm-false](./results/worker-ssm-true.jpg)

## The conclusion

With these numbers:
- 4-core cluster API capable of handling 2900 req/secs
- 1-core worker capable of processing up to 20K events per second.

We're well over our target of 280 TPS, which gives us enough room to have a more complicated cloud architecture, and business logic, as long
as we keep as most as we can these principles shared here.
