import { useState, useEffect } from 'react';

function McpServerModal({ isOpen, onClose, servers = [], onAddServer, onRemoveServer, onForceReconnect }) {
  const [newUrl, setNewUrl] = useState('');

  useEffect(() => {
    if (isOpen) {
      setNewUrl(''); 
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAdd = () => {
    if (newUrl.trim()) {
      onAddServer(newUrl.trim());
      setNewUrl('');
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-semibold text-gray-800 dark:text-gray-100">Manage MCP Servers</h2>
          <button onClick={onClose} className="text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white text-2xl">&times;</button>
        </div>

        {/* Add Server */}
        <div className="mb-4 flex items-center">
          <input 
            type="text"
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="Enter MCP Server URL)"
            className="flex-grow border border-gray-300 dark:border-gray-600 rounded-md p-2 text-sm bg-transparent dark:text-gray-700 dark:focus:bg-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500 text-gray-800 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-300"
          />
          <button 
            onClick={handleAdd}
            disabled={!newUrl.trim()}
            className="ml-2 px-4 py-2 border rounded-md text-sm bg-blue-500 text-white hover:bg-blue-600 disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            Add
          </button>
        </div>

        {/* Server List */}
        <div className="flex-grow overflow-y-auto scrollbar-thin pr-1">
          {servers.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No MCP servers added yet.</p>
          ) : (
            <ul className="space-y-2">
              {servers.map(({ url, status, error, toolsCount }, index) => (
                <li key={index} className="p-2 border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-700/50">
                  <div className="flex justify-between items-center">
                    <div className="flex-grow break-all">
                      <span className="font-mono text-xs text-gray-700 dark:text-gray-300">{url}</span>
                    </div>
                    <button 
                      onClick={() => onRemoveServer(url)} 
                      className="ml-2 px-2 py-0.5 border border-red-500 text-red-500 rounded-md text-xs hover:bg-red-500 hover:text-white transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-1 text-xs">
                    {status === 'connecting' && <span className="text-yellow-500">Connecting...</span>}
                    {status === 'connected' && <span className="text-green-500">Connected ({toolsCount} tool(s))</span>}
                    {status === 'error' && (
                      <span className="text-red-500">
                        Error: {error || 'Failed to connect.'}
                        <button 
                           onClick={() => onForceReconnect(url)}
                           className="ml-2 text-blue-500 hover:underline"
                        >
                           (Retry)
                        </button>
                      </span>
                    )}
                    {status === 'pending' && <span className="text-gray-400">Pending connection...</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <button 
            onClick={onClose}
            className="mt-6 px-4 py-2 border rounded-md text-sm bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-100 self-end"
        >
            Close
        </button>
      </div>
    </div>
  );
}

export default McpServerModal; 