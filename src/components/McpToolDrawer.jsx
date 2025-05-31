import { useState, useEffect, useRef } from 'react';
import ToolIcon from './icons/ToolIcon';
import ToggleSwitch from './ToggleSwitch';

const ChevronDownIcon = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
  </svg>
);

const ChevronUpIcon = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
  </svg>
);

const TrashIcon = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12.56 0c.342.052.682.107 1.022.166m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
  </svg>
);

const SearchIcon = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
  </svg>
);

const PlusIcon = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
  </svg>
);

const RefreshIcon = (props) => (
  <svg {...props} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
);

function McpToolDrawer({ isOpen, onClose, servers = [], toolsData = {}, onAddServer, onRemoveServer, onForceReconnect, onToggleServer, onToggleTool, onToggleToolDescription, currentToolSchemaTokens, maxToolSchemaTokens, isToolSchemaOverLimit }) {
  const [newUrl, setNewUrl] = useState('');
  const [activeTab, setActiveTab] = useState('servers');
  const [allExpanded, setAllExpanded] = useState(false);
  const [individualExpanded, setIndividualExpanded] = useState({});
  const [copiedUrl, setCopiedUrl] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const inputRef = useRef(null);
  const copyTimeoutRef = useRef(null);
  const searchInputRef = useRef(null);
  const prevServersRef = useRef(); 

  useEffect(() => {
    const prevServers = prevServersRef.current; 

    if (isOpen) {
      setNewUrl('');
      setTimeout(() => inputRef.current?.focus(), 300);
      setCopiedUrl(null);

      setIndividualExpanded(prevExpandedStates => {
        const newExpandedStates = {};
        servers.forEach(currentServer => {
          const url = currentServer.url;
          const prevServerData = prevServers?.find(s => s.url === url);

          if (prevExpandedStates.hasOwnProperty(url)) {
            let currentExpansionSetting = prevExpandedStates[url];
            if (
              prevServerData &&
              prevServerData.status === 'error' &&
              currentServer.status === 'connected' &&
              currentExpansionSetting === true && 
              !allExpanded
            ) {
              newExpandedStates[url] = false; 
            } else {
              newExpandedStates[url] = currentExpansionSetting; 
            }
          } else {
            newExpandedStates[url] = allExpanded;
          }
        });
        return newExpandedStates;
      });
    } else {
      setIndividualExpanded({}); 
      setCopiedUrl(null);
      setSearchQuery('');
    }

    prevServersRef.current = servers;

    return () => clearTimeout(copyTimeoutRef.current);
  }, [isOpen, servers, allExpanded]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isOpen && !event.target.closest('.mcp-tool-drawer') && 
          !event.target.closest('button[title="Manage Tool Connections"]')) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (isOpen && event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleAdd = () => {
    if (newUrl.trim()) {
      onAddServer(newUrl.trim());
      setNewUrl('');
      inputRef.current?.focus();
    }
  };

  const handleToggleAllDetails = () => {
    const newAllExpandedState = !allExpanded;
    setAllExpanded(newAllExpandedState);
    const newIndividualStates = {};
    connectedServers.forEach(server => {
      newIndividualStates[server.url] = newAllExpandedState;
    });
    setIndividualExpanded(newIndividualStates);
  };

  const handleToggleIndividualDetail = (serverUrl) => {
    setIndividualExpanded(prev => ({ ...prev, [serverUrl]: !prev[serverUrl] }));
  };

  const handleCopyUrl = (urlToCopy) => {
    navigator.clipboard.writeText(urlToCopy).then(() => {
      setCopiedUrl(urlToCopy);
      clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => {
        setCopiedUrl(null);
      }, 2000);
    }).catch(err => {
      console.error("Failed to copy URL: ", err);
    });
  };

  const getFilteredTools = (url) => {
    if (!searchQuery.trim() || !toolsData[url]) return toolsData[url];
    return toolsData[url].filter(tool => 
      tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (tool.description && tool.description.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  };

  // Count total tools across all *connected and tool-reporting* servers
  const getTotalToolsCount = () => {
    return servers.reduce((total, server) => {
      if (server.isEnabled && server.status === 'connected' && toolsData[server.url]) {
        return total + toolsData[server.url].length;
      }
      return total;
    }, 0);
  };

  // Count total enabled tools across all *connected and tool-reporting* servers
  const getEnabledToolsCount = () => {
    return servers.reduce((total, server) => {
      if (server.isEnabled && server.status === 'connected' && toolsData[server.url]) {
        return total + toolsData[server.url].filter(tool => tool.isEnabled !== false).length;
      }
      return total;
    }, 0);
  };

  return (
    <div className={`mcp-tool-drawer absolute left-0 right-0 bottom-full mb-1 z-10 transition-all duration-300 ease-in-out rounded-xl shadow-lg border border-neutral-700 bg-neutral-800 ${isOpen ? 'opacity-100 transform-none' : 'opacity-0 pointer-events-none translate-y-4'}`}>
      <div className="flex flex-col max-h-[500px]">
        {/* Header */}
        <div className="flex justify-between items-center p-4 border-b border-neutral-700 bg-neutral-900 rounded-t-xl">
          <h3 className="text-lg font-semibold text-neutral-200 flex items-center">
            <ToolIcon className="h-5 w-5 mr-2 text-neutral-200" />
            MCP Tool Manager
          </h3>
          <div className="flex items-center gap-3">
            <div 
              className={`text-xs px-2 py-1 rounded-full ${isToolSchemaOverLimit ? 'bg-red-900 text-red-200' : 'bg-neutral-800 text-neutral-400'}`}
              title={isToolSchemaOverLimit ? "Tool schema token limit exceeded! Disable tools or descriptions." : "Current tool schema token count vs limit"}
            >
              Tokens: {currentToolSchemaTokens}/{maxToolSchemaTokens}
            </div>
            {/* <div className="text-xs text-neutral-400 px-2 py-1 rounded-full bg-neutral-800">
              {getEnabledToolsCount()}/{getTotalToolsCount()} tools enabled
            </div> */}
          <button 
            onClick={onClose}
              className="text-neutral-400 hover:text-neutral-200 p-1 rounded-full hover:bg-neutral-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
          </div>
        </div>
        
        {/* Tabs */}
        <div className="flex border-b border-neutral-700">
          <button
            onClick={() => setActiveTab('servers')}
            className={`flex-1 py-2 text-sm font-medium ${activeTab === 'servers' ? 'text-neutral-200 border-b-2 border-neutral-400' : 'text-neutral-400 hover:text-neutral-300'}`}
          >
            Servers ({servers.length} configured)
          </button>
          <button
            onClick={() => setActiveTab('add')}
            className={`flex-1 py-2 text-sm font-medium ${activeTab === 'add' ? 'text-neutral-200 border-b-2 border-neutral-400' : 'text-neutral-400 hover:text-neutral-300'}`}
          >
            Add Server
          </button>
        </div>

        {/* Content Area */}
        <div className="p-4 flex flex-col gap-4 overflow-auto scrollbar-thin scrollbar-thumb-neutral-600 scrollbar-track-neutral-800">
          {/* Add Server Tab */}
          {activeTab === 'add' && (
        <div className="bg-neutral-800 rounded-lg p-3">
              <h4 className="text-sm font-medium text-neutral-200 mb-2">Add New MCP Server</h4>
          <div className="flex items-center">
            <input 
              ref={inputRef}
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="Enter MCP Server URL (e.g., http://localhost:3000/mcp)"
              className="flex-grow border border-neutral-600 rounded-lg p-2 text-sm bg-neutral-900 text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-500 placeholder-neutral-500"
              onKeyDown={(e) => e.key === 'Enter' && newUrl.trim() && handleAdd()}
            />
            <button 
              onClick={handleAdd}
              disabled={!newUrl.trim()}
                  className="ml-2 px-4 py-2 rounded-lg text-sm bg-neutral-700 text-white hover:bg-neutral-600 disabled:bg-neutral-800 disabled:text-neutral-400 disabled:cursor-not-allowed transition-colors flex items-center"
            >
                  <PlusIcon className="w-4 h-4 mr-1" />
              Add
            </button>
          </div>
            </div>
          )}
          
          {/* Servers Tab (renamed from Tools tab) */}
          {activeTab === 'servers' && (
            <div className="space-y-4">
              {isToolSchemaOverLimit && (
                <div className="p-3 bg-red-900/30 border border-red-700/50 rounded-lg text-center">
                  <p className="text-sm text-red-300 font-medium">
                    Tool Schema Token Limit Exceeded!
                  </p>
                  <p className="text-xs text-red-400 mt-1">
                    Please disable some tools or their descriptions to reduce the token count below {maxToolSchemaTokens}.
                  </p>
                </div>
              )}
              {/* Search bar */}
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-neutral-500" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search tools by name or description..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-sm text-neutral-200 focus:outline-none focus:ring-1 focus:ring-neutral-500"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                )}
        </div>
        
              {/* Tool stats */}
              <div className="flex justify-between items-center">
                <div className="text-sm text-neutral-400">
                  {getTotalToolsCount() === 0 ? (
                    'No tools available'
                  ) : (
                    <>
                      <span className="text-neutral-300 font-medium">{getEnabledToolsCount()}</span> of <span className="font-medium">{getTotalToolsCount()}</span> tools enabled
                    </>
                  )}
                </div>
                <div className="flex gap-2">
              <button 
                    onClick={() => {
                      // Logic to toggle all tools
                      Object.entries(toolsData).forEach(([serverUrl, tools]) => {
                        tools.forEach(tool => {
                          // If any tool is disabled, enable all. Otherwise, disable all.
                          const shouldEnable = tools.some(t => t.isEnabled === false);
                          onToggleTool(serverUrl, tool.name, shouldEnable);
                        });
                      });
                    }}
                    className="text-xs px-2 py-1 bg-neutral-700 hover:bg-neutral-600 text-neutral-300 rounded"
                  >
                    Toggle All
              </button>
                  <select
                    className="text-xs bg-neutral-700 text-neutral-300 rounded px-2 py-1 border-none focus:ring-1 focus:ring-neutral-500"
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'all') setSearchQuery('');
                      else if (val === 'enabled') setSearchQuery('enabled:true');
                      else if (val === 'disabled') setSearchQuery('enabled:false');
                    }}
                    value={
                      searchQuery === '' ? 'all' : 
                      searchQuery === 'enabled:true' ? 'enabled' : 
                      searchQuery === 'enabled:false' ? 'disabled' : 'all'
                    }
                  >
                    <option value="all">All Tools</option>
                    <option value="enabled">Enabled Only</option>
                    <option value="disabled">Disabled Only</option>
                  </select>
                </div>
            </div>

              {/* Servers with tools */}
              <div className="space-y-3">
                {servers.map((server) => {
                  const serverUrl = server.url;
                  const serverTools = toolsData[serverUrl] || []; // Get tools for this server, or empty array if none
                  
                  // Filter tools based on search query
                  const filteredTools = searchQuery.startsWith('enabled:') 
                    ? serverTools.filter(tool => {
                        const isEnabled = tool.isEnabled !== false;
                        return searchQuery === 'enabled:true' ? isEnabled : !isEnabled;
                      })
                    : serverTools.filter(tool =>
                        searchQuery === '' || 
                        tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        (tool.description && tool.description.toLowerCase().includes(searchQuery.toLowerCase()))
                      );

                  // Determine if this server section should be shown based on search query
                  // Show if:
                  // 1. Search query is empty OR
                  // 2. Server URL matches search query OR
                  // 3. Any tool name/description matches search query OR
                  // 4. Special filters like "enabled:true" for tools are used (already handled by filteredTools.length)
                  const serverUrlMatchesSearch = serverUrl.toLowerCase().includes(searchQuery.toLowerCase());
                  const showServerSection = searchQuery === '' || serverUrlMatchesSearch || filteredTools.length > 0;

                  if (!showServerSection && server.status !== 'error' && server.status !== 'connecting') return null; // Still show error/connecting servers
                  
                  const isServerUserEnabled = server.isEnabled !== false; // User's intent
                  const isConnected = server.status === 'connected' && isServerUserEnabled;
                  const isConnecting = server.status === 'connecting' && isServerUserEnabled;
                  const isError = server.status === 'error' && isServerUserEnabled;
                  const isDisabledByUser = !isServerUserEnabled;


                  let statusText = 'Disabled';
                  let statusColorClass = 'bg-neutral-700/30 text-neutral-400';
                  let statusIndicatorClass = 'bg-neutral-500';

                  if (isDisabledByUser) {
                    statusText = 'Disabled by User';
                  } else if (isConnecting) {
                    statusText = 'Connecting...';
                    statusColorClass = 'bg-yellow-900/30 text-yellow-400';
                    statusIndicatorClass = 'bg-yellow-400 animate-pulse';
                  } else if (isError) {
                    statusText = 'Error';
                    statusColorClass = 'bg-red-900/30 text-red-400';
                    statusIndicatorClass = 'bg-red-400';
                  } else if (isConnected) {
                    statusText = 'Connected';
                    statusColorClass = 'bg-green-900/30 text-green-400';
                    statusIndicatorClass = 'bg-green-400';
                  } else if (server.status === 'offline' || server.status === 'disconnected') { // Assuming these might be other statuses
                    statusText = 'Disconnected';
                    statusColorClass = 'bg-orange-900/30 text-orange-400';
                    statusIndicatorClass = 'bg-orange-400';
                  }


                  return (
                    <div 
                      key={serverUrl} 
                      className={`border border-neutral-700 rounded-lg overflow-hidden transition-all duration-200 ${isDisabledByUser ? 'opacity-60' : ''}`}
                    >
                      {/* Server header */}
                      <div className="bg-neutral-750 p-3 flex justify-between items-center">
                    <div className="flex-grow mr-2 min-w-0">
                      <div 
                            className={`font-mono text-xs cursor-pointer hover:text-neutral-300 transition-colors duration-150 flex items-center ${isDisabledByUser ? 'text-neutral-500' : 'text-neutral-300'}`}
                            onClick={() => handleCopyUrl(serverUrl)}
                        title="Copy URL"
                      >
                            {copiedUrl === serverUrl ? (
                              <span className="text-green-400">✓ Copied!</span>
                            ) : (
                              <span className="max-w-[300px] truncate">{serverUrl}</span>
                            )}
                      </div>
                          <div className="flex items-center mt-1 space-x-2">
                            <div 
                              className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] ${statusColorClass}`}
                            >
                              <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1 ${statusIndicatorClass}`}></span>
                              {statusText}
                            </div>
                            {(isConnected && serverTools.length > 0) && (
                              <span className="text-xs text-neutral-400 flex items-center">
                              <ToolIcon className="h-3 w-3 mr-1 text-neutral-400" />
                                {filteredTools.length} tool{filteredTools.length !== 1 ? 's' : ''}
                                {filteredTools.length !== serverTools.length ? ` (of ${serverTools.length} total)` : ''}
                          </span>
                            )}
                          </div>
                          {isError && server.error && (
                             <div className="mt-1 text-xs text-red-400 truncate" title={typeof server.error === 'string' ? server.error : JSON.stringify(server.error)}>
                              Error: {typeof server.error === 'string' ? server.error : (server.error.message || JSON.stringify(server.error))}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center space-x-1.5">
                          {isError && (
                            <button
                              onClick={() => onForceReconnect(serverUrl)}
                              className="p-1 text-neutral-400 hover:text-neutral-100 hover:bg-neutral-700 rounded"
                              title="Force Reconnect"
                            >
                              <RefreshIcon className="w-3.5 h-3.5" />
                            </button>
                          )}
                        <button 
                            onClick={() => handleToggleIndividualDetail(serverUrl)} 
                            className="p-1 text-neutral-400 hover:text-neutral-200 bg-neutral-800 hover:bg-neutral-700 rounded"
                            aria-label={individualExpanded[serverUrl] ? "Hide details" : "Show details"}
                            title={individualExpanded[serverUrl] ? "Hide details" : "Show details"}
                            disabled={isDisabledByUser || isConnecting || (isError && !isConnected)} // Disable if no details to show
                        >
                            {individualExpanded[serverUrl] ? <ChevronUpIcon className="w-4 h-4"/> : <ChevronDownIcon className="w-4 h-4"/>}
                        </button>
                          <ToggleSwitch isEnabled={isServerUserEnabled} onToggle={() => onToggleServer(serverUrl)} activeColor="bg-neutral-600" />
                        <button 
                            onClick={() => onRemoveServer(serverUrl)} 
                            className="p-1 text-neutral-500 hover:text-red-400 hover:bg-neutral-700 disabled:text-neutral-600 disabled:cursor-not-allowed transition-colors rounded"
                          aria-label="Remove server"
                          title="Remove Server"
                        >
                          <TrashIcon className="w-4 h-4" />
                        </button>
                        </div>
                      </div>
                      
                      {/* Details: Tools list, Connecting message, or Error message */}
                      {isServerUserEnabled && individualExpanded[serverUrl] && 
                        (isConnecting || (isConnected && serverTools.length > 0)) && (
                        <div className="border-t border-neutral-700 bg-neutral-800 p-3">
                          {isConnecting && (
                            <div className="text-sm text-neutral-400 text-center py-2">Connecting to server...</div>
                          )}
                          {isConnected && serverTools.length > 0 && (
                          <div className="space-y-2">
                              {filteredTools.length === 0 && searchQuery && (
                                <div className="text-sm text-neutral-500 text-center py-2">No tools match your search for this server.</div>
                              )}
                              {filteredTools.length === 0 && !searchQuery && (
                                <div className="text-sm text-neutral-500 text-center py-2">This server reported no tools.</div>
                              )}
                            {filteredTools.map((tool, toolIndex) => {
                              const isDisabledClass = tool.isEnabled === false ? 'opacity-20' : '';
                              return (
                                <div 
                                  key={toolIndex} 
                                  className={`bg-neutral-750 p-2 rounded border ${tool.isEnabled !== false ? 'border-neutral-700' : 'border-neutral-800'}`}
                                >
                                  <div className="flex items-center justify-between mb-1">
                                    <div className={`font-medium text-neutral-300 text-sm truncate max-w-[250px] ${isDisabledClass}`} title={tool.name}>
                                      {tool.name}
                                    </div>
                                    <div className="flex items-center space-x-2">
                                      <div className="flex items-center">
                                        <span className="text-[10px] text-neutral-500 mr-1">DESC</span>
                                        <ToggleSwitch 
                                          isEnabled={tool.showDescription !== false} 
                                          onToggle={() => onToggleToolDescription(serverUrl, tool.name)} 
                                          size="xs" 
                                          activeColor="bg-neutral-600" 
                                        />
                                      </div>
                                      <div className="flex items-center">
                                        <span className="text-[10px] text-neutral-500 mr-1">ON</span>
                                        <ToggleSwitch 
                                          isEnabled={tool.isEnabled !== false} 
                                          onToggle={() => onToggleTool(serverUrl, tool.name)} 
                                          size="xs" 
                                          activeColor="bg-neutral-600"
                                        />
                      </div>
                    </div>
                  </div>
                  
                                  {(tool.showDescription !== false) && tool.description && (
                                    <div className={`text-neutral-400 mt-1 text-xs ${isDisabledClass}`}>{tool.description}</div>
                                )}
                                  
                                {tool.inputSchema && tool.inputSchema.properties && (
                                    <div className={`mt-2 border-t border-neutral-800 pt-2 ${isDisabledClass}`}>
                                      <div className="text-[10px] text-neutral-500 mb-1 uppercase tracking-wide">Parameters</div>
                                      <div className="grid grid-cols-2 gap-1">
                                    {Object.entries(tool.inputSchema.properties).map(([paramName, schema]) => (
                                          <div key={paramName} className="flex items-center">
                                            <span className="text-neutral-300 text-[10px] font-mono">{paramName}</span>
                                            <span className="text-neutral-500 ml-1 text-[10px]">
                                          ({schema.type})
                                          {tool.inputSchema.required?.includes(paramName) && (
                                            <span className="text-red-400 ml-0.5">*</span>
                                          )}
                                        </span>
                                      </div>
                                    ))}
                      </div>
                    </div>
                  )}
                </div>
                              );
                            })}
            </div>
                          )}
          </div>
        )}
                    </div>
                  );
                })}
              </div>
              
              {/* Empty state for the entire servers tab */}
              {servers.length === 0 && (
                <div className="text-center py-6 text-neutral-400 bg-neutral-800/50 rounded-lg border border-neutral-700">
                  <div className="flex justify-center mb-2">
                    <ToolIcon className="h-8 w-8 text-neutral-500" />
                  </div>
                  <p>No MCP servers configured</p>
                  <p className="text-sm mt-1">Add a server to get started</p>
                  <button 
                    onClick={() => setActiveTab('add')}
                    className="mt-3 px-4 py-2 rounded-lg text-sm bg-neutral-700 text-white hover:bg-neutral-600 inline-flex items-center"
                  >
                    <PlusIcon className="w-4 h-4 mr-1" />
                    Add Server
                  </button>
                </div>
              )}
              {/* Empty state when servers exist but search yields no results for any server */}
              {servers.length > 0 && 
                !servers.some(server => {
                  const serverTools = toolsData[server.url] || [];
                  const filteredTools = searchQuery.startsWith('enabled:') 
                    ? serverTools.filter(tool => {
                        const isEnabled = tool.isEnabled !== false;
                        return searchQuery === 'enabled:true' ? isEnabled : !isEnabled;
                      })
                    : serverTools.filter(tool =>
                        searchQuery === '' || 
                        tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        (tool.description && tool.description.toLowerCase().includes(searchQuery.toLowerCase()))
                      );
                  const serverUrlMatchesSearch = server.url.toLowerCase().includes(searchQuery.toLowerCase());
                  return searchQuery === '' || serverUrlMatchesSearch || filteredTools.length > 0;
                }) && (
                <div className="text-center py-6 text-neutral-400 bg-neutral-800/50 rounded-lg border border-neutral-700">
                  <div className="flex justify-center mb-2">
                    <SearchIcon className="h-8 w-8 text-neutral-500" />
                  </div>
                  <p>No servers or tools match your search</p>
                      <p className="text-sm mt-1">Try different search terms or clear the filter</p>
                      <button 
                        onClick={() => setSearchQuery('')}
                        className="mt-3 px-4 py-2 rounded-lg text-sm bg-neutral-700 text-white hover:bg-neutral-600"
                      >
                        Clear Search
                      </button>
                      </div>
              )}
          </div>
        )}
          </div>
      </div>
    </div>
  );
}

export default McpToolDrawer; 