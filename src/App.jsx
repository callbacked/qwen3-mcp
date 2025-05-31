import { useEffect, useState, useRef } from "react";
import "./App.css";

import Chat from "./components/Chat";
import ArrowUpIcon from "./components/icons/ArrowUpIcon";
import StopIcon from "./components/icons/StopIcon";
import Progress from "./components/Progress";
import ToolIcon from "./components/icons/ToolIcon";
import McpToolDrawer from "./components/McpToolDrawer";
import ReasoningBudgetButton from "./components/ReasoningBudgetButton";

const IS_WEBGPU_AVAILABLE = !!navigator.gpu;
const STICKY_SCROLL_THRESHOLD = 120;
const LOCALSTORAGE_MCP_SERVERS_KEY = "mcpServerUrls";
const MAX_TOOL_SCHEMA_TOKENS = 3000;

function App() {
  const worker = useRef(null);
  const textareaRef = useRef(null);
  const chatContainerRef = useRef(null);

  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loadingMessage, setLoadingMessage] = useState("");
  const [progressItems, setProgressItems] = useState([]);
  const [isRunning, setIsRunning] = useState(false);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [tps, setTps] = useState(null);
  const [numTokens, setNumTokens] = useState(null);
  const [reasonEnabled, setReasonEnabled] = useState(false);
  const [thinkingBudget, setThinkingBudget] = useState(() => {
    const saved = localStorage.getItem('thinkingBudget');
    return saved ? parseInt(saved) : 1024;
  });
  
  const [mcpServerUrls, setMcpServerUrls] = useState(() => {
    const savedUrls = localStorage.getItem(LOCALSTORAGE_MCP_SERVERS_KEY);
    //console.log("[App.jsx] Loading mcpServerUrls from localStorage content:", savedUrls);
    if (savedUrls) {
      try {
        const parsed = JSON.parse(savedUrls);
        const loadedResult = parsed.map(item => {
          if (typeof item === 'string') {
            const serverConfig = { url: item, status: "pending", error: null, toolsCount: 0, isEnabled: true, tools: [] };
            //console.log(`[App.jsx] Loaded server config (from string URL) for ${item}:`, JSON.parse(JSON.stringify(serverConfig)));
            return serverConfig;
          } else {
            const serverConfig = { 
              url: item.url, 
              status: item.status || "pending", 
              error: item.error || null, 
              toolsCount: item.toolsCount || 0, 
              isEnabled: item.isEnabled !== undefined ? item.isEnabled : true, 
              tools: item.tools || []
            };
            //console.log(`[App.jsx] Loaded server config for ${item.url}:`, JSON.parse(JSON.stringify(serverConfig)));
            return serverConfig;
          }
        });
        return loadedResult;
      } catch (e) {
        console.error("Failed to parse MCP servers from localStorage:", e);
        return [];
      }
    }
    return [];
  });
  const [isMcpToolDrawerOpen, setIsMcpToolDrawerOpen] = useState(false);
  const [modelInfo, setModelInfo] = useState({ name: "", url: null });
  const [currentToolSchemaTokens, setCurrentToolSchemaTokens] = useState(0);
  const [isToolSchemaOverLimit, setIsToolSchemaOverLimit] = useState(false);

  const getServerToolsData = () => {
    const toolsData = {};
    mcpServerUrls.forEach(server => {
      if (server.status === 'connected' && server.tools && server.tools.length > 0) { 
        toolsData[server.url] = server.tools;
      }
    });
    return toolsData;
  };

  useEffect(() => {
    //console.log("[App.jsx] Attempting to save mcpServerUrls to localStorage. Current state:", JSON.parse(JSON.stringify(mcpServerUrls)));
    localStorage.setItem(LOCALSTORAGE_MCP_SERVERS_KEY, JSON.stringify(mcpServerUrls));
  }, [mcpServerUrls]);

  useEffect(() => {
    localStorage.setItem('thinkingBudget', thinkingBudget.toString());
  }, [thinkingBudget]);

  const onEnter = (currentInput) => {
    if (!currentInput.trim() || status !== "ready" || isRunning || isToolSchemaOverLimit) {
      return;
    }
    setIsRunning(true);
    setMessages((prev) => [...prev, { role: "user", content: currentInput.trim() }]);
    setInput("");
  };

  useEffect(() => {
    if (!worker.current) {
      //console.log("[App.jsx] Initializing worker...");
      worker.current = new Worker(new URL("./worker.js", import.meta.url), {
        type: "module",
      });
      worker.current.postMessage({ type: "check" });
      
      const initialUrlsToConnect = mcpServerUrls
        .filter(s => s.isEnabled)
        .map(s => s.url);

      if (initialUrlsToConnect.length > 0) {
         //console.log("[App.jsx] Sending initialize_mcp_servers to worker with:", initialUrlsToConnect);
         worker.current.postMessage({ type: "initialize_mcp_servers", data: { urls: initialUrlsToConnect } });
      }
    }

    if (worker.current && status === null) {
      //console.log("[App.jsx] Auto-loading model...");
      worker.current.postMessage({ type: "load" });
      setStatus("loading");
      setError(null);
    }
  }, [mcpServerUrls, status]);

  useEffect(() => {
    if (worker.current && status === "ready") {
      //console.log("[App.jsx] mcpServerUrls changed, sending update_tool_configs_and_recalculate_tokens to worker.");
      worker.current.postMessage({
        type: "update_tool_configs_and_recalculate_tokens",
        data: { allServerConfigsFromApp: mcpServerUrls }
      });
    }
  }, [mcpServerUrls, status]);

  useEffect(() => {
    if (!worker.current) {
      //console.log("[App.jsx] Worker not available yet for attaching listeners.");
      return;
    }
    //console.log("[App.jsx] Attaching message listeners to worker.");

    const onMessageReceived = (e) => {
      const type = e.data.type;
      const status = e.data.status;

      if (type === "model_loaded_info") {
        setModelInfo(e.data.data);
        return;
      }

      if (type === "tool_schema_token_update") {
        const { currentToolSchemaTokens: tokens, error } = e.data.data;
        if (error) {
          console.error("[App.jsx] Worker reported error calculating tool schema tokens:", error);
          setCurrentToolSchemaTokens(0); 
          setIsToolSchemaOverLimit(false);
        } else {
          setCurrentToolSchemaTokens(tokens || 0);
          setIsToolSchemaOverLimit((tokens || 0) > MAX_TOOL_SCHEMA_TOKENS);
        }
        return;
      }

      if (type === "mcp_server_status") {
        const { url, success, error, tools: workerProvidedTools, toolsCount: workerToolsCount } = e.data.data; 

        setMcpServerUrls(prevUrls => {
          return prevUrls.map(serverInState => {
            if (serverInState.url === url) { 
              if (success) { 
                //console.log(`[App.jsx] mcp_server_status for ${url}: serverInState.tools before merge:`, JSON.parse(JSON.stringify(serverInState.tools || [])));
                //console.log(`[App.jsx] mcp_server_status for ${url}: workerProvidedTools:`, JSON.parse(JSON.stringify(workerProvidedTools || [])));
                const mergedTools = (workerProvidedTools || []).map(canonicalToolFromWorker => {
                  const persistedToolSettings = (serverInState.tools || []).find(pt => pt.name === canonicalToolFromWorker.name);
                  const mergedIsEnabled = persistedToolSettings?.isEnabled !== undefined
                                          ? persistedToolSettings.isEnabled
                                          : canonicalToolFromWorker.isEnabled;
                  const mergedShowDescription = persistedToolSettings?.showDescription !== undefined
                                          ? persistedToolSettings.showDescription
                                          : canonicalToolFromWorker.showDescription;

                  if (worker.current) {
                    if (mergedIsEnabled !== canonicalToolFromWorker.isEnabled) {
                      worker.current.postMessage({ type: "toggle_tool", data: { serverUrl: url, toolName: canonicalToolFromWorker.name, isEnabled: mergedIsEnabled }});
                    }
                    if (mergedShowDescription !== canonicalToolFromWorker.showDescription) {
                      worker.current.postMessage({ type: "toggle_tool_description", data: { serverUrl: url, toolName: canonicalToolFromWorker.name }});
                    }
                  }
                  return { ...canonicalToolFromWorker, isEnabled: mergedIsEnabled, showDescription: mergedShowDescription };
                });
                //console.log(`[App.jsx] mcp_server_status for ${url}: mergedTools after merge:`, JSON.parse(JSON.stringify(mergedTools)));
                return {
                  ...serverInState,
                  status: "connected",
                  error: null,
                  tools: mergedTools,
                  toolsCount: mergedTools.length,
                };
              } else {
                //console.log(`[App.jsx] MCP Server connection failed for ${url}. Setting status to error. Error: ${error}`);
                return {
                  ...serverInState, 
                  status: "error",
                  error: error || 'Unknown connection error from worker',
                  tools: serverInState.tools || [],
                  toolsCount: (serverInState.tools || []).length,
                };
              }
            }
            return serverInState;
          });
        });
        return; // Handled
      }

      if (status === "tool_retry_execution_success_generating_response") {
        const { messageIndex } = e.data.data;
        setMessages(prev => {
          const newMessages = [...prev];
          if (newMessages[messageIndex]) {
            const updatedMsg = { ...newMessages[messageIndex] };
            updatedMsg.isRetrying = false;
            updatedMsg.isToolCallFailure = false;
            updatedMsg.toolErrorDetails = null;
            updatedMsg.toolRetryFailed = false;
            updatedMsg.toolRetrySuccess = true;

            newMessages[messageIndex] = updatedMsg;

            newMessages[messageIndex] = updatedMsg;
          }
          return newMessages;
        });
        return; 
      }
      
      if (status === "tool_retry_failed") {
        const { messageIndex, error } = e.data.data;
        setMessages(prev => {
          const newMessages = [...prev];
          if (newMessages[messageIndex]) {
            const updatedMsg = { ...newMessages[messageIndex] };
            updatedMsg.isRetrying = false;
            updatedMsg.toolRetryFailed = true;
            if (updatedMsg.toolErrorDetails) {
                updatedMsg.toolErrorDetails.errorMessage = `Retry failed: ${error}`;
            } else {
                updatedMsg.toolErrorDetails = { errorMessage: `Retry failed: ${error}` };
            }
            newMessages[messageIndex] = updatedMsg;
          }
          return newMessages;
        });
        setIsRunning(false);
        return;
      }

      switch (status) {
        case "loading":
          setStatus("loading");
          setLoadingMessage(e.data.data);
          break;
        case "initiate":
          setProgressItems((prev) => [...prev, e.data]);
          break;
        case "progress":
          setProgressItems((prev) =>
            prev.map((item) => {
              if (item.file === e.data.file) return { ...item, ...e.data };
              return item;
            }),
          );
          break;
        case "done":
          setProgressItems((prev) => prev.filter((item) => item.file !== e.data.file));
          break;
        case "ready":
          setStatus("ready");
          break;
        case "start":
          setMessages((prev) => [...prev, { role: "assistant", content: "" }]);
          break;
        case "update":
          {
            const { output, tps, numTokens, state, toolCallInProgress, isDefinitivelyToolCall } = e.data;
            setTps(tps);
            setNumTokens(numTokens);
            setMessages((prev) => {
              const cloned = [...prev];
              if (cloned.length === 0) return prev;

              const last = { ...cloned.at(-1) };

              if (isDefinitivelyToolCall) {
                last.isUsingTool = true;
              } else if (output) {
                last.content += output;
                last.isUsingTool = toolCallInProgress || false;
              }
              
              if (reasonEnabled) {
                const thinkStartTag = "<think>";
                const thinkEndTag = "</think>";
                const thinkStartIndexVal = last.content.indexOf(thinkStartTag);
                const thinkEndIndexVal = last.content.indexOf(thinkEndTag);

                if (thinkStartIndexVal !== -1 && thinkEndIndexVal !== -1 && thinkEndIndexVal > thinkStartIndexVal) {
                  last.answerIndex = thinkEndIndexVal + thinkEndTag.length;
                  ////console.log(`[App.jsx] Tags parsed: <think> at ${thinkStartIndexVal}, </think> at ${thinkEndIndexVal}. Setting answerIndex to: ${last.answerIndex}`);
                } else if (thinkStartIndexVal !== -1) {
                  last.answerIndex = undefined; 
                  ////console.log(`[App.jsx] <think> found at ${thinkStartIndexVal}, but </think> is missing or misplaced. answerIndex remains undefined for now.`);
                } else {
                  last.answerIndex = 0;
                  ////console.log(`[App.jsx] reasonEnabled is true, but no <think> tag found. Setting answerIndex to 0.`);
                }
              } else {
                last.answerIndex = 0;
                ////console.log(`[App.jsx] reasonEnabled is false. Setting answerIndex to 0.`);
              }

              cloned[cloned.length - 1] = last;
              return cloned;
            });
          }
          break;
        case "complete":
          setIsRunning(false);
          break;
        case "error": 
          setError(e.data.data);
          setIsRunning(false);
          break;
        case "tool_execution_error":
          {
            //console.log("[App.jsx] onMessageReceived: Worker sent 'tool_execution_error':", e.data);
            const { errorDetails } = e.data; 
            setMessages((prev) => {
              const cloned = [...prev];
              
              let lastAssistantMessageIndex = -1;
              for (let i = cloned.length - 1; i >= 0; i--) {
                if (cloned[i].role === 'assistant') {
                  lastAssistantMessageIndex = i;
                  break;
                }
              }

              if (lastAssistantMessageIndex !== -1) {
                const assistantMsgToUpdate = { ...cloned[lastAssistantMessageIndex] };
                assistantMsgToUpdate.toolRetryFailed = true;
                assistantMsgToUpdate.isToolCallFailure = true;
                assistantMsgToUpdate.toolErrorDetails = {
                    functionName: errorDetails.functionName,
                    errorMessage: errorDetails.errorMessage
                };
                assistantMsgToUpdate.isRetrying = false;
                cloned[lastAssistantMessageIndex] = assistantMsgToUpdate;
                //console.log(`[App.jsx] Marked assistant message at index ${lastAssistantMessageIndex} for retry:`, assistantMsgToUpdate);
              } else {
                console.warn("[App.jsx] tool_execution_error: Could not find a preceding assistant message to mark for retry.");
              }
              return cloned;
            });
            setIsRunning(false);
          }
          break;
        default:
          break;
      }
    };

    const onErrorReceived = (e) => {
      console.error("Worker error:", e);
      setError("A worker error occurred. Check console.");
      setIsRunning(false);
    };

    worker.current.addEventListener("message", onMessageReceived);
    worker.current.addEventListener("error", onErrorReceived);

    return () => {
      worker.current.removeEventListener("message", onMessageReceived);
      worker.current.removeEventListener("error", onErrorReceived);
    };
  }, [reasonEnabled, mcpServerUrls]);

  useEffect(() => {
    if (messages.filter((x) => x.role === "user").length === 0) return;
    if (messages.at(-1).role === "assistant") return;
    
    setTps(null);
    const activeMcpServers = mcpServerUrls.filter(s => s.isEnabled).map(s => s.url);
    worker.current.postMessage({
      type: "generate",
      data: { messages, reasonEnabled, mcpServerUrls: activeMcpServers, maxThinkingBudget: reasonEnabled ? thinkingBudget : undefined },
    });
  }, [messages, isRunning, reasonEnabled, mcpServerUrls, thinkingBudget]);

  useEffect(() => {
    if (!chatContainerRef.current || !isRunning) return;
    const element = chatContainerRef.current;
    if (
      element.scrollHeight - element.scrollTop - element.clientHeight <
      STICKY_SCROLL_THRESHOLD
    ) {
      element.scrollTop = element.scrollHeight;
    }
  }, [messages, isRunning]);

  const handleAddMcpServer = (urlToAdd) => {
    if (!mcpServerUrls.find(s => s.url === urlToAdd)) {
      setMcpServerUrls(prev => [...prev, { 
        url: urlToAdd, 
        status: 'connecting', 
        error: null, 
        toolsCount: 0, 
        isEnabled: true,
        tools: []
      }]);
      worker.current.postMessage({ type: "add_mcp_server", data: { url: urlToAdd } });
    } else {
      const existingServer = mcpServerUrls.find(s => s.url === urlToAdd);
      if (existingServer && existingServer.status === 'error') {
        handleForceReconnectMcpServer(urlToAdd);
      } else {
        //console.log(`URL ${urlToAdd} already exists and is not in error state or is connecting: ${existingServer?.status}`);
      }
    }
  };

  const handleRemoveMcpServer = (urlToRemove) => {
    const updatedUrls = mcpServerUrls.filter(server => server.url !== urlToRemove);
    setMcpServerUrls(updatedUrls);
    const activeUrlsForWorker = updatedUrls.filter(s => s.isEnabled).map(s => s.url);
    worker.current.postMessage({ type: "synchronize_mcp_servers", data: { urls: activeUrlsForWorker } });
  };

  const handleForceReconnectMcpServer = (urlToReconnect) => {
    setMcpServerUrls(prev => prev.map(s => 
      s.url === urlToReconnect 
        ? { ...s, status: 'connecting', error: null, isEnabled: true, tools: [], toolsCount: 0 }
        : s
    ));
    worker.current.postMessage({ type: "add_mcp_server", data: { url: urlToReconnect } });
  };

  const handleToggleMcpServer = (urlToToggle) => {
    setMcpServerUrls(prevUrls => 
      prevUrls.map(server => 
        server.url === urlToToggle 
          ? { ...server, isEnabled: !server.isEnabled } 
          : server
      )
    );
  };

  const handleToggleTool = (serverUrl, toolName, forceEnabled) => {
    const serverIndex = mcpServerUrls.findIndex(server => server.url === serverUrl);
    if (serverIndex === -1) return;

    const updatedMcpServerUrls = [...mcpServerUrls];
    const server = updatedMcpServerUrls[serverIndex];
    
    const tools = getServerToolsData()[serverUrl];
    if (!tools) return;

    const toolIndex = tools.findIndex(tool => tool.name === toolName);
    if (toolIndex === -1) return;

    const updatedTools = [...tools];
    
    const newEnabledState = forceEnabled !== undefined 
      ? forceEnabled 
      : !updatedTools[toolIndex].isEnabled;
      
    updatedTools[toolIndex] = {
      ...updatedTools[toolIndex],
      isEnabled: newEnabledState
    };

    worker.current.postMessage({
      type: "toggle_tool",
      data: { 
        serverUrl, 
        toolName,
        isEnabled: newEnabledState
      }
    });

    setMcpServerUrls(prevUrls => {
      const serverIdx = prevUrls.findIndex(s => s.url === serverUrl);
      if (serverIdx === -1) return prevUrls;

      const updatedUrls = [...prevUrls];
      const serverData = {...updatedUrls[serverIdx]};
      
      if (serverData.tools && Array.isArray(serverData.tools)) {
        const toolIdx = serverData.tools.findIndex(t => t.name === toolName);
        if (toolIdx !== -1) {
          serverData.tools = [...serverData.tools];
          serverData.tools[toolIdx] = {
            ...serverData.tools[toolIdx],
            isEnabled: newEnabledState
          };
          updatedUrls[serverIdx] = serverData;
        }
      }
      
      return updatedUrls;
    });
  };

  const handleToggleToolDescription = (serverUrl, toolName) => {
    const serverIndex = mcpServerUrls.findIndex(server => server.url === serverUrl);
    if (serverIndex === -1) return;

    worker.current.postMessage({
      type: "toggle_tool_description",
      data: { 
        serverUrl, 
        toolName 
      }
    });

    setMcpServerUrls(prevUrls => {
      const serverIdx = prevUrls.findIndex(s => s.url === serverUrl);
      if (serverIdx === -1) return prevUrls;

      const updatedUrls = [...prevUrls];
      const serverData = {...updatedUrls[serverIdx]};
      
      if (serverData.tools && Array.isArray(serverData.tools)) {
        const toolIdx = serverData.tools.findIndex(t => t.name === toolName);
        if (toolIdx !== -1) {
          serverData.tools = [...serverData.tools];
          serverData.tools[toolIdx] = {
            ...serverData.tools[toolIdx],
            showDescription: !serverData.tools[toolIdx].showDescription
          };
          updatedUrls[serverIdx] = serverData;
        }
      }
      
      return updatedUrls;
    });
  };

  const onInterrupt = () => {
    if (worker.current) {
      worker.current.postMessage({ type: "interrupt" });
      setIsRunning(false);
      setMessages(prev => {
        const newMessages = [...prev];
        if (newMessages.length > 0 && newMessages.at(-1).role === "assistant") {
          const lastMsg = { ...newMessages.at(-1) };
          lastMsg.content += " [Interrupted]";
          lastMsg.isUsingTool = false; 
          newMessages[newMessages.length -1] = lastMsg;
          return newMessages;
        }
        return prev;
      });
    }
  };

  const retryFailedToolCall = (messageIndex, failedMessage) => {
    if (!worker.current || !failedMessage) return;
    const assistantMessageContent = failedMessage.content || "";
    const toolCallRegex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
    let firstToolCallMatch = toolCallRegex.exec(assistantMessageContent);

    if (!firstToolCallMatch || !firstToolCallMatch[1]) {
      console.error("[App.jsx] retryFailedToolCall: Could not parse <tool_call> from message content:", assistantMessageContent);
      setMessages(prev => prev.map((msg, idx) => 
        idx === messageIndex ? { ...msg, toolRetryFailed: true, isRetrying: false, toolErrorDetails: { ...(msg.toolErrorDetails || {}), errorMessage: "Could not parse original tool call for retry." } } : msg
      ));
      return;
    }

    let callJson;
    let functionName;
    let args;

    try {
      callJson = JSON.parse(firstToolCallMatch[1]);
      functionName = callJson.name;
      args = callJson.arguments;
      if (typeof args === 'string') {
        args = JSON.parse(args);
      }
    } catch (e) {
      console.error("[App.jsx] retryFailedToolCall: Failed to parse JSON from tool_call for retry:", firstToolCallMatch[1], e);
      setMessages(prev => prev.map((msg, idx) => 
        idx === messageIndex ? { ...msg, toolRetryFailed: true, isRetrying: false, toolErrorDetails: { ...(msg.toolErrorDetails || {}), errorMessage: "Failed to parse tool call arguments for retry." } } : msg
      ));
      return;
    }

    if (!functionName) {
      console.error("[App.jsx] retryFailedToolCall: No function name found in parsed tool_call.");
      setMessages(prev => prev.map((msg, idx) => 
        idx === messageIndex ? { ...msg, toolRetryFailed: true, isRetrying: false, toolErrorDetails: { ...(msg.toolErrorDetails || {}), errorMessage: "Function name missing in tool call for retry." } } : msg
      ));
      return;
    }

    //console.log(`[App.jsx] Retrying tool call: ${functionName} with args:`, args);
    
    setMessages(prev => {
      const newMessages = [...prev];
      if (newMessages[messageIndex]) {
        const updatedMsg = { ...newMessages[messageIndex] };
        updatedMsg.isRetrying = true;
        updatedMsg.toolRetryFailed = false; 
        updatedMsg.isToolCallFailure = false;
        updatedMsg.toolErrorDetails = null;
        newMessages[messageIndex] = updatedMsg;
      }
      return newMessages;
    });
    
    const activeMcpServers = mcpServerUrls.filter(s => s.isEnabled).map(s => s.url);
    const messagesSnapshot = messages.slice(0, messageIndex + 1);
    
    setIsRunning(true);
    worker.current.postMessage({
      type: "retry_tool_call",
      data: {
        messageIndex, 
        functionName, 
        args,         
        originalFailedMessageContent: failedMessage.content, 
        messagesSnapshot, 
        mcpServerUrls: activeMcpServers,
        reasonEnabled: reasonEnabled,
        maxThinkingBudget: thinkingBudget
      }
    });
  };

  const connectedServersCount = mcpServerUrls.filter(s => s.status === 'connected' && s.isEnabled).length;

  return IS_WEBGPU_AVAILABLE ? (
    <div className="flex flex-col h-screen mx-auto items-center justify-end text-gray-800 dark:text-gray-200 bg-neutral-100 dark:bg-neutral-900">
      {status === "loading" || (status === null && messages.length === 0) ? (
        <div className="h-full w-full flex flex-col justify-center items-center p-4">
          <div className="w-full max-w-md text-center space-y-6">
            {error && (
              <div className="text-red-500 text-center p-3 bg-red-100 dark:bg-red-800 dark:text-red-300 rounded-lg shadow-md">
                <p className="mb-1 font-semibold text-lg">Loading Error</p>
                <p className="text-sm">{error}</p>
              </div>
            )}
            <p className="text-xl font-semibold text-gray-700 dark:text-gray-300 thinking-glow-sweep">
              {loadingMessage || "Initializing Model..."}
            </p>
            {progressItems.length > 0 && (
                <div className="space-y-3 pt-2">
                    {progressItems.map(({ file, progress, total }, i) => (
                        <Progress key={i} text={file} percentage={progress} total={total} />
                    ))}
                </div>
            )}
          </div>
        </div>
      ) : (
        <div ref={chatContainerRef} className="overflow-y-auto scrollbar-thin w-full flex flex-col items-center h-full pt-4">
          <Chat 
            messages={messages} 
            isRunning={isRunning} 
            onRetryFailedToolCall={retryFailedToolCall}
          />
        </div>
      )}

      {(status === 'ready' || (status !== 'loading' && status !== null)) && (
        <div className="w-[600px] max-w-[80%] mx-auto mt-2 mb-3 relative animate-fade-in-up">
          <McpToolDrawer 
            isOpen={isMcpToolDrawerOpen}
            onClose={() => setIsMcpToolDrawerOpen(false)}
            servers={mcpServerUrls}
            toolsData={getServerToolsData()}
            currentToolSchemaTokens={currentToolSchemaTokens}
            maxToolSchemaTokens={MAX_TOOL_SCHEMA_TOKENS}  
            isToolSchemaOverLimit={isToolSchemaOverLimit}
            onAddServer={handleAddMcpServer}
            onRemoveServer={handleRemoveMcpServer}
            onForceReconnect={handleForceReconnectMcpServer}
            onToggleServer={handleToggleMcpServer}
            onToggleTool={handleToggleTool}
            onToggleToolDescription={handleToggleToolDescription}
          />
          <div className={`input-area-wrapper border border-neutral-600 dark:border-neutral-700 bg-neutral-200 dark:bg-neutral-800 rounded-2xl max-h-[250px] relative flex flex-col ${isToolSchemaOverLimit ? 'fade-active' : ''}`}>
            <textarea 
              ref={textareaRef} 
              className="scrollbar-thin flex-grow pl-4 pr-16 py-4 rounded-2xl bg-transparent border-none outline-none text-gray-800 disabled:text-gray-400 dark:text-neutral-200 placeholder-neutral-600 dark:placeholder-neutral-400 disabled:placeholder-neutral-200 dark:disabled:placeholder-neutral-500 resize-none disabled:cursor-not-allowed min-h-[80px]"
              placeholder="What's on your mind?" 
              type="text" 
              rows={2} 
              value={input} 
              disabled={status !== "ready" || isRunning || isToolSchemaOverLimit} 
              title={status === "ready" 
                       ? (isRunning 
                           ? "Model is generating..." 
                           : (isToolSchemaOverLimit 
                               ? `Tool schema too large (${currentToolSchemaTokens}/${MAX_TOOL_SCHEMA_TOKENS}). Disable tools/descriptions.` 
                               : "Model is ready")) 
                       : "Model not loaded yet"} 
              onKeyDown={(e) => { if (input.length > 0 && !isRunning && !isToolSchemaOverLimit && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onEnter(input); }}} 
              onInput={(e) => setInput(e.target.value)} 
            />

            {isRunning ? (
              <div className="cursor-pointer absolute right-3 top-4 group" onClick={onInterrupt}>
                <StopIcon className="h-8 w-8 p-1 rounded-md text-gray-800 dark:text-gray-100 transition-all duration-200 group-hover:text-red-500 dark:group-hover:text-red-300 group-hover:filter group-hover:brightness-125" />
              </div>
            ) : input.length > 0 ? (
              <div className="cursor-pointer absolute right-3 top-4 group" onClick={() => onEnter(input)}>
                <ArrowUpIcon className={`h-8 w-8 p-1 bg-neutral-700 dark:bg-neutral-300 text-white dark:text-neutral-900 rounded-md transition-all duration-200 group-hover:bg-neutral-600 dark:group-hover:bg-neutral-400 group-hover:filter group-hover:brightness-110`} />
              </div>
            ) : (
              <div className="absolute right-3 top-4">
                <ArrowUpIcon className={`h-8 w-8 p-1 bg-neutral-300 dark:bg-neutral-700 text-gray-50 dark:text-neutral-800 rounded-md`} />
              </div>
            )}
            
            <div className="flex items-center justify-between px-3 py-2 border-t border-neutral-300 dark:border-neutral-600">
              <div className="flex items-center space-x-2">
                <button 
                  onClick={() => setIsMcpToolDrawerOpen(!isMcpToolDrawerOpen)} 
                  className={`p-1.5 rounded-md transition-colors relative group ${isMcpToolDrawerOpen ? 'bg-neutral-600' : 'hover:bg-neutral-200 dark:hover:bg-neutral-700'}`}
                  title="Manage Tool Connections"
                  disabled={status !== "ready"}
                >
                  <ToolIcon className={`h-5 w-5 transition-all duration-200 ${isToolSchemaOverLimit ? 'text-red-500 dark:text-red-400' : (isMcpToolDrawerOpen ? 'text-white' : 'text-neutral-500 dark:text-neutral-300 group-hover:text-neutral-700 dark:group-hover:text-neutral-100')}`} />
                  { (isToolSchemaOverLimit || connectedServersCount > 0) && (
                    <span className={`absolute -top-1 -right-1 text-[10px] rounded-full h-4 w-4 flex items-center justify-center 
                      ${isToolSchemaOverLimit 
                        ? 'bg-white text-red-500 font-bold'
                        : 'bg-neutral-500 text-white'}`}
                    >
                      {isToolSchemaOverLimit ? '!' : connectedServersCount}
                    </span>
                  )}
                </button>
                <ReasoningBudgetButton
                  reasonEnabled={reasonEnabled}
                  onToggleReason={() => setReasonEnabled((prev) => !prev)}
                  thinkingBudget={thinkingBudget}
                  onBudgetChange={setThinkingBudget}
                  min={50}
                  max={16384}
                  step={50}
                  />
              </div>
              
              {modelInfo.url ? (
                <a 
                  href={modelInfo.url} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="text-sm text-neutral-500 dark:text-neutral-300 hover:text-neutral-700 dark:hover:text-neutral-100 hover:underline"
                  title={`View ${modelInfo.name} on Hugging Face`}
                >
                  {modelInfo.name}
                </a>
              ) : (
                <div className="text-sm text-neutral-500 dark:text-neutral-300">
                  {modelInfo.name}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <p className="text-xs text-gray-400 text-center mb-3">
        Disclaimer: Generated content may be inaccurate or false.
      </p>
    </div>
  ) : (
    <div className="fixed w-screen h-screen bg-black z-10 bg-opacity-[92%] text-white text-2xl font-semibold flex justify-center items-center text-center">
      WebGPU is not supported by this browser :&#40;
    </div>
  );
}

export default App;
