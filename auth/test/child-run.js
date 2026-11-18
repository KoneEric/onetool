// Run as a child process by hygiene.test.js: points 2 to 5 of the run through the real thing.
// Its results go to the parent over the channel; what it writes to standard output or standard error is what the test inspects.
import fs from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { login, quietProvider, signInStamp, authFile } from "../src/index.js";

const { plain, short, home } = JSON.parse(process.argv[2]);
const browser = (address) => {
  fetch(address).then((r) => r.arrayBuffer(), () => {});
};

async function count(url, provider, before) {
  const client = new Client({ name: "child", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url), { authProvider: provider }));
  try {
    await before?.();
    const r = await client.callTool({ name: "count", arguments: { city: "Lyon" } });
    return r.content[0].text;
  } finally {
    await client.close().catch(() => {});
  }
}

const out = {};
try {
  out.login = await login({ name: "far", url: plain }, { home, waitSeconds: 10, say: browser });
  out.count = await count(plain, quietProvider("far", plain, { home }));

  out.loginShort = await login({ name: "far", url: short }, { home, waitSeconds: 10, say: browser });
  const stamp = signInStamp("far", short, { home });
  out.countAfterExpiry = await count(short, quietProvider("far", short, { home }), () => new Promise((r) => setTimeout(r, 1500)));
  out.stampChanged = signInStamp("far", short, { home }) !== stamp;

  await fetch(`${new URL(short).origin}/forget`, { method: "POST" }).then((r) => r.arrayBuffer());
  try {
    await count(short, quietProvider("far", short, { home }));
    out.afterForget = "answered";
  } catch (e) {
    out.afterForget = e instanceof UnauthorizedError || e?.code === 401 ? "401" : "other";
  }
  out.stampAfterForget = signInStamp("far", short, { home });
  out.fileKept = fs.existsSync(authFile("far", { home }));
} catch (e) {
  out.failed = String(e?.stack ?? e);
}
process.send(out);
