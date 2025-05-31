export function prepareToolData(managedMcpClients, activeUrlsForThisGeneration) {
  let aggregatedToolsForPrompt = [];
  if (managedMcpClients.size > 0 && activeUrlsForThisGeneration && Array.isArray(activeUrlsForThisGeneration) && activeUrlsForThisGeneration.length > 0) {
    activeUrlsForThisGeneration.forEach(activeUrl => {
      if (managedMcpClients.has(activeUrl)) {
        const state = managedMcpClients.get(activeUrl);
        if (state && !state.lastError && state.tools && state.tools.length > 0) {
        state.tools.forEach(tool => {
          if (!tool.isEnabled) {
              console.log(`[ToolInteraction] Skipping tool explicitly disabled at tool-level: ${tool.name} from ${activeUrl}`);
            return;
          }
          
          const uniqueToolId = state.namePrefix + tool.name;
          aggregatedToolsForPrompt.push({
              ...tool,
            uniqueToolId: uniqueToolId,
            originalName: tool.name,
              serverUrl: activeUrl
          });
        });
        } else if (state && state.lastError) {
          console.warn(`[ToolInteraction] Server ${activeUrl} (specified as active for this turn) has a lastError recorded: ${state.lastError.message}. Skipping its tools.`);
        } else if (state && (!state.tools || state.tools.length === 0)) {
          console.log(`[ToolInteraction] Server ${activeUrl} (specified as active for this turn) is connected but has no tools listed.`);
        }
      } else {
        console.warn(`[ToolInteraction] Server URL ${activeUrl} (specified as active for this turn) was not found in managedMcpClients. It might have been recently disconnected or disabled.`);
      }
    });
  } else if (managedMcpClients.size > 0 && (!activeUrlsForThisGeneration || activeUrlsForThisGeneration.length === 0)) {
    console.log("[ToolInteraction] No active server URLs provided for this generation turn, so no tools will be prepared, even if servers are managed.");
  }

  const mcpToolsArray = aggregatedToolsForPrompt.map(t => ({ 
    name: t.uniqueToolId,       
    originalName: t.originalName, 
    serverUrl: t.serverUrl,
    description: t.description,
    inputSchema: t.inputSchema,
    showDescription: t.showDescription
  }));

  const toolsForTemplate = aggregatedToolsForPrompt.map(tool => ({
    type: "function",
    function: {
      name: tool.uniqueToolId,
      ...(tool.showDescription ? { description: tool.description } : {}),
      parameters: tool.inputSchema
    }
  }));

  if (toolsForTemplate.length > 0) {
    console.log("[ToolInteraction] Tools prepared for template:", JSON.stringify(toolsForTemplate, null, 2));
  } else {
    console.log("[ToolInteraction] No tools available or no MCP servers configured.");
  }

  const currentLength = JSON.stringify(toolsForTemplate).length;
  console.log(`[ToolInteraction] Current toolsForTemplate character length: ${currentLength}, Number of tools: ${toolsForTemplate.length}`);

  return { toolsForTemplate, mcpToolsArray };
}

export function parseToolCallsFromOutput(assistantMessageContent) {
  const toolCallRegex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
  let match;
  const parsedToolCalls = [];
  while ((match = toolCallRegex.exec(assistantMessageContent)) !== null) {
    try {
      const callJsonString = match[1];
      const callJson = JSON.parse(callJsonString);

      if (callJson.name && callJson.arguments !== undefined) {
        let parsedArgs = callJson.arguments;
        if (typeof parsedArgs === 'string') {
          try {
            parsedArgs = JSON.parse(parsedArgs);
          } catch (argParseError) {
            console.warn(`[ToolInteraction] Tool call arguments for '${callJson.name}' is a string but not valid JSON: ${parsedArgs}. Using as string.`);
          }
        }
        
        parsedToolCalls.push({
          name: callJson.name,
          arguments: parsedArgs,
          rawToolCallText: match[0]
        });
        console.log(`[ToolInteraction] Parsed tool call: Name=${callJson.name}, Args=`, parsedArgs);
      } else {
        console.warn("[ToolInteraction] Parsed tool call JSON missing name or arguments:", callJsonString);
      }
    } catch (e) {
      console.error("[ToolInteraction] Failed to parse JSON from tool_call content:", match[1], e);
    }
  }
  return parsedToolCalls;
}

export async function executeAllToolCalls(parsedCalls, mcpToolsArray, managedMcpClients, postMessageCallback) {
  const toolResponseMessages = [];
  let mcpErrorOccurred = false;

  for (const parsedCall of parsedCalls) {
    const toolToCall = mcpToolsArray.find(t => t.name === parsedCall.name);

    if (toolToCall) {
      try {
        const clientProvider = managedMcpClients.get(toolToCall.serverUrl);
        if (!clientProvider || !clientProvider.client || clientProvider.lastError) {
          const errorMsg = clientProvider?.lastError?.message || `Client for tool "${parsedCall.name}" (server: ${toolToCall.serverUrl}) is not available.`;
          console.error(`[ToolInteraction] MCP Client Error: ${errorMsg}`);
          throw new Error(errorMsg);
        }
        const actualClient = clientProvider.client;
        console.log(`[ToolInteraction] Calling MCP tool: '${toolToCall.originalName}' on server '${toolToCall.serverUrl}' with args:`, parsedCall.arguments);

        const result = await actualClient.callTool({
          name: toolToCall.originalName,
          arguments: parsedCall.arguments
        });
        
        const toolContent = result.content && result.content[0] ? result.content[0].text : JSON.stringify(result);
        console.log(`[ToolInteraction] MCP tool '${toolToCall.originalName}' result:`, toolContent);

        toolResponseMessages.push({
          role: "tool",
          name: parsedCall.name,
          content: toolContent
        });

      } catch (error) {
        mcpErrorOccurred = true;
        console.error(`[ToolInteraction] Error calling MCP tool "${toolToCall.originalName}" for ${parsedCall.name}:`, error);
        const errorMessage = error.message || "Tool execution failed";
        toolResponseMessages.push({
          role: "tool",
          name: parsedCall.name,
          content: JSON.stringify({ error: errorMessage, details: `Failed to execute tool ${parsedCall.name}` })
        });
        if (postMessageCallback) {
          postMessageCallback({ 
            status: "tool_execution_error",
            errorDetails: { functionName: parsedCall.name, errorMessage }
          });
        }
      }
    } else { 
      mcpErrorOccurred = true;
      console.error(`[ToolInteraction] Tool "${parsedCall.name}" not found in mcpToolsArray.`);
      const errorMsg = `Tool "${parsedCall.name}" not found.`;
      toolResponseMessages.push({
        role: "tool",
        name: parsedCall.name,
        content: JSON.stringify({ error: errorMsg })
      });
      if (postMessageCallback) {
        postMessageCallback({ 
          status: "tool_execution_error",
          errorDetails: { functionName: parsedCall.name, errorMessage: errorMsg }
        });
      }
    }
  }
  return { toolResponseMessages, mcpErrorOccurred };
} 