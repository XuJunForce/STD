import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import './SystemStatus.css';

export default function SystemStatus() {
  const { sessionId, backendStatus, fetchSystemStatus } = useApp();
  const [isTesting, setIsTesting] = useState(false);

  const handleTestConnection = async () => {
    setIsTesting(true);
    await new Promise((r) => setTimeout(r, 600)); // Futuristic visual delay
    await fetchSystemStatus();
    setIsTesting(false);
  };

  return (
    <div className="system-status-workspace fade-in-slide-up">
      <div className="system-header">
        <span className="telemetry-icon">📡</span>
        <div className="telemetry-header-text">
          <h2>系统监视与状态 (System Telemetry)</h2>
          <p>监测 Toolbox API Gateway 网关运行数据与微服务连通性</p>
        </div>
      </div>

      <div className="telemetry-grid">
        {/* Core Gateway Telemetry */}
        <div className="telemetry-card glass-panel">
          <div className="telemetry-card-title">网关状态 (API Status)</div>
          <div className="telemetry-value-section">
            <span className={`telemetry-badge ${backendStatus.online ? 'active' : 'inactive'}`}>
              {backendStatus.online ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
          <div className="telemetry-details">
            <div className="telemetry-row">
              <span>网关地址:</span>
              <span className="font-mono text-glow">http://127.0.0.1:8000</span>
            </div>
            <div className="telemetry-row">
              <span>状态码:</span>
              <span className={backendStatus.online ? 'text-success' : 'text-error'}>
                {backendStatus.online ? '200 OK' : '503 SERVICE UNAVAILABLE'}
              </span>
            </div>
          </div>
        </div>

        {/* User Session Telemetry */}
        <div className="telemetry-card glass-panel">
          <div className="telemetry-card-title">会话特征 (Session Context)</div>
          <div className="telemetry-value-section">
            <span className="session-id-display font-mono">{sessionId}</span>
          </div>
          <div className="telemetry-details">
            <div className="telemetry-row">
              <span>埋点串联:</span>
              <span>由 Session_ID 统一链路监控</span>
            </div>
            <div className="telemetry-row">
              <span>环境类别:</span>
              <span className="font-mono text-warning">development</span>
            </div>
          </div>
        </div>

        {/* Backend Node Telemetry */}
        <div className="telemetry-card glass-panel">
          <div className="telemetry-card-title">节点信息 (OS Telemetry)</div>
          {backendStatus.online && backendStatus.data ? (
            <>
              <div className="telemetry-value-section font-mono">
                {backendStatus.data.platform} <span className="platform-sub">v{backendStatus.data.platform_release.substring(0, 8)}</span>
              </div>
              <div className="telemetry-details">
                <div className="telemetry-row">
                  <span>Python 版本:</span>
                  <span className="font-mono text-glow">{backendStatus.data.python_version}</span>
                </div>
                <div className="telemetry-row">
                  <span>节点运行时长:</span>
                  <span className="text-glow">{backendStatus.data.uptime_seconds}s</span>
                </div>
              </div>
            </>
          ) : (
            <div className="telemetry-offline-message">
              <span>⚠️ 后端网关不在线，无法轮询节点指标</span>
            </div>
          )}
        </div>
      </div>

      <div className="telemetry-controls">
        <button
          className={`btn btn-primary ${isTesting ? 'pulse-button' : ''}`}
          onClick={handleTestConnection}
          disabled={isTesting}
        >
          {isTesting ? '正在发送心跳监测包...' : '发送心跳数据包 (PING Gateway)'}
        </button>
        <span className="telemetry-footer-tip">
          * 系统状态已启用双向链路自动轮询 (心跳周期: 10s)
        </span>
      </div>
    </div>
  );
}
