import React from 'react';
import { useApp } from '../context/AppContext';
import './Sidebar.css';

export default function Sidebar() {
  const {
    tools,
    activeCategory,
    activeTool,
    setActiveTool,
    sidebarExpanded,
    setSidebarExpanded,
    backendStatus
  } = useApp();

  const currentTools = tools[activeCategory] || [];

  return (
    <div className={`sidebar glass-panel ${sidebarExpanded ? 'expanded' : 'collapsed'}`}>
      <div className="sidebar-header">
        <button
          className="toggle-sidebar-btn"
          onClick={() => setSidebarExpanded(!sidebarExpanded)}
          title={sidebarExpanded ? "收起侧栏" : "展开侧栏"}
        >
          {sidebarExpanded ? '◀' : '▶'}
        </button>
        {sidebarExpanded && <span className="sidebar-title">工具目录</span>}
      </div>

      <div className="sidebar-menu">
        {currentTools.map((tool) => {
          const isActive = tool.id === activeTool;
          return (
            <button
              key={tool.id}
              className={`menu-item ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTool(tool.id)}
            >
              <span className="menu-icon">{tool.icon}</span>
              {sidebarExpanded && (
                <div className="menu-text">
                  <span className="menu-name">{tool.name}</span>
                  <span className="menu-desc">{tool.desc}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      <div className="sidebar-footer">
        <div className={`status-indicator ${backendStatus.online ? 'online' : 'offline'}`}>
          <span className="status-dot"></span>
          {sidebarExpanded && (
            <span className="status-text">
              {backendStatus.online ? 'API Gateway 已连接' : 'API Gateway 未连接'}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
