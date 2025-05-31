import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

export let managedMcpClients = new Map(); // obj = { url: { client, transportType, tools: [], namePrefix: "", lastError: null, toolsCount: 0 } }

async function _connectUrlAndStoreClient(url, postMessageCallback) {
  console.log(`Attempting to connect/re-connect to MCP server: ${url}`);
  if (postMessageCallback) {
    postMessageCallback({
      type: "mcp_server_status",
      data: { url, status: "connecting", error: null, toolsCount: 0, tools: [] },
    });
  }

  const serverUrl = new URL(url);
  let client = null;
  let transport = null;
  let transportType = null;
  let connectionError = null;
  let namePrefix = serverUrl.hostname.replace(/[^a-zA-Z0-9]/g, '_') + '_';
  let status = { success: false, error: null, toolsCount: 0, tools: [] };

  // call streamable first (since it's the new protocol), but keep sse as fallback
  try {
    console.log(`[${url}] Attempting Streamable HTTP transport...`);
    transport = new StreamableHTTPClientTransport(serverUrl);
    client = new Client({ name: "webllm-mcp-client-streamable", version: "1.0.0" });
    await client.connect(transport);
    transportType = 'streamableHttp';
    console.log(`[${url}] Connected using Streamable HTTP transport.`);
  } catch (streamableError) {
    console.warn(`[${url}] Streamable HTTP connection failed:`, streamableError);
    connectionError = streamableError; 
    client = null;
    transport = null;
    
    // sse fallback

    console.log(`[${url}] Falling back to SSE transport...`);
    try {
      transport = new SSEClientTransport(serverUrl);
      client = new Client({ name: "webllm-mcp-client-sse", version: "1.0.0" });
      await client.connect(transport);
      transportType = 'sse';
      connectionError = null; 
      console.log(`[${url}] Connected using SSE transport.`);
    } catch (sseError) {
      console.error(`[${url}] SSE connection also failed:`, sseError);
      connectionError = sseError;
      client = null;
      transport = null;
      transportType = null;
    }
  }

  // list tools and store client
  if (client && transportType) {
    try {
      const toolsResponse = await client.listTools();
      const tools = toolsResponse.tools || [];
      
      // Add enabled status and description visibility for each tool
      const toolsWithState = tools.map(tool => ({
        ...tool,
        isEnabled: true,
        showDescription: true
      }));
      
      managedMcpClients.set(url, {
        client,
        transportType,
        tools: toolsWithState,
        namePrefix,
        lastError: null,
        toolsCount: tools.length
      });
      console.log(`[${url}] Successfully listed tools using ${transportType}.`, toolsResponse);
      status = { success: true, error: null, toolsCount: tools.length, tools: toolsWithState };
    } catch (listToolsError) {
      console.error(`[${url}] Connected via ${transportType} but failed to list tools:`, listToolsError);
      managedMcpClients.set(url, { client, transportType, tools: [], namePrefix, lastError: listToolsError, toolsCount: 0 });
      status = { success: false, error: listToolsError.message || listToolsError.toString(), toolsCount: 0, tools: [] };
    }
  } else {
    console.error(`[${url}] Failed to connect using either transport.`);
    managedMcpClients.set(url, { client: null, transportType: null, tools: [], namePrefix, lastError: connectionError, toolsCount: 0 });
    status = { success: false, error: connectionError?.message || connectionError?.toString() || "Unknown connection error", toolsCount: 0, tools: [] };
  }
  
  if (postMessageCallback) {
    postMessageCallback({
      type: "mcp_server_status",
      data: { url, ...status },
    });
  }
  return status;
}

export async function synchronizeMcpClients(targetServerUrls = [], postMessageCallback) {
  console.log("Synchronizing MCP clients with target URLs:", targetServerUrls);
  const currentUrls = Array.from(managedMcpClients.keys());
  const urlsToShutdown = currentUrls.filter(url => !targetServerUrls.includes(url));
  const urlsToInitialize = targetServerUrls.filter(url => 
    !currentUrls.includes(url) || 
    (managedMcpClients.get(url) && managedMcpClients.get(url).lastError)
  );

  for (const url of urlsToShutdown) {
    const existing = managedMcpClients.get(url);
    if (existing && existing.client) {
      if (typeof existing.client.disconnect === 'function') {
        console.log(`Calling disconnect() for MCP client being shut down: ${url}`);
        try {
          await existing.client.disconnect(); // Await disconnect
        } catch (disconnectError) {
          console.error(`Error during disconnect for ${url}:`, disconnectError);
        }
      } else if (typeof existing.client.close === 'function') { // Fallback or alternative
        console.log(`Calling close() for MCP client being shut down: ${url}`);
        try {
          await existing.client.close(); // Await close
        } catch (closeError) {
          console.error(`Error during close for ${url}:`, closeError);
        }
      }
    }
    managedMcpClients.delete(url);
    console.log(`[MCP Client Manager] Removed client for ${url} from managed list.`);
  }

  for (const url of urlsToInitialize) {
    await _connectUrlAndStoreClient(url, postMessageCallback); 
  }
  console.log("MCP Clients synchronized. Current state:", managedMcpClients);
}

export async function addAndConnectMcpServer(url, postMessageCallback) {
  const existingClientData = managedMcpClients.get(url);

  // If client exists, is actively connected (client object present), and has no error, 
  // assume it's healthy. Just re-send its current status.
  if (existingClientData?.client && !existingClientData?.error) {
    console.log(`[MCP Client Manager] MCP URL ${url} is already known and connected. Re-sending status.`);
    postMessageCallback({
      type: "mcp_server_status",
      data: { 
        url, 
        success: true, 
        toolsCount: existingClientData.tools?.length || 0, 
        tools: existingClientData.tools || [] 
      }
    });
    return; // Exit early, no new connection needed
  }

  // If we reach here, it means either:
  // 1. No existing entry for the URL.
  // 2. An existing entry is present but it had an error (existingClientData.error was true).
  // 3. An existing entry is present but its client object was missing/disconnected (!existingClientData.client).
  // In cases 2 or 3 (i.e., if existingClientData is defined but not healthy), 
  // we must ensure we clear the old state before attempting a new connection.
  if (existingClientData) { 
    console.log(`[MCP Client Manager] Clearing existing (error/disconnected/stale) entry for ${url} before re-attempting connection.`);
    if (existingClientData.client) {
      if (typeof existingClientData.client.disconnect === 'function') {
        try {
          console.log(`[MCP Client Manager] Calling disconnect() on stale client for ${url}`);
          await existingClientData.client.disconnect(); // Await disconnect
        } catch (e) {
          console.warn(`[MCP Client Manager] Error during disconnect for stale client ${url}:`, e);
        }
      } else if (typeof existingClientData.client.close === 'function') {
         try {
          console.log(`[MCP Client Manager] Calling close() on stale client for ${url}`);
          await existingClientData.client.close(); // Await close
        } catch (e) {
          console.warn(`[MCP Client Manager] Error during close for stale client ${url}:`, e);
        }
      }
    }
    managedMcpClients.delete(url); // Remove stale entry from the map to ensure _connectUrlAndStoreClient starts truly fresh
  }
  
  // Now, whether it was a brand new URL or a stale one we just cleared, proceed to connect.
  console.log(`[MCP Client Manager] Attempting fresh connection for ${url}.`);
  await _connectUrlAndStoreClient(url, postMessageCallback); // This will create and store a new client state
}

export async function forceReconnectMcpServer(url, postMessageCallback) {
  console.log(`Forcing reconnect for MCP server: ${url}`);
  const existing = managedMcpClients.get(url);
  if (existing && existing.client) {
    if (typeof existing.client.disconnect === 'function') {
      console.log(`Calling disconnect() for existing client ${url} before force reconnect.`);
      try {
        await existing.client.disconnect(); // Await disconnect
      } catch (closeError) {
        console.error(`Error during disconnect for ${url} during force reconnect:`, closeError);
      }
    } else if (typeof existing.client.close === 'function') {
      console.log(`Calling close() for existing client ${url} before force reconnect.`);
      try {
        await existing.client.close(); // Await close
      } catch (closeError) {
        console.error(`Error during close for ${url} during force reconnect:`, closeError);
      }
    }
  }
  managedMcpClients.delete(url);
  
  console.log(`Proceeding with fresh connection attempt for ${url} after force.`);
  return await _connectUrlAndStoreClient(url, postMessageCallback);
} 