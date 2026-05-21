import React, { createContext, useState, useEffect, useContext } from 'react';

const AppContext = createContext();

// No active categories/tools needed for base view since logs is a premium standalone panel
const INITIAL_CATEGORIES = [];
const INITIAL_TOOLS = {};

// Generate a high-fidelity random session ID for user path tracing
const generateSessionId = () => {
  return 'sess-' + Math.random().toString(36).substring(2, 15) + '-' + Date.now().toString(36);
};

export const AppProvider = ({ children }) => {
  const [categories] = useState(INITIAL_CATEGORIES);
  const [tools] = useState(INITIAL_TOOLS);
  const [activeCategory, setActiveCategory] = useState('');
  const [activeTool, setActiveTool] = useState('');
  const [sidebarExpanded, setSidebarExpanded] = useState(false); // Collapse sidebar as default since no categories
  const [sessionId] = useState(generateSessionId());
  
  // Settings & Theme control states
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [theme, setThemeState] = useState(() => localStorage.getItem('theme') || 'dark');

  // Change theme globally & update DOM attribute + persistence
  const setTheme = (newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem('theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  // Sync theme with HTML data attribute on mount & change
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Backend dynamic statistics and logs
  const [backendStatus, setBackendStatus] = useState({ online: false, data: null });
  const [logs, setLogs] = useState([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  // Fetch backend gateway status via health check endpoint
  const fetchSystemStatus = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8000/health');
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

  // Fetch logs from backend matching standard format {"code": 0, "message": "success", "data": [...]}
  const fetchLogs = async () => {
    setLoadingLogs(true);
    try {
      const response = await fetch('http://127.0.0.1:8000/api/v1/logs/');
      if (response.ok) {
        const res = await response.json();
        setLogs(res.data || []);
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
      await fetch('http://127.0.0.1:8000/api/v1/logs/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          session_id: sessionId,
          tool_type: toolId,
          ui_path: `/trace/${toolId}`,
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

  // Clear logs from backend database
  const clearLogs = async () => {
    try {
      const response = await fetch('http://127.0.0.1:8000/api/v1/logs/clear', {
        method: 'DELETE'
      });
      if (response.ok) {
        // Immediately record an entry for logs clearance action
        await logFrontendAction('clear-logs', 'success', { action: 'database_clear' });
      }
    } catch (err) {
      console.error('Failed to clear logs:', err);
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
        isSettingsOpen,
        theme,
        setActiveTool,
        setSidebarExpanded,
        changeCategory,
        fetchSystemStatus,
        fetchLogs,
        logFrontendAction,
        clearLogs,
        setIsSettingsOpen,
        setTheme
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => useContext(AppContext);

