import { useState, useEffect, useRef, useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";

import BrainIcon from "./icons/BrainIcon";
import ToolIcon from "./icons/ToolIcon";

import { MathJaxContext, MathJax } from "better-react-mathjax";
import "./Chat.css";

function render(text) {
  text = text.replace(/\\([\[\]\(\)])/g, "\\\\$1");

  const result = DOMPurify.sanitize(
    marked.parse(text, {
      async: false,
      breaks: true,
    }),
  );
  return result;
}


function parseToolCalls(content) {
  if (!content) return [];
  const toolCallRegex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/g;
  const calls = [];
  let match;
  while ((match = toolCallRegex.exec(content)) !== null) {
    try {
      const callJson = JSON.parse(match[1]);
      if (callJson.name && callJson.arguments !== undefined) {
        calls.push({ 
          name: callJson.name, 
          arguments: typeof callJson.arguments === 'string' ? callJson.arguments : JSON.stringify(callJson.arguments, null, 2),
          raw: match[0] // The full <tool_call>...</tool_call> string
        });
      }
    } catch (e) {
      console.warn("Failed to parse JSON from <tool_call> content:", match[1], e);
      // Optionally push a representation of the parse error or the raw malformed call
      calls.push({ name: "Malformed Tool Call", arguments: match[1], raw: match[0], error: true });
    }
  }
  return calls;
}

function getNonToolCallContent(content, parsedToolCalls, isStreaming) {
  if (!content) return "";
  let nonToolContent = content;
  for (const call of parsedToolCalls) {
    nonToolContent = nonToolContent.replace(call.raw, "");
  }

  if (isStreaming) {
    const openTagIndex = nonToolContent.indexOf("<tool_call>");
    if (openTagIndex !== -1) {
      // If an opening <tool_call> is present, we assume everything from there onwards is part of a tool call
      // that is currently being streamed. We only display content *before* this potential partial tool call.
      // This is a simplification: it doesn't wait for </tool_call>. It hides as soon as <tool_call> appears.
      // The full, parsed tool call will be rendered by the `parsedToolCalls.map` logic once complete.
      nonToolContent = nonToolContent.substring(0, openTagIndex);
    }
  }
  return nonToolContent.trim(); 
}

function Message({ role, content, name, isStreamingActiveForThisMessage = false, onRetryFailedToolCall, isRetrying, toolRetryFailed, toolErrorDetails /* This prop might be deprecated if error is in role:tool content */ }) {
  const [showThinking, setShowThinking] = useState(false);
  const [showRawToolDetails, setShowRawToolDetails] = useState({}); 
  const [showToolErrorDetails, setShowToolErrorDetails] = useState(false); 
  const [thinkingTime, setThinkingTime] = useState(null);
  const thinkingStartTimeRef = useRef(null);
  const wasThinkingActiveRef = useRef(false);
  const [isAnimationComplete, setIsAnimationComplete] = useState(false);
  const animationTimerRef = useRef(null);
  const thinkingScrollRef = useRef(null);
  const [shakeKey, setShakeKey] = useState(0);

  useEffect(() => {
    if (toolRetryFailed && role === "assistant") { 
      setShakeKey(prevKey => prevKey + 1);
    }
  }, [toolRetryFailed, role]);

  const currentContent = content || "";

  // 1. Parse Thinking Block
  let thinkingMonologue = "";
  let contentAfterThinking = currentContent;
  const thinkTagStart = "<think>";
  const thinkTagEnd = "</think>";
  const thinkStartIndex = currentContent.indexOf(thinkTagStart);
  const thinkEndIndex = currentContent.indexOf(thinkTagEnd);

  if (thinkStartIndex !== -1 && thinkEndIndex !== -1 && thinkEndIndex > thinkStartIndex) {
    thinkingMonologue = currentContent.substring(thinkStartIndex + thinkTagStart.length, thinkEndIndex).trim();
    contentAfterThinking = currentContent.substring(thinkEndIndex + thinkTagEnd.length);
  } else if (thinkStartIndex !== -1) {
    thinkingMonologue = currentContent.substring(thinkStartIndex + thinkTagStart.length).trim();
    contentAfterThinking = ""; 
  }
  const hasThinkingToShow = thinkingMonologue.length > 0;
  const isThinkingActive = hasThinkingToShow && (thinkStartIndex !== -1 && !(thinkEndIndex !== -1 && thinkEndIndex > thinkStartIndex));
  const isThinkingComplete = hasThinkingToShow && (thinkStartIndex !== -1 && thinkEndIndex !== -1 && thinkEndIndex > thinkStartIndex);

  useEffect(() => {
    if (hasThinkingToShow) {
      if (isThinkingActive) {
        if (!wasThinkingActiveRef.current) {
          thinkingStartTimeRef.current = new Date();
          wasThinkingActiveRef.current = true;
        }
        setShowThinking(true);
      } else if (isThinkingComplete && wasThinkingActiveRef.current) {
        const thinkingEndTime = new Date();
        const durationSeconds = Math.round((thinkingEndTime - thinkingStartTimeRef.current) / 1000);
        setThinkingTime(durationSeconds);
        setShowThinking(false);
        wasThinkingActiveRef.current = false;
      }
    }
  }, [hasThinkingToShow, isThinkingActive, isThinkingComplete]);

  // 2. Parse Tool Calls and remaining LLM response
  let parsedToolCalls = [];
  let finalLlmResponseAfterTools = "";
  if (role === "assistant") {
    parsedToolCalls = parseToolCalls(contentAfterThinking);
    finalLlmResponseAfterTools = getNonToolCallContent(contentAfterThinking, parsedToolCalls, isStreamingActiveForThisMessage).trim();
  }
  const hasToolCallsToShow = parsedToolCalls.length > 0;
  const hasFinalLlmResponseToShow = finalLlmResponseAfterTools.length > 0;

  // 3. Parse content for tool results
  let toolResultIsError = false;
  let toolResultMessage = "";
  let toolResultData = {}; 

  if (role === "tool") {
    try {
      const parsedToolContent = JSON.parse(currentContent);
      if (parsedToolContent.error) {
        toolResultIsError = true;
        toolResultMessage = parsedToolContent.error;
        if (parsedToolContent.details) {
          toolResultData.details = parsedToolContent.details;
        }
      } else {
        toolResultMessage = typeof parsedToolContent === 'string' ? parsedToolContent : JSON.stringify(parsedToolContent, null, 2);
      }
    } catch (e) {
      toolResultMessage = currentContent;
    }
  }


  const textToAnimate = role === "assistant" ? finalLlmResponseAfterTools : (role === "user" ? currentContent : "");
  useEffect(() => {
    if (animationTimerRef.current) clearTimeout(animationTimerRef.current);
    if (isStreamingActiveForThisMessage && role === "assistant") {
      setIsAnimationComplete(false);
    } else if (!isStreamingActiveForThisMessage && textToAnimate.length > 0 && role === "assistant"){
      const animationDurationMs = textToAnimate.length * 10 + 100;
      animationTimerRef.current = setTimeout(() => setIsAnimationComplete(true), animationDurationMs);
    } else {
      setIsAnimationComplete(true); 
    }
    return () => clearTimeout(animationTimerRef.current);
  }, [isStreamingActiveForThisMessage, textToAnimate, role]);

  useEffect(() => {
    if (showThinking && isThinkingActive && thinkingScrollRef.current) {
      thinkingScrollRef.current.scrollTop = thinkingScrollRef.current.scrollHeight;
    }
  }, [thinkingMonologue, showThinking, isThinkingActive]);

  const toggleShowRawToolDetails = (index) => {
    setShowRawToolDetails(prev => ({...prev, [index]: !prev[index]}));
  };

  if (role === "user" && isRetrying) { 
    
  }

  return (
    <div className={`flex gap-4 ${role === "tool" ? "ml-10" : ""}`}> {/* Indent tool messages */}
      {role === "assistant" ? (
        <div className="flex-1">
          <div className={`bg-transparent rounded-lg p-1 pt-0 ${isRetrying ? 'opacity-70' : ''}`}>
            {/*Thinking Monologue */}
            {hasThinkingToShow && (
              <div className="mb-3">
                <div
                  className="flex items-center gap-2 cursor-pointer" 
                  onClick={() => setShowThinking((prevShow) => {
                    if (!prevShow && isThinkingActive && thinkingScrollRef.current) { 
                      thinkingScrollRef.current.innerHTML = ""; 
                    }
                    return !prevShow;
                  })}
                >
                  <BrainIcon className={`h-4 w-4 text-gray-600 dark:text-gray-300 ${isThinkingActive ? "animate-pulse" : ""}`} />
                  <span className={`text-sm text-gray-700 dark:text-gray-300 ${isThinkingActive ? "thinking-glow-sweep" : ""}`}>
                    {isThinkingActive ? "Thinking..." : `${showThinking ? "Hide" : "Show"} thinking${thinkingTime && !showThinking ? ` (${thinkingTime}s)` : ""}`}
                  </span>
                </div>
                {showThinking && (
                  <div 
                    ref={thinkingScrollRef} 
                    className={`mt-2 text-gray-800 dark:text-gray-400 p-2 border-l-2 border-gray-300 dark:border-gray-700 pl-3 ${isThinkingActive ? "thinking-fade-container thinking-monologue-streaming" : "markdown"}`}
                  >
                    {isThinkingActive ? (
                      <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{thinkingMonologue}</div>
                    ) : (
                      <MathJax 
                        dynamic 
                        dangerouslySetInnerHTML={{ __html: render(thinkingMonologue) }} 
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* LLM Tool Calls */}
            {hasToolCallsToShow && parsedToolCalls.map((call, index) => (
              <div 
                key={index} 
                className="p-1 bg-neutral dark:bg-transparent rounded-lg inline-block max-w-full tool-call-fade-in"
              >
                <div className="flex items-center gap-2 cursor-pointer" onClick={() => toggleShowRawToolDetails(index)}>
                  <ToolIcon className={`h-4 w-4 text-gray-600 dark:text-neutral-100 ${isRetrying && index === parsedToolCalls.length -1 ? 'animate-pulse' : ''}`} />
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Tool Call: {call.name} 
                  </span>
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {showRawToolDetails[index] ? "(Hide)" : "(Show)"}
                  </span>
                </div>
                {showRawToolDetails[index] && (
                  <pre className="mt-1.5 p-2 bg-neutral-100 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-100 rounded text-xs overflow-x-auto scrollbar-thin">
                    {call.arguments}
                  </pre>
                )}
                {/* Retry */}
                <div className="min-h-[2em]"> 
                  {toolRetryFailed && !isRetrying && index === parsedToolCalls.length - 1 && onRetryFailedToolCall && (
                       <div key={`error-${shakeKey}`} className={`mt-2 ${toolRetryFailed ? 'tool-call-failed-shake' : ''}`}>
                          <button 
                              onClick={onRetryFailedToolCall} 
                              className="px-2 py-0.5 text-xs bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700/50 rounded hover:bg-red-100 dark:hover:bg-red-800/50 text-red-600 dark:text-red-300 transition-colors"
                          >
                             Retry Tool Call
                          </button>
                          {toolErrorDetails && toolErrorDetails.errorMessage && (
                              <span className="ml-2 text-xs text-red-500 dark:text-red-400">({toolErrorDetails.errorMessage})</span>
                          )}
                      </div>
                  )}
                </div>
              </div>
            ))}

            {/* Final LLM Response (after thinking and all tool calls) */}
            {hasFinalLlmResponseToShow && (
              <MathJax dynamic>
                {(isStreamingActiveForThisMessage || (!isAnimationComplete && role==="assistant")) ? (
                  <span className="markdown">
                    {[...finalLlmResponseAfterTools].map((char, idx) => (
                      char === '\n' ? <br key={`br-${idx}`} /> :
                      <span key={`char-${idx}`} className="token-char-animate" style={{ animationDelay: `${idx * 0.01}s` }}>{char}</span>
                    ))}
                  </span>
                ) : (
                  <span className="markdown" dangerouslySetInnerHTML={{ __html: render(finalLlmResponseAfterTools) }} />
                )}
              </MathJax>
            )}
          </div>
        </div>
      ) : role === "tool" ? (
        <>
          <ToolIcon className={`h-5 w-5 min-h-5 min-w-5 my-1 text-gray-500 dark:text-gray-400 ${toolResultIsError ? 'text-red-500 dark:text-red-400' : 'text-blue-500 dark:text-blue-400'}`} />
          <div className="flex-1">
            <div className={`rounded-lg p-3 text-xs ${toolResultIsError ? 'bg-red-100 dark:bg-red-900/30 border border-red-300 dark:border-red-700/50' : 'bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700/40'}`}>
              <div className={`font-medium mb-1 ${toolResultIsError ? 'text-red-700 dark:text-red-300' : 'text-blue-700 dark:text-blue-300'}`}>
                Tool Result: {name} {toolResultIsError ? "(Failed)" : "(Success)"}
                 <span 
                    className="ml-2 cursor-pointer hover:underline"
                    onClick={() => setShowToolErrorDetails(prev => !prev)} // Generic toggle for tool message details
                    >
                    {showToolErrorDetails ? "(hide details)" : "(show details)"}
                </span>
              </div>
              {showToolErrorDetails && (
                <pre className={`whitespace-pre-wrap scrollbar-thin overflow-x-auto p-2 rounded mt-1 ${toolResultIsError ? 'text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-800/30' : 'text-blue-600 dark:text-blue-300 bg-blue-50 dark:bg-blue-800/20'}`}>
                  {toolResultMessage}
                  {toolResultIsError && toolResultData.details && `\nDetails: ${toolResultData.details}`}
                </pre>
              )}
            </div>
          </div>
        </>
      ) : role === "user" ? (
        <>
          <div className="bg-neutral-300 dark:bg-neutral-700 text-gray-800 dark:text-gray-100 rounded-lg p-4 flex">
            <p className="min-h-6 overflow-wrap-anywhere">{currentContent}</p>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default function Chat({ messages, isRunning, isExecutingTool, onRetryFailedToolCall }) { 
  const empty = messages.length === 0;
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false);

  useEffect(() => {
    if (isExecutingTool) { 
      setShowLoadingIndicator(true);
      return;
    }

    if (!isRunning) {
      const timeout = setTimeout(() => {
        setShowLoadingIndicator(false);
      }, 300);
      return () => clearTimeout(timeout);
    }

    if (messages.length === 0) {
      setShowLoadingIndicator(false);
      return;
    }

    const lastMessage = messages[messages.length - 1];
    
    if (lastMessage.role === 'user' || lastMessage.role === 'tool') {
      setShowLoadingIndicator(true);
    } else if (lastMessage.role === 'assistant') {
      const hasStartedStreamingText = lastMessage.content && lastMessage.content.trim().length > 0;
      if (hasStartedStreamingText) {
        setShowLoadingIndicator(false);
      } else {
        setShowLoadingIndicator(true); 
      }
    } else {
      setShowLoadingIndicator(false);
    }
  }, [isRunning, messages, isExecutingTool]);

  return (
    <div
      className={`flex-1 p-6 max-w-[960px] w-full ${empty ? "flex flex-col items-center justify-end" : "space-y-4"}`}
    >
      <MathJaxContext>
        {empty ? (
          null
        ) : (
          <>
            {messages.map((msg, index) => {
              const isLastMessage = index === messages.length - 1;
              const isStreamingActiveForThisMessage = 
                msg.role === 'assistant' && 
                isLastMessage && 
                isRunning;

              const canRetryThisMessage = msg.role === 'assistant' && 
                                          msg.toolRetryFailed && 
                                          !msg.isRetrying && 
                                          onRetryFailedToolCall;

              return <Message 
                key={`message-${index}`} 
                {...msg}
                isStreamingActiveForThisMessage={isStreamingActiveForThisMessage}
                onRetryFailedToolCall={canRetryThisMessage ? () => onRetryFailedToolCall(index, msg) : undefined}
              />;
            })}

            {/* Loading indicator */}
            <div className={`flex items-center pl-3 space-x-2 mt-2 text-neutral-500 dark:text-neutral-400 transition-opacity duration-300 ease-in-out ${showLoadingIndicator ? 'opacity-100' : 'opacity-0 h-0 overflow-hidden'}`}>
              <div className="w-5 h-5">
                <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
              </div>
            </div>
          </>
        )}
      </MathJaxContext>
    </div>
  );
}
