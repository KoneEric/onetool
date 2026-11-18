// Run as a child process by hygiene.test.js: sign in again and again until a signal ends the process.
import { login } from "../src/index.js";

const { url, home } = JSON.parse(process.argv[2]);
const browser = (address) => {
  fetch(address).then((r) => r.arrayBuffer(), () => {});
};

let rounds = 0;
for (;;) {
  const r = await login({ name: "far", url }, { home, waitSeconds: 10, say: browser });
  if (!r.ok) process.exit(3);
  if (++rounds === 1) process.send("ready");
}
