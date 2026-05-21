import React, { createContext, useState, useEffect, useContext } from 'react';

const AppContext = createContext();

// Mock/Default list of categories and tools in the system
const INITIAL_CATEGORIES = [
  { id: 'system', name: '系统状态', icon: '⚡' }
];

const INITIAL_TOOLS = {
  system: [
    { id: 'status', name: '健康与状态', desc: '监测系统运行指标与微服务状态', icon: '📊' },
    { id: 'logs', name: '调用链追踪', desc: '红绿灰三色可视化埋点调用路径', icon: '👁️' }
  ]
};

// Generate a high-fidelity random session ID for user path tracing
const generateSessionId = () => {
  return 'sess-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now().toString(36);
};

export const AppProvider = ({ children }) => {
  const [categories] = useState(INITIAL_CATEGORIES);
  const [tools] = useState(INITIAL_TOOLS);
  const [activeCategory, setActiveCategory] = useState('system');
  const [activeTool, setActiveTool] = useState('status');
  const [sidebarExpanded, setSidebarExpanded] = useState(true);
  const [sessionId] = useState(generateSessionId());
  
  // Backend dynamic statistics and logs
  const [backendStatus, setBackendStatus] = useState({ online: false, data: null });
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Fetch backend system status
  const fetchSystemStatus = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8000/api/system/status');
      if (response.ok) {
        const data = await response.json();
        setBackendStatus({ online: true, data });
      } else {
        setBackendStatus({ online: false, data: null });
      }
    } catch (error) {
      setBackendStatus({ online: false, data: null });
    }
  };

  // Fetch logs from backend
  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const response = await fetch('http://127.0.0.1:8000/api/logs/');
      if (response.ok) {
        const data = await response.json();
        setLogs(data);
      }
    } catch (error) {
      console.error('Error fetching logs:', error);
    } finally {
      setLoadingLogs(false);
    }
  };

  // Log a frontend action to the backend database
  const logFrontendAction = async (toolId, status = 'success', extraParams = {}, errMsg = null, trace = null) => {
    try {
      await fetch('http://127.0.0.1:8000/api/logs/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          session_id: sessionId,
          tool_type: toolId,
          ui_path: `/${activeCategory}/${toolId}`,
          execution_path: `frontend/src/components/${toolId}.jsx:handleAction`,
          execution_time_ms: Math.floor(Math.random() * 120) + 10, // Simulate execution delay
          status: status,
          parameters: extraParams,
          error_message: errMsg,
          stack_trace: trace
        })
      });
      // Refresh logs list
      fetchLogs();
    } catch (err) {
      console.error('Failed to report invocation tracking log:', err);
    }
  };

  // Auto-switch tools when category changes
  const changeCategory = (catId) => {
    setActiveCategory(catId);
    if (INITIAL_TOOLS[catId] && INITIAL_TOOLS[catId].length > 0) {
      setActiveTool(INITIAL_TOOLS[catId][0].id);
    }
  };

  useEffect(() => {
    fetchSystemStatus();
    fetchLogs();
    
    // Poll system status every 10 seconds to show dynamic heartbeat
    const statusInterval = setInterval(fetchSystemStatus, 10000);
    return () => clearInterval(statusInterval);
  }, []);

  return (
    <AppContext.Provider
      value={{
        categories,
        tools,
        activeCategory,
        activeTool,
        sidebarExpanded,
        sessionId,
        backendStatus,
        logs,
        loadingLogs,
        setActiveTool,
        setSidebarExpanded,
        changeCategory,
        fetchSystemStatus,
        fetchLogs,
        logFrontendAction
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);
