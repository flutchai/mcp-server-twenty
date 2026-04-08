import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { TwentyClient } from "./twenty-client.js";
import { buildPeopleTools } from "./tools/index.js";
import type { ToolDefinition } from "./types.js";

class TwentyMcpServer {
  private server: Server;
  private client!: TwentyClient;
  private tools: ToolDefinition[] = [];
  private toolMap: Map<string, ToolDefinition> = new Map();

  constructor() {
    this.server = new Server(
      { name: "mcp-server-twenty", version: "0.1.0" },
      { capabilities: { tools: {} } },
    );

    this.server.onerror = (error) => console.error("[Twenty MCP Error]", error);
    process.on("SIGINT", async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: this.tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;
      const tool = this.toolMap.get(name);

      if (!tool) {
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
      }

      try {
        const result = await tool.handler(this.client, args);
        return { content: [{ type: "text", text: result }], isError: false };
      } catch (error: any) {
        if (error instanceof McpError) throw error;

        const status = error?.response?.status;
        if (status === 401) {
          throw new McpError(
            ErrorCode.InvalidRequest,
            "Twenty API key is invalid or expired.",
          );
        }

        throw new McpError(ErrorCode.InternalError, `Twenty API error: ${error.message}`);
      }
    });
  }

  async run(): Promise<void> {
    const { apiKey, baseUrl } = TwentyClient.resolveCredentials();
    this.client = new TwentyClient(apiKey, baseUrl);

    // Build tools — introspects Person schema to discover custom fields
    this.tools = await buildPeopleTools(this.client);
    this.toolMap = new Map(this.tools.map((t) => [t.name, t]));

    this.setupHandlers();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error(
      `Twenty MCP Server running (${this.tools.length} tools, ${this.client["personSchema"]?.customFieldNames?.length ?? 0} custom fields)`,
    );
  }
}

const server = new TwentyMcpServer();
server.run().catch((err) => {
  console.error("Failed to start Twenty MCP Server:", err);
  process.exit(1);
});
