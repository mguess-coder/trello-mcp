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

const TOOLS = [
  { name: "trello_get_boards", description: "Lista todos os boards do usuário no Trello", inputSchema: { type: "object", properties: {} } },
  { name: "trello_get_lists", description: "Lista todas as listas de um board", inputSchema: { type: "object", properties: { board_id: { type: "string", description: "ID do board" } }, required: ["board_id"] } },
  { name: "trello_get_cards", description: "Lista cards de um board ou lista", inputSchema: { type: "object", properties: { board_id: { type: "string" }, list_id: { type: "string" } } } },
  { name: "trello_create_card", description: "Cria um card em uma lista", inputSchema: { type: "object", properties: { list_id: { type: "string" }, name: { type: "string" }, desc: { type: "string" } }, required: ["list_id", "name"] } },
  { name: "trello_update_card", description: "Atualiza um card existente", inputSchema: { type: "object", properties: { card_id: { type: "string" }, name: { type: "string" }, desc: { type: "string" }, list_id: { type: "string" } }, required: ["card_id"] } },
  { name: "trello_get_card_details", description: "Detalhes completos de um card", inputSchema: { type: "object", properties: { card_id: { type: "string" } }, required: ["card_id"] } },
  { name: "trello_add_comment", description: "Adiciona comentário a um card", inputSchema: { type: "object", properties: { card_id: { type: "string" }, text: { type: "string" } }, required: ["card_id", "text"] } }
];

async function handleTool(name, args) {
  switch (name) {
    case "trello_get_boards": {
      const boards = await trello("/members/me/boards?fields=id,name,desc,url,closed");
      return boards.filter(b => !b.closed).map(b => ({ id: b.id, name: b.name, desc: b.desc, url: b.url }));
    }
    case "trello_get_lists": return await trello(`/boards/${args.board_id}/lists?fields=id,name,pos`);
    case "trello_get_cards":
      if (args.list_id) return await trello(`/lists/${args.list_id}/cards?fields=id,name,desc,due,url,idList`);
      return await trello(`/boards/${args.board_id}/cards?fields=id,name,desc,due,url,idList`);
    case "trello_create_card": {
      const p = new URLSearchParams({ idList: args.list_id, name: args.name });
      if (args.desc) p.set("desc", args.desc);
      return await trello(`/cards?${p}`, "POST");
    }
    case "trello_update_card": {
      const { card_id, ...fields } = args;
      return await trello(`/cards/${card_id}?${new URLSearchParams(fields)}`, "PUT");
    }
    case "trello_get_card_details": {
      const [card, checklists, comments] = await Promise.all([
        trello(`/cards/${args.card_id}`),
        trello(`/cards/${args.card_id}/checklists`),
        trello(`/cards/${args.card_id}/actions?filter=commentCard`)
      ]);
      return { ...card, checklists, comments };
    }
    case "trello_add_comment":
      return await trello(`/cards/${args.card_id}/actions/comments?text=${encodeURIComponent(args.text)}`, "POST");
    default: throw new Error(`Tool desconhecida: ${name}`);
  }
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept, Mcp-Session-Id");

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }
  if (req.method === "GET" && req.url === "/") { res.writeHead(200); res.end("Trello MCP Server running!"); return; }

  if (req.url === "/mcp") {
    if (req.method === "POST") {
      let body = "";
      req.on("data", chunk => body += chunk);
      req.on("end", async () => {
        try {
          const msg = JSON.parse(body);
          const msgs = Array.isArray(msg) ? msg : [msg];
          const responses = [];

          for (const { id, method, params } of msgs) {
            let result;
            if (method === "initialize") {
              result = { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "trello-mcp", version: "1.0.0" } };
            } else if (method === "notifications/initialized" || method === "ping") {
              continue;
            } else if (method === "tools/list") {
              result = { tools: TOOLS };
            } else if (method === "tools/call") {
              const output = await handleTool(params.name, params.arguments || {});
              result = { content: [{ type: "text", text: JSON.stringify(output, null, 2) }] };
            } else {
              result = {};
            }
            if (id !== undefined) responses.push({ jsonrpc: "2.0", id, result });
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(responses.length === 1 ? JSON.stringify(responses[0]) : JSON.stringify(responses));
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: err.message } }));
        }
      });
      return;
    }

    // GET /mcp — SSE stream para Streamable HTTP
    if (req.method === "GET") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });
      res.write(": ping\n\n");
      const interval = setInterval(() => res.write(": ping\n\n"), 15000);
      req.on("close", () => clearInterval(interval));
      return;
    }
  }

  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => console.log(`Trello MCP rodando na porta ${PORT}`));
