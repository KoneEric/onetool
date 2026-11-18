// Runs programs of every kind. The caller itself writes nothing: the test expects empty output.
import { runProgram } from "../../src/index.js";

const tools = { s: ["t"] };
const callTool = async (server, tool, args) => (args.fail ? Promise.reject(new Error("tool failed")) : { ok: 1 });

await runProgram('console.log("a"); console.error("b"); console.warn("c"); console.info("d"); console.debug("e"); 1');
await runProgram('console.log("x"); throw new Error("boom")');
await runProgram("let = = 1");
await runProgram("await tools.s.t({})", { tools, callTool });
await runProgram("await tools.s.t({ fail: true })", { tools, callTool });
await runProgram("while (true) {}", { timeoutMs: 200 });
await runProgram('console.log("before"); await new Promise(() => {})', { timeoutMs: 200 });
await runProgram("const a = []; while (true) a.push(new Array(100000).fill(1))", { memoryMb: 16, timeoutMs: 30000 });
await runProgram('await import("node:fs")');
await runProgram("return 1n");
