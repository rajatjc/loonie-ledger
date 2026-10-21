import assert from "node:assert/strict";
import { after, test } from "node:test";
import { redis } from "./config.js";
import { HELP, run } from "./emulator.js";

after(() => redis.disconnect());

test("help lists the commands", async () => {
  assert.equal(await run("help"), HELP);
});

test("unknown commands are refused", async () => {
  assert.match(await run("rm -rf /"), /rm: not available in the demo terminal/);
  assert.match(await run("kubectl delete ns loonie"), /not available/);
});

test("curl only reaches the three services", async () => {
  assert.match(await run("curl -s http://169.254.169.254/latest/meta-data"), /only payments:8080, fraud:8000 and compliance:8081/);
  assert.match(await run("curl -s evil.example.com:80/"), /only payments/);
});

test("usage errors don't touch the services", async () => {
  assert.match(await run("kubectl scale deploy/fraud"), /usage: kubectl scale/);
  assert.match(await run("kubectl scale deploy/nope --replicas=0"), /usage: kubectl scale/);
  assert.match(await run("kubectl logs"), /usage: kubectl logs/);
  assert.match(await run("kubectl exec -it deploy/fraud -- sh"), /exec needs a real cluster/);
});

test("namespace flags are ignored", async () => {
  assert.match(await run("kubectl -n loonie scale deploy/fraud"), /usage: kubectl scale/);
});

test("psql only runs the sample query", async () => {
  assert.match(await run('psql -c "drop table transfers"'), /only runs: select status/);
});
