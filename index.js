import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import http from "http";

const TRELLO_KEY = process.env.TRELLO_KEY;
const TRELLO_TOKEN = process.env.TRELLO_TOKEN;
const BASE = "https://api.trello.com/1";
const PORT = process.env.PORT || 3000;

if (!TRELLO_KEY || !TRELLO_TOKEN) {
  console.error("Erro: TRELLO_KEY e TRELLO_TOKEN precisam estar definidos.");
  process.exit(1);
}

async function trello(path, method = "GET") {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${BASE}${path}${sep}key=${TRELLO_KEY}&token=${TRELLO_TOKEN}`;
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" } });
  if (!res.ok) throw new Error(`Trello error ${res.status}: ${await res.text()}`);
  return res.json();
}

function createServer() {
  const server = new McpServer({ name: "trello-mcp", version: "1.0.0" });

  server.tool("trello_get_boards", "Lista todos os boards do usuário no Trello", {}, async () => {
    const boards = await trello("/members/me/boards?fields=id,name,desc,url,closed");
    const active = boards.filter(b => !b.closed).map(b => ({ id: b.id, name: b.name, desc: b.desc, url: b.url }));
    return { content: [{ type: "text", text: JSON.stringify(active, null, 2) }] };
  });

  server.tool("trello_get_lists", "Lista todas as listas de um board", { board_id: z.string() }, async ({ board_id }) => {
    const lists = await trello(`/boards/${board_id}/lists?fields=id,name,pos`);
    return { content: [{ type: "text", text: JSON.stringify(lists, null, 2) }] };
  });

  server.tool("trello_get_cards", "Lista cards de um board ou lista", { board_id: z.string().optional(), list_id: z.string().optional() }, async ({ board_id, list_id }) => {
    const cards = list_id
      ? await trello(`/lists/${list_id}/cards?fields=id,name,desc,due,url,idList`)
      : await trello(`/boards/${board_id}/cards?fields=id,name,desc,due,url,idList`);
    return { content: [{ type: "text", text: JSON.stringify(cards, null, 2) }] };
  });

  server.tool("trello_create_card", "Cria um card em uma lista", { list_id: z.string(), name: z.string(), desc: z.string().optional() }, async ({ list_id, name, desc }) => {
    const p = new URLSearchParams({ idList: list_id, name });
    if (desc) p.set("desc", desc);
    const card = await trello(`/cards?${p}`, "POST");
    return { content: [{ type: "text", text: JSON.stringify(card, null, 2) }] };
  });

  server.tool("trello_update_card", "Atualiza um card existente", { card_id: z.string(), name: z.string().optional(), desc: z.string().optional(), list_id: z.string().optional() }, async ({ card_id, ...fields }) => {
    const p = new URLSearchParams(Object.fromEntries(Object.entries(fields).filter(([,v]) => v !== undefined)));
    const card = await trello(`/cards/${card_id}?${p}`, "PUT");
    return { content: [{ type: "text", text: JSON.stringify(card, null, 2) }] };
  });

  server.tool("trello_get_card_details", "Detalhes completos de um card", { card_id: z.string() }, async ({ card_id }) => {
    const [card, checklists, comments] = await Promise.all([
      trello(`/cards/${card_id}`),
      trello(`/cards/${card_id}/checklists`),
      trello(`/cards/${card_id}/actions?filter=commentCard`)
    ]);
    return { content: [{ type: "text", text: JSON.stringify({ ...card, checklists, comments }, null, 2) }] };
  });

  server.tool("trello_add_comment", "Adiciona comentário a um card", { card_id: z.string(), text: z.string() }, async ({ card_id, text }) => {
    const result = await trello(`/cards/${card_id}/actions/comments?text=${encodeURIComponent(text)}`, "POST");
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  return server;
}

const httpServer = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id, Last-Event-Id");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method === "GET" && req.url === "/") { res.writeHead(200); res.end("Trello MCP Server running!"); return; }

  if (req.url === "/mcp") {
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = createServer();
    await server.connect(transport);
    await transport.handleRequest(req, res);
    return;
  }

  res.writeHead(404); res.end("Not found");
});

httpServer.listen(PORT, () => console.log(`Trello MCP rodando na porta ${PORT}`));
