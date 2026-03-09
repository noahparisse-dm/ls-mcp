// Tests for server instructions and de-jargoned tool descriptions
// Verifies what the LLM actually sees when it connects to this server

import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { createServer } from "../../src/server.js";

/**
 * Create a linked pair of in-memory transports for testing.
 * Messages sent on one side are received on the other.
 */
function createLinkedTransportPair(): [Transport, Transport] {
  let onMessageA: Transport["onmessage"];
  let onMessageB: Transport["onmessage"];

  const transportA: Transport = {
    async start() {},
    async send(message: JSONRPCMessage) {
      // A sends → B receives
      onMessageB?.(message);
    },
    async close() {
      transportA.onclose?.();
    },
    set onmessage(handler) {
      onMessageA = handler;
    },
    get onmessage() {
      return onMessageA;
    },
  };

  const transportB: Transport = {
    async start() {},
    async send(message: JSONRPCMessage) {
      // B sends → A receives
      onMessageA?.(message);
    },
    async close() {
      transportB.onclose?.();
    },
    set onmessage(handler) {
      onMessageB = handler;
    },
    get onmessage() {
      return onMessageB;
    },
  };

  return [transportA, transportB];
}

describe("server instructions and tool descriptions", () => {
  let client: Client;
  let instructions: string | undefined;
  let tools: Array<{
    name: string;
    description?: string;
    inputSchema: { properties?: Record<string, object> };
  }>;

  beforeAll(async () => {
    const server = createServer("fake-api-key-for-testing");
    client = new Client({ name: "test-client", version: "1.0.0" });

    const [clientTransport, serverTransport] = createLinkedTransportPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);

    instructions = client.getInstructions();
    const result = await client.listTools();
    tools = result.tools;
  });

  afterAll(async () => {
    await client.close();
  });

  // --- Instructions ---

  it("provides non-empty instructions", () => {
    expect(instructions).toBeTruthy();
    expect(typeof instructions).toBe("string");
    expect(instructions!.length).toBeGreaterThan(0);
  });

  it("instructions say never ask users for internal IDs", () => {
    expect(instructions!.toLowerCase()).toContain("never");
    expect(instructions!).toMatch(/people_id|bill_id|session_id|roll_call_id/);
  });

  it("instructions reference find_legislator as a resolver", () => {
    expect(instructions).toContain("find_legislator");
  });

  it("instructions reference find_bill_by_number as a resolver", () => {
    expect(instructions).toContain("find_bill_by_number");
  });

  // --- Tool count ---

  it("registers all 11 tools", () => {
    expect(tools).toHaveLength(11);
  });

  // --- De-jargoned descriptions ---

  it("no tool description contains bill.votes[]", () => {
    for (const tool of tools) {
      const desc = tool.description ?? "";
      const paramDescs = Object.values(tool.inputSchema.properties ?? {})
        .map((p) => (p as { description?: string }).description ?? "")
        .join(" ");
      const combined = `${desc} ${paramDescs}`;
      expect(combined).not.toContain("bill.votes[]");
    }
  });

  it("tools needing people_id mention find_legislator in their description", () => {
    const toolsWithPeopleId = tools.filter((t) => {
      const props = t.inputSchema.properties ?? {};
      return "people_id" in props;
    });

    expect(toolsWithPeopleId.length).toBeGreaterThan(0);

    for (const tool of toolsWithPeopleId) {
      const desc = tool.description ?? "";
      const paramDescs = Object.values(tool.inputSchema.properties ?? {})
        .map((p) => (p as { description?: string }).description ?? "")
        .join(" ");
      const combined = `${desc} ${paramDescs}`;
      expect(combined).toContain("find_legislator");
    }
  });

  it("legiscan_get_bill_text is registered with a doc_id parameter", () => {
    const tool = tools.find((t) => t.name === "legiscan_get_bill_text");
    expect(tool).toBeDefined();
    expect(tool!.inputSchema.properties).toHaveProperty("doc_id");
  });

  it("legiscan_get_bill_text description guides user to call get_bill first", () => {
    const tool = tools.find((t) => t.name === "legiscan_get_bill_text");
    expect(tool!.description).toMatch(/get_bill/);
  });

  it("get_session_people mentions get_session_list in its description", () => {
    const tool = tools.find((t) => t.name === "legiscan_get_session_people");
    expect(tool).toBeDefined();

    const desc = tool!.description ?? "";
    const paramDescs = Object.values(tool!.inputSchema.properties ?? {})
      .map((p) => (p as { description?: string }).description ?? "")
      .join(" ");
    const combined = `${desc} ${paramDescs}`;
    expect(combined).toContain("get_session_list");
  });
});

// --- legiscan_get_bill_text tool calls ---

function makeBillTextApiResponse(mimeId: number, mime: string, content: string) {
  return {
    status: "OK",
    text: {
      doc_id: 1,
      bill_id: 42,
      date: "2026-01-01",
      type: "Introduced",
      type_id: 1,
      mime,
      mime_id: mimeId,
      text_size: content.length,
      text_hash: "abc123",
      doc: Buffer.from(content).toString("base64"),
    },
  };
}

describe("legiscan_get_bill_text tool calls", () => {
  let client: Client;
  const originalFetch = global.fetch;

  beforeAll(async () => {
    const server = createServer("fake-api-key-for-testing");
    client = new Client({ name: "test-client", version: "1.0.0" });
    const [clientTransport, serverTransport] = createLinkedTransportPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterAll(async () => {
    await client.close();
  });

  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("calls the getBillText API endpoint with the supplied doc_id", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeBillTextApiResponse(1, "text/html", "<p>Test</p>"),
    } as Response);

    await client.callTool({ name: "legiscan_get_bill_text", arguments: { doc_id: 77 } });

    const [calledUrl] = fetchMock.mock.calls[0] as [string];
    const url = new URL(calledUrl);
    expect(url.searchParams.get("op")).toBe("getBillText");
    expect(url.searchParams.get("id")).toBe("77");
  });

  it("returns plain text with HTML tags stripped", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () =>
        makeBillTextApiResponse(
          1,
          "text/html",
          "<h1>Emergency Housing Act</h1><p>Section 1: <em>Landlords</em> shall comply.</p>"
        ),
    } as Response);

    const result = await client.callTool({
      name: "legiscan_get_bill_text",
      arguments: { doc_id: 1 },
    });

    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.type).toBe("text");
    expect(content[0]?.text).toContain("Emergency Housing Act");
    expect(content[0]?.text).toContain("Landlords");
    expect(content[0]?.text).not.toContain("<h1>");
    expect(content[0]?.text).not.toContain("<em>");
  });

  it("returns an error response when the API rejects the doc_id", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: "ERROR", alert: { message: "Invalid document ID" } }),
    } as Response);

    const result = await client.callTool({
      name: "legiscan_get_bill_text",
      arguments: { doc_id: 9999 },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("Invalid document ID");
  });

  it("returns an error response on network failure", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockRejectedValue(new Error("socket hang up"));

    const result = await client.callTool({
      name: "legiscan_get_bill_text",
      arguments: { doc_id: 1 },
    });

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("socket hang up");
  });
});
