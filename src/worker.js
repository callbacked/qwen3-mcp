import {
  TextStreamer,
  InterruptableStoppingCriteria,
  LogitsProcessorList
} from "@huggingface/transformers";
import {
  managedMcpClients,
  synchronizeMcpClients,
  addAndConnectMcpServer,
  forceReconnectMcpServer
} from './services/mcpClientManager.js';
import { ThinkingTokenBudgetProcessor } from './services/thinkingBudget.js';
import { TextGenerationPipeline, loadModelAndWarmup } from './services/modelHandler.js';
import { 
  prepareToolData, 
  parseToolCallsFromOutput, 
  executeAllToolCalls 
} from './services/toolInteraction.js';
import { createToolSystemPrompt } from './services/promptManager.js';

let workerTokenizer = null;

/**
 * Helper function to perform feature detection for WebGPU
 */
// let fp16_supported = false;
async function check() {
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("WebGPU is not supported (no adapter found)");
    }
  } catch (e) {
    self.postMessage({
      status: "error",
      data: e.toString(),
    });
  }
}

const stopping_criteria = new InterruptableStoppingCriteria();
let past_key_values_cache = null;
let mcpToolsArray = []; 
let awaitingToolResults = false;
let generation_start_time = 0;
let num_generated_tokens = 0;
let current_num_prompt_tokens = 0;

async function calculateAndSendToolSchemaTokens() {
  if (!workerTokenizer) {
    console.warn("[Worker] Tokenizer not available for schema token calculation.");
    self.postMessage({ type: 'tool_schema_token_update', data: { currentToolSchemaTokens: 0, error: "Tokenizer not ready" } });
    return;
  }

  const activeAndEnabledWorkerUrls = Array.from(managedMcpClients.keys()).filter(url => {
    const serverState = managedMcpClients.get(url);
    return serverState?.client && !serverState?.lastError && serverState?.appIsEnabled !== false;
  });

  const { toolsForTemplate } = prepareToolData(managedMcpClients, activeAndEnabledWorkerUrls);

  let count = 0;
  if (toolsForTemplate && toolsForTemplate.length > 0) {
    try {
      const tokenizedSchema = workerTokenizer.apply_chat_template([], {
        tools: toolsForTemplate,
        add_generation_prompt: false,
        return_dict: true,
      });
      if (tokenizedSchema && tokenizedSchema.input_ids && tokenizedSchema.input_ids.ort_tensor) {
        count = tokenizedSchema.input_ids.ort_tensor.size;
      } else {
        console.warn("[Worker] Failed to get token count from tokenized schema object structure.");
      }
    } catch (error) {
      console.error("[Worker] Error tokenizing tool schema:", error);
      self.postMessage({ type: 'tool_schema_token_update', data: { currentToolSchemaTokens: 0, error: "Tokenization error" } });
      return;
    }
  }
  //console.log(`[Worker] Calculated tool schema token count: ${count}`);
  self.postMessage({ type: 'tool_schema_token_update', data: { currentToolSchemaTokens: count } });
}


async function generate({ messages, reasonEnabled, mcpServerUrls, maxThinkingBudget = 1024 }) {
  let interruption_requested = false;
  stopping_criteria.reset();
  let fullGeneratedContent = "";
  let generationLoopCount = 0; 
  const MAX_GENERATION_LOOPS = 10; 

  generation_start_time = performance.now();
  num_generated_tokens = 0;

  let thinkingState = "answering";

  const [tokenizer, model] = await TextGenerationPipeline.getInstance();

  let logits_processor_list = null;
  let localThinkingTokenBudgetProcessor = null;

  if (reasonEnabled) {
    localThinkingTokenBudgetProcessor = new ThinkingTokenBudgetProcessor(tokenizer, maxThinkingBudget);
    logits_processor_list = new LogitsProcessorList();
    logits_processor_list.push(localThinkingTokenBudgetProcessor);
    //console.log(`[Worker] generate: ThinkingTokenBudgetProcessor activated with budget ${maxThinkingBudget}.`);
  } else {
    //console.log("[Worker] generate: ThinkingTokenBudgetProcessor not active (reasonEnabled is false).");
  }

  const { toolsForTemplate: fullToolsForTemplate, mcpToolsArray: currentMcpToolsArray } = prepareToolData(managedMcpClients, mcpServerUrls);
  mcpToolsArray = currentMcpToolsArray;

  let toolsToUseInCurrentGeneration = fullToolsForTemplate;
  //console.log(`[Worker] Using all ${toolsToUseInCurrentGeneration.length} tools`);

  if (toolsToUseInCurrentGeneration.length > 0) {
    const systemPrompt = createToolSystemPrompt();
    if (!messages.some(m => m.role === 'system')) {
      messages.unshift({ role: 'system', content: systemPrompt });
    }
  }

  let prompt_tokens_without_tool_schemas = 0;
  const inputs_without_tool_schemas = tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
    tools: undefined, 
    enable_thinking: reasonEnabled, 
    return_dict: true,
  });
  if (inputs_without_tool_schemas && inputs_without_tool_schemas.input_ids && inputs_without_tool_schemas.input_ids.ort_tensor) {
    prompt_tokens_without_tool_schemas = inputs_without_tool_schemas.input_ids.ort_tensor.size;
  } else {
    console.warn("[Worker] Warning: inputs_without_tool_schemas.input_ids.ort_tensor.size not found. Defaulting token count to 0.");
    prompt_tokens_without_tool_schemas = 0;
  }

  //console.log("[Worker] Applying chat template with messages:", JSON.stringify(messages, null, 2));
  if (toolsToUseInCurrentGeneration.length > 0) {
    //console.log("[Worker] Providing tools to apply_chat_template:", JSON.stringify(toolsToUseInCurrentGeneration, null, 2));
  }

  const inputs_with_tool_schemas = tokenizer.apply_chat_template(messages, {
    add_generation_prompt: true,
    tools: toolsToUseInCurrentGeneration.length > 0 ? toolsToUseInCurrentGeneration : undefined,
    enable_thinking: reasonEnabled,
    return_dict: true,
  });
  if (inputs_with_tool_schemas && inputs_with_tool_schemas.input_ids && inputs_with_tool_schemas.input_ids.ort_tensor) {
    current_num_prompt_tokens = inputs_with_tool_schemas.input_ids.ort_tensor.size; 
  } else {
    console.warn("[Worker] Warning: inputs_with_tool_schemas.input_ids.ort_tensor.size not found. Defaulting token count to 0.");
    current_num_prompt_tokens = 0;
  }

  if (toolsToUseInCurrentGeneration.length > 0) {
    const tool_schema_tokens_cost = current_num_prompt_tokens - prompt_tokens_without_tool_schemas;
    //console.log(`[Worker] Prompt tokens (including ${toolsToUseInCurrentGeneration.length} tool schemas and system prompt): ${current_num_prompt_tokens}.`);
    //console.log(`[Worker] Prompt tokens (with system prompt, but no tool schemas): ${prompt_tokens_without_tool_schemas}.`);
    //console.log(`[Worker] Estimated token cost for ${toolsToUseInCurrentGeneration.length} tool schemas: ${tool_schema_tokens_cost}.`);
  } else {
    //console.log(`[Worker] Prompt tokens: ${current_num_prompt_tokens} (no tools).`);
  }

  const inputs = inputs_with_tool_schemas;

  let currentOutput = ""; 
  
  const token_callback_function = (tokens_ids_array) => { 
    if (tokens_ids_array && tokens_ids_array.length > 0) {
        num_generated_tokens += tokens_ids_array.length; 
    }
  };


  const callback_function = async (outputChunk) => {
    currentOutput += outputChunk;

    let current_tps = 0;
    if (num_generated_tokens > 0 && generation_start_time > 0) {
        const elapsed_ms = performance.now() - generation_start_time;
        if (elapsed_ms > 0) {
            current_tps = num_generated_tokens / (elapsed_ms / 1000);
        }
    }
    const current_total_tokens = current_num_prompt_tokens + num_generated_tokens;

      self.postMessage({
        status: "update",
      output: outputChunk,
      tps: current_tps, 
      numTokens: current_total_tokens, 
    });

    if (currentOutput.includes("<tool_call>") && currentOutput.includes("</tool_call>")) {
      if (!stopping_criteria.interrupted) {
        const testRegex = /<tool_call>\s*(\{[\s\S]+?\})\s*<\/tool_call>/;
        const testMatch = currentOutput.match(testRegex);
        if (testMatch && testMatch[1]) {
          try {
            JSON.parse(testMatch[1]); 
            //console.log("[Worker] callback_function: Potential complete tool_call detected. Interrupting generation.");
            stopping_criteria.interrupt();
          } catch (e) {
          }
        }
      }
    }
  };

  const streamer = new TextStreamer(tokenizer, {
    skip_prompt: true,
    skip_special_tokens: true, 
    token_callback: token_callback_function,
    callback_function,
  });

  self.postMessage({ status: "start" });

  let assistantMessageContent = "";

  try {
    const generationResult = await model.generate({
      ...inputs,
      past_key_values: past_key_values_cache,
      do_sample: true,
      top_k: 20,
      temperature: reasonEnabled ? 0.6 : 0.7, 
      max_new_tokens: 16384, 
      streamer,
      stopping_criteria,
      logits_processor: reasonEnabled && logits_processor_list ? logits_processor_list : undefined,
      return_dict_in_generate: true, 
    });

    assistantMessageContent = currentOutput; 

       if (generationResult && generationResult.past_key_values) {
           past_key_values_cache = generationResult.past_key_values;
      //console.log("[Worker] generate: past_key_values_cache updated.");
       } else {
      console.warn("[Worker] generate: No past_key_values in generationResult. Cache NOT updated.");
    }

  } catch (e) {
    console.error("[Worker] Error during model.generate:", e);
    self.postMessage({ status: "error", data: "Error during generation: " + e.message });
    past_key_values_cache = null; 
    self.postMessage({ status: "complete", output: "", toolCallInProgress: false }); 
    return; 
  }

  if (assistantMessageContent.trim() !== "") {
    let contentForHistory = assistantMessageContent;
    const thinkTagEnd = "</think>";
    const thinkEndIndex = assistantMessageContent.indexOf(thinkTagEnd);

    if (thinkEndIndex !== -1) {
      contentForHistory = assistantMessageContent.substring(thinkEndIndex + thinkTagEnd.length).trim();
    } 

    messages.push({ role: "assistant", content: contentForHistory });
    //console.log("[Worker] Assistant message pushed to history (for model):", JSON.stringify(messages.slice(-1), null, 2));
  } else if (stopping_criteria.interrupted) {
     //console.log("[Worker] Assistant message was empty but generation was interrupted (likely for tool call). Proceeding to parse from accumulated output.");
  } else {
     //console.log("[Worker] Assistant message was empty and not interrupted. Completing.");
     self.postMessage({ status: "complete", output: "", toolCallInProgress: false });
     return;
  }

  const parsedToolCallsFromThisTurn = parseToolCallsFromOutput(assistantMessageContent);

  if (parsedToolCallsFromThisTurn.length > 0) {
    const { toolResponseMessages, mcpErrorOccurred } = await executeAllToolCalls(
      parsedToolCallsFromThisTurn, 
      mcpToolsArray, 
      managedMcpClients, 
      self.postMessage
    );

    messages.push(...toolResponseMessages);
    //console.log("[Worker] Tool response messages pushed to history:", JSON.stringify(toolResponseMessages, null, 2));

    if (!mcpErrorOccurred) {
      //console.log("[Worker] Recursively calling generate with new messages including tool responses.");
      awaitingToolResults = false; 
      await generate({ messages, reasonEnabled, mcpServerUrls, maxThinkingBudget });
      return; 
    } else {
      //console.log("[Worker] Tool execution error occurred. Halting generation for this turn.");
      self.postMessage({ 
        status: "complete", 
        output: "", 
        tps: 0, 
        numTokens: current_num_prompt_tokens + num_generated_tokens 
      });
      return; 
    }
  }

  //console.log("[Worker] No valid tool calls processed in this turn, or it\'s a final answer. Generation complete for this path.");
  awaitingToolResults = false;
  self.postMessage({ status: "complete", output: "", toolCallInProgress: false }); 
}

self.addEventListener("message", async (e) => {
  const { type, data } = e.data;
  //console.log(`[Worker] Received message of type: ${type}`, data ? JSON.stringify(data).substring(0, 200) : '');
  try {
  switch (type) {
    case "check":
      await check();
      break;
    case "load":
      loadModelAndWarmup(self.postMessage).then(async () => {
        const [tokenizerInstance, modelInstance] = await TextGenerationPipeline.getInstance();
        workerTokenizer = tokenizerInstance; 
        //console.log("[Worker] Model loaded. MCP servers will be handled by initialize_mcp_servers.");
      });
      break;
    case "initialize_mcp_servers":
      //console.log("[Worker] Received initialize_mcp_servers with URLs:", data.urls);
      synchronizeMcpClients(data.urls, self.postMessage)
        .then(() => {
          //console.log("[Worker] MCP Servers synchronization complete after initialize_mcp_servers message.");
        })
        .catch(error => {
          console.error("[Worker] Error during MCP server synchronization from initialize_mcp_servers:", error);
        });
      break;
    case "add_mcp_server": 
      //console.log("[Worker] Received add_mcp_server for URL:", data.url);
      addAndConnectMcpServer(data.url, self.postMessage)
        .then(status => {
          //console.log(`[Worker] MCP Server ${data.url} add/connect attempt complete.`);
        })
        .catch(error => {
          console.error(`[Worker] Error processing add_mcp_server for ${data.url}:`, error);
          self.postMessage({
            type: "mcp_server_status",
            data: { url: data.url, success: false, error: error.message || 'Failed to add/connect server', toolsCount: 0, tools: [] },
          });
        });
      break;
    case "force_reconnect_mcp_server":
      //console.log("[Worker] Received force_reconnect_mcp_server for URL:", data.url);
      forceReconnectMcpServer(data.url, self.postMessage)
        .then(() => {
            //console.log(`[Worker] MCP Server ${data.url} force reconnect attempt processed.`);
        })
        .catch(error => {
            console.error(`[Worker] Error during force_reconnect_mcp_server for ${data.url}:`, error);
            self.postMessage({
                type: "mcp_server_status",
                data: { url: data.url, success: false, error: error.message || 'Force reconnect failed', toolsCount: 0, tools: [] },
            });
        });
      break;
    case "toggle_tool":
      if (data && data.serverUrl && data.toolName) {
        //console.log(`[Worker] Toggling tool enablement: ${data.toolName} on server ${data.serverUrl} to ${data.isEnabled}`);
        
        if (managedMcpClients.has(data.serverUrl)) {
          const serverState = managedMcpClients.get(data.serverUrl);
          if (serverState.tools && Array.isArray(serverState.tools)) {
            const toolIndex = serverState.tools.findIndex(tool => tool.name === data.toolName);
            if (toolIndex !== -1) {
              serverState.tools[toolIndex].isEnabled = data.isEnabled !== undefined ? 
                data.isEnabled : !serverState.tools[toolIndex].isEnabled;
                
              //console.log(`[Worker] Tool ${data.toolName} isEnabled set to ${serverState.tools[toolIndex].isEnabled}`);
            } else {
              console.warn(`[Worker] Tool ${data.toolName} not found on server ${data.serverUrl}`);
            }
          }
        } else {
          console.warn(`[Worker] Server ${data.serverUrl} not found in managedMcpClients`);
        }
      }
      break;
    case "toggle_tool_description":
      if (data && data.serverUrl && data.toolName) {
        //console.log(`[Worker] Toggling tool description visibility: ${data.toolName} on server ${data.serverUrl}`);
        
        if (managedMcpClients.has(data.serverUrl)) {
          const serverState = managedMcpClients.get(data.serverUrl);
          if (serverState.tools && Array.isArray(serverState.tools)) {
            const toolIndex = serverState.tools.findIndex(tool => tool.name === data.toolName);
            if (toolIndex !== -1) {
              serverState.tools[toolIndex].showDescription = !serverState.tools[toolIndex].showDescription;
              //console.log(`[Worker] Tool ${data.toolName} showDescription set to ${serverState.tools[toolIndex].showDescription}`);
            } else {
              console.warn(`[Worker] Tool ${data.toolName} not found on server ${data.serverUrl}`);
            }
          }
        } else {
          console.warn(`[Worker] Server ${data.serverUrl} not found in managedMcpClients`);
        }
      }
      break;
    case "retry_tool_call":
        awaitingToolResults = false; 
        generation_start_time = 0; 
        num_generated_tokens = 0;
        current_num_prompt_tokens = 0;
        try {
          await retry_tool_call({ ...data }); 
        } catch (retryError) {
          console.error("[Worker] Error during retry_tool_call execution from onmessage:", retryError);
          self.postMessage({
            status: "tool_retry_failed",
            data: {
              messageIndex: data && data.messageIndex !== undefined ? data.messageIndex : -1, 
              error: retryError.message || "An unexpected error occurred during tool retry." 
            }
          });
      }
      break;
    case "generate":
        awaitingToolResults = false;
        generation_start_time = 0;
        num_generated_tokens = 0;
        current_num_prompt_tokens = 0;
        try {
          const urlsToUse = Array.isArray(data.mcpServerUrls) ? data.mcpServerUrls : 
                            (typeof data.mcpServerUrls === 'string' ? [data.mcpServerUrls] : []);
        
        let budget = undefined;
        if (typeof data.maxThinkingBudget === 'number') {
          budget = data.maxThinkingBudget;
        }

        await generate({ ...data, mcpServerUrls: urlsToUse, maxThinkingBudget: budget });
      } catch (genError) {
        console.error("Unhandled error in generate call from event listener:", genError);
        self.postMessage({ status: "error", data: "Failed to generate response: " + genError.message });
      }
      break;

    case "interrupt":
      stopping_criteria.interrupt();
      break;

    case "reset":
      past_key_values_cache = null;
      stopping_criteria.reset();
        awaitingToolResults = false; 
      
      //console.log("Closing all MCP client connections due to chat reset.");
      for (const [url, mcpState] of managedMcpClients) {
        if (mcpState.client && typeof mcpState.client.close === 'function') {
          try {
            await mcpState.client.close();
            //console.log(`Closed client for ${url}`);
          } catch (closeError) {
            console.error(`Error closing client for ${url} during reset:`, closeError);
          }
        }
      }
      managedMcpClients.clear();
        mcpToolsArray = []; 
        //console.log("Chat session reset. All MCP clients and mcpToolsArray cleared.");
      break;

    case "update_tool_configs_and_recalculate_tokens":
      if (data && data.allServerConfigsFromApp) {
        //console.log("[Worker] Received update_tool_configs_and_recalculate_tokens. App says these URLs should exist:", 
            //JSON.stringify(data.allServerConfigsFromApp.map(s => s.url))
        //);
        const { allServerConfigsFromApp } = data;
        const appServerUrls = new Set(allServerConfigsFromApp.map(s => s.url));

        const urlsToRemoveFromWorker = [];
        for (const workerUrl of managedMcpClients.keys()) {
          if (!appServerUrls.has(workerUrl)) {
            urlsToRemoveFromWorker.push(workerUrl);
          }
        }

        for (const workerUrl of urlsToRemoveFromWorker) {
            //console.log(`[Worker] update_tool_configs: Stale client ${workerUrl} found in worker, but not in app's list. Removing.`);
            const clientToRemove = managedMcpClients.get(workerUrl);
            if (clientToRemove && clientToRemove.client) {
              if (typeof clientToRemove.client.disconnect === 'function') {
                try {
                  await clientToRemove.client.disconnect();
                } catch (e) { console.warn(`[Worker] Error disconnecting stale client ${workerUrl} during update_tool_configs:`, e); }
              } else if (typeof clientToRemove.client.close === 'function') {
                try {
                  await clientToRemove.client.close();
                } catch (e) { console.warn(`[Worker] Error closing stale client ${workerUrl} during update_tool_configs:`, e); }
              }
            }
            managedMcpClients.delete(workerUrl);
        }

        // Step 2: Update existing ones (and potentially add new ones if synchronize didn't catch them, though it should)
        for (const serverConfigFromApp of allServerConfigsFromApp) {
          if (managedMcpClients.has(serverConfigFromApp.url)) {
            const workerServerState = managedMcpClients.get(serverConfigFromApp.url);
            
            workerServerState.appIsEnabled = serverConfigFromApp.isEnabled; // Sync app's view of isEnabled

            if (workerServerState && workerServerState.tools && serverConfigFromApp && serverConfigFromApp.tools) {
              workerServerState.tools = workerServerState.tools.map(workerTool => {
                const appToolConfig = serverConfigFromApp.tools.find(at => at.name === workerTool.name);
                return {
                  ...workerTool,
                  isEnabled: appToolConfig?.isEnabled !== undefined ? appToolConfig.isEnabled : workerTool.isEnabled,
                  showDescription: appToolConfig?.showDescription !== undefined ? appToolConfig.showDescription : workerTool.showDescription,
                };
              });
            } else {
              // This case should ideally be handled by 'synchronize_mcp_servers' or 'add_mcp_server'
              // If a server is in allServerConfigsFromApp but not in managedMcpClients,
              // it implies a sync issue or it's a new server the app knows about but worker doesn't yet.

              console.warn(`[Worker] update_tool_configs: Server ${serverConfigFromApp.url} is in app's list but not in worker's managedMcpClients. Synchronization might be pending or an issue exists.`);
            }
          }
        }
        
        //console.log("[Worker] managedMcpClients after reconciliation in update_tool_configs:", Array.from(managedMcpClients.keys()));
        await calculateAndSendToolSchemaTokens();
      } else {
        console.warn("[Worker] Invalid payload for update_tool_configs_and_recalculate_tokens:", data);
      }
      break;
    }
  } catch (error) {
    console.error(`[Worker] Error in onmessage handler for type ${type}:`, error);
    self.postMessage({
      status: "error",
      data: `Worker processing error: ${error.message}`
    });
  }
});

async function retry_tool_call({ 
  messageIndex, 
  functionName, 
  args, 
  originalFailedMessageContent, 
  messagesSnapshot,      
  mcpServerUrls, 
  reasonEnabled,         
  maxThinkingBudget      
}) {
  //console.log("[Worker] retry_tool_call received:", { messageIndex, functionName, args, mcpServerUrls, reasonEnabled, maxThinkingBudget });
  stopping_criteria.reset();

  generation_start_time = performance.now();
  num_generated_tokens = 0;
  current_num_prompt_tokens = 0; 

  await synchronizeMcpClients(mcpServerUrls || []); 
  const [tokenizer, model] = await TextGenerationPipeline.getInstance(); 

  const { mcpToolsArray: localMcpToolsArrayForRetry } = prepareToolData(managedMcpClients, mcpServerUrls || []);

  const toolToRetry = localMcpToolsArrayForRetry.find(t => t.name === functionName);

  if (!toolToRetry) {
    console.error(`[Worker] retry_tool_call: Tool "${functionName}" not found in available tools during retry.`);
    self.postMessage({
      status: "tool_retry_failed",
      data: { messageIndex, error: `Tool "${functionName}" not found.` }
    });
    return;
  }

  const serverUrlToReconnect = toolToRetry.serverUrl;
  //console.log(`[Worker] retry_tool_call: Forcing re-connection to ${serverUrlToReconnect} before retrying tool.`);
  
  if (managedMcpClients.has(serverUrlToReconnect)) {
    const clientState = managedMcpClients.get(serverUrlToReconnect);
    if (clientState && clientState.client && typeof clientState.client.close === 'function') {
        try {
            //console.log(`[Worker] retry_tool_call: Closing existing client for ${serverUrlToReconnect} before removing.`);
            await clientState.client.close(); 
        } catch (closeError) {
            console.warn(`[Worker] retry_tool_call: Error closing existing client for ${serverUrlToReconnect}:`, closeError);
        }
    }
    managedMcpClients.delete(serverUrlToReconnect);
    //console.log(`[Worker] retry_tool_call: Removed client for ${serverUrlToReconnect} from managedMcpClients.`);
  }

  try {
    const { success, error: connectError } = await addAndConnectMcpServer(serverUrlToReconnect);
    if (!success) {
      console.warn(`[Worker] retry_tool_call: Failed to re-establish connection to ${serverUrlToReconnect}: ${connectError?.message || 'Unknown connection error'}`);
    } else {
      //console.log(`[Worker] retry_tool_call: Connection to ${serverUrlToReconnect} confirmed/re-established.`);
    }
  } catch (e) {
    console.error(`[Worker] retry_tool_call: Error during explicit reconnect attempt for ${serverUrlToReconnect}:`, e);
  }
 
  const singleParsedCall = { name: functionName, arguments: args };
  const { toolResponseMessages, mcpErrorOccurred } = await executeAllToolCalls(
    [singleParsedCall], 
    localMcpToolsArrayForRetry, 
    managedMcpClients, 
    self.postMessage
  );

  const toolResponseMessage = toolResponseMessages[0];
  let retryExecutionSuccess = !mcpErrorOccurred;

  let updatedMessagesSnapshot = [...messagesSnapshot, toolResponseMessage];
  //console.log("[Worker] retry_tool_call: Tool response message from retry pushed to snapshot:", JSON.stringify(toolResponseMessage, null, 2));

  if (retryExecutionSuccess) {
    self.postMessage({
      status: "tool_retry_execution_success_generating_response", 
      data: { messageIndex } 
    });

    //console.log("[Worker] retry_tool_call: Tool retry successful, now calling generate() with updated history.");
    await generate({
      messages: updatedMessagesSnapshot, 
      reasonEnabled,
      mcpServerUrls, 
      maxThinkingBudget
    });
  } else {
    self.postMessage({
      status: "tool_retry_failed",
      data: { messageIndex, error: (toolResponseMessage && toolResponseMessage.content && JSON.parse(toolResponseMessage.content).error) || "Tool retry execution failed." }
    });
  }
}
