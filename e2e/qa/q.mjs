import * as L from "./lib.mjs";
console.log((await L.q(process.argv[2])).map((r) => JSON.stringify(r)).join("\n"));
await L.closeDb();
