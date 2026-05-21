import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import './LogViewer.css';

export default function LogViewer() {
  const { logs, loadingLogs, fetchLogs } = useApp();
  const [selectedLog, setSelectedLog] = useState(null);
  const [sessionFilter, setSessionFilter] = useState('');
  const [toolFilter, setToolFilter] = useState('all');

  useEffect(() => {
    fetchLogs();
  }, []);

  // Filter logs locally
  const filteredLogs = logs.filter(log => {
    const matchesSession = sessionFilter.trim() === '' || log.session_id.includes(sessionFilter.trim());
    const matchesTool = toolFilter === 'all' || log.tool_type === toolFilter;
    return matchesSession && matchesTool;
  });

  // Extract unique tools for dropdown
  const uniqueTools = ['all', ...new Set(logs.map(log => log.tool_type))];

  return (
    <div className="log-viewer-workspace fade-in-slide-up">
      <div className="log-header">
        <span className="log-icon">👁️</span>
        <div className="log-header-text">
          <h2>全链路埋点与路径追踪 (Log Telemetry Flow)</h2>
          <p>管理员专用数据可视化追踪看板，提供调用路径红绿灰三色状态追踪</p>
        </div>
      </div>

      <div className="log-filters glass-panel">
        <div className="filter-group">
          <label>会话 ID 检索:</label>
          <input
            type="text"
            placeholder="按 Session_ID 进行链路匹配..."
            value={sessionFilter}
            onChange={(e) => setSessionFilter(e.target.value)}
          />
        </div>
        <div className="filter-group">
          <label>工具模块过滤:</label>
          <select value={toolFilter} onChange={(e) => setToolFilter(e.target.value)}>
            {uniqueTools.map(t => (
              <option key={t} value={t}>{t === 'all' ? '所有模块' : t}</option>
            ))}
          </select>
        </div>
        <button className="btn btn-secondary refresh-btn" onClick={fetchLogs} disabled={loadingLogs}>
          {loadingLogs ? '正在拉取...' : '🔄 刷新日志'}
        </button>
      </div>

      <div className="log-main-layout">
        {/* Logs List Table */}
        <div className="log-table-container glass-panel">
          <div className="table-header-row">
            <span className="col-time">时间</span>
            <span className="col-tool">工具</span>
            <span className="col-session">会话 ID</span>
            <span className="col-delay">时延</span>
            <span className="col-status">状态</span>
          </div>
          <div className="table-body">
            {loadingLogs && logs.length === 0 ? (
              <div className="table-placeholder">正在载入系统日志流...</div>
            ) : filteredLogs.length === 0 ? (
              <div className="table-placeholder">未检索到匹配的埋点调用链路</div>
            ) : (
              filteredLogs.map(log => {
                const isSelected = selectedLog && selectedLog.id === log.id;
                return (
                  <div
                    key={log.id}
                    className={`table-row ${isSelected ? 'selected' : ''} ${log.status}`}
                    onClick={() => setSelectedLog(log)}
                  >
                    <span className="col-time font-mono">{new Date(log.created_at).toLocaleTimeString()}</span>
                    <span className="col-tool font-mono">{log.tool_type}</span>
                    <span className="col-session font-mono ellipsis" title={log.session_id}>{log.session_id}</span>
                    <span className="col-delay font-mono text-glow">{log.execution_time_ms}ms</span>
                    <span className="col-status">
                      <span className={`status-badge-dot ${log.status}`}></span>
                      <span className="status-badge-text">{log.status === 'success' ? '成功' : '失败'}</span>
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Selected Log Flow Path Visualization */}
        <div className="log-flow-visualization glass-panel">
          <div className="flow-panel-title">
            <span>调用路径三色可视化追踪</span>
          </div>

          {selectedLog ? (
            <div className="flow-visual-canvas fade-in-slide-up" key={selectedLog.id}>
              {/* Path Node 1: UI Trigger */}
              <div className="flow-node active-green">
                <div className="node-icon">💻</div>
                <div className="node-info">
                  <span className="node-title">UI 交互层</span>
                  <span className="node-desc font-mono">{selectedLog.ui_path}</span>
                </div>
              </div>

              <div className="flow-arrow active-green">▼</div>

              {/* Path Node 2: API Gateway */}
              <div className="flow-node active-green">
                <div className="node-icon">⚡</div>
                <div className="node-info">
                  <span className="node-title">API 网关层</span>
                  <span className="node-desc font-mono">/api/logs/ [POST]</span>
                </div>
              </div>

              <div className={`flow-arrow ${selectedLog.status === 'success' ? 'active-green' : 'active-red'}`}>▼</div>

              {/* Path Node 3: Core Service Execution */}
              <div className={`flow-node ${selectedLog.status === 'success' ? 'active-green' : 'active-red'}`}>
                <div className="node-icon">🧠</div>
                <div className="node-info">
                  <span className="node-title">核心逻辑层</span>
                  <span className="node-desc font-mono ellipsis" title={selectedLog.execution_path}>
                    {selectedLog.execution_path}
                  </span>
                </div>
              </div>

              <div className={`flow-arrow ${selectedLog.status === 'success' ? 'active-green' : 'active-red'}`}>▼</div>

              {/* Path Node 4: Database Storage */}
              <div className={`flow-node ${selectedLog.status === 'success' ? 'active-green' : 'active-red'}`}>
                <div className="node-icon">🗄️</div>
                <div className="node-info">
                  <span className="node-title">数据持久层</span>
                  <span className="node-desc font-mono">MySQL: tool_invocations</span>
                </div>
              </div>

              {/* Path Node 5: Optional Error Stack Node */}
              {selectedLog.status === 'error' && (
                <>
                  <div className="flow-arrow active-red">▼</div>
                  <div className="flow-node error-details-node">
                    <div className="node-icon">⚠️</div>
                    <div className="node-info font-mono">
                      <span className="node-title text-error">错误信息</span>
                      <span className="node-desc text-error">{selectedLog.error_message}</span>
                      {selectedLog.stack_trace && (
                        <pre className="stack-trace-pre">{selectedLog.stack_trace.substring(0, 300)}...</pre>
                      )}
                    </div>
                  </div>
                </>
              )}

              {/* Legend Path Code Explanation */}
              <div className="flow-legend">
                <span className="legend-item"><span className="legend-dot green"></span>已使用成功运行 (Green)</span>
                <span className="legend-item"><span className="legend-dot red"></span>已使用捕获报错 (Red)</span>
                <span className="legend-item"><span className="legend-dot gray"></span>未激活空闲链路 (Gray)</span>
              </div>
            </div>
          ) : (
            <div className="flow-visual-placeholder">
              <span className="placeholder-icon">👁️</span>
              <p>请在左侧列表中点击任意一行埋点日志，调取实时红绿灰三色逻辑调用路径分析图</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
