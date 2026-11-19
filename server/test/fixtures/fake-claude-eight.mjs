// A small MCP server that stands for Claude Code started as `claude mcp serve` (the meeting point of server, "Step 11, through the
// real thing"): eight tools in the order Agent, Bash, Glob, Grep, Read, Edit, Write, WebFetch, each answering `<its name> ran`.
// It refuses to start unless its arguments are exactly `mcp serve`.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "mcp" || args[1] !== "serve") {
  process.stderr.write("stand-in claude: only mcp serve\n");
  process.exit(1);
}

const ARGUMENT = { Bash: "command", Read: "file_path", Edit: "file_path", Write: "file_path", Grep: "pattern", Glob: "pattern" };
const NAMES = ["Agent", "Bash", "Glob", "Grep", "Read", "Edit", "Write", "WebFetch"];
const tool = (name) => ({
  name,
  description: `Stands for the tool ${name} of Claude Code. It does nothing.`,
  inputSchema: { type: "object", properties: { [ARGUMENT[name] ?? "input"]: { type: "string" } } },
});

const server = new Server({ name: "fake-claude", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: NAMES.map(tool) }));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: "text", text: `${request.params.name} ran` }],
}));
await server.connect(new StdioServerTransport());
