import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Honcho } from "@honcho-ai/sdk";
import { loadConfig, getHonchoClientOptions, getSessionName, detectHost, setDetectedHost } from "../config.js";

const SETUP_MESSAGE = `Honcho is not configured. To enable persistent memory:

1. Get a free API key at https://app.honcho.dev
2. Add to your shell config (~/.zshrc or ~/.bashrc):
   export HONCHO_API_KEY="your-key-here"
3. Restart your editor

Or run /honcho:setup for guided configuration.`;

export async function runMcpServer(): Promise<void> {
  // Detect host from environment: Cursor sets CURSOR_PROJECT_DIR
  const host = process.env.CURSOR_PROJECT_DIR ? "cursor" : "claude-code";
  setDetectedHost(host);
  const config = loadConfig();
  const configured = config !== null;

  const server = new Server(
    {
      name: "honcho",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const honcho = configured ? new Honcho(getHonchoClientOptions(config)) : null;

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: "search",
          description: "Search across messages in the current Honcho session using semantic search",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Search query",
              },
              limit: {
                type: "number",
                description: "Max results (1-50)",
                default: 10,
              },
            },
            required: ["query"],
          },
        },
        {
          name: "chat",
          description: "Query Honcho's knowledge about the user using dialectic reasoning",
          inputSchema: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "Natural language question about the user",
              },
            },
            required: ["query"],
          },
        },
        {
          name: "create_conclusion",
          description: "Save a key insight or biographical detail about the user to Honcho's memory",
          inputSchema: {
            type: "object",
            properties: {
              content: {
                type: "string",
                description: "The insight or fact to remember",
              },
            },
            required: ["content"],
          },
        },
      ],
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (!honcho || !config) {
      return {
        content: [{ type: "text", text: SETUP_MESSAGE }],
        isError: true,
      };
    }

    const { name, arguments: args } = request.params;
    const cwd = process.env.CURSOR_PROJECT_DIR || process.cwd();
    const sessionName = getSessionName(cwd);

    try {
      const session = await honcho.session(sessionName);

      switch (name) {
        case "search": {
          const query = args?.query as string;
          const limit = (args?.limit as number) ?? 10;
          const messages = await session.search(query, { limit });
          const results = messages.map((msg: any) => ({
            content: msg.content,
            peerId: msg.peer,
            createdAt: msg.createdAt || msg.created_at,
          }));
          return {
            content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
          };
        }

        case "chat": {
          const query = args?.query as string;
          const userPeer = await honcho.peer(config.peerName);
          const response = await userPeer.chat(query, {
            session,
            reasoningLevel: "medium",
          });
          return {
            content: [{ type: "text", text: response ?? "No response from Honcho" }],
          };
        }

        case "create_conclusion": {
          const content = args?.content as string;
          const userPeer = await honcho.peer(config.peerName);
          const conclusions = await userPeer.conclusions.create({
            content,
            sessionId: session.id,
          });
          return {
            content: [{ type: "text", text: `Saved conclusion: ${conclusions[0]?.content || content}` }],
          };
        }

        default:
          return {
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    } catch (error) {
      return {
        content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
