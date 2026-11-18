// A small MCP server that stands for Claude Code listed as a server (the meeting point of server, "Step 5: through the real
// thing"): two tools of its names, `Bash` (one argument, `command`) and `Read` (one argument, `file_path`). It runs
// nothing and reads nothing: `Bash` answers `ran`, `Read` answers `read`.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const tool = (name, argument) => ({
  name,
  description: `Stands for the tool ${name} of Claude Code. It does nothing.`,
  inputSchema: { type: "object", properties: { [argument]: { type: "string" } }, required: [argument] },
});

const server = new Server({ name: "fake-claude", version: "1.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [tool("Bash", "command"), tool("Read", "file_path")] }));
server.setRequestHandler(CallToolRequestSchema, async (request) => ({
  content: [{ type: "text", text: request.params.name === "Bash" ? "ran" : "read" }],
}));
await server.connect(new StdioServerTransport());
