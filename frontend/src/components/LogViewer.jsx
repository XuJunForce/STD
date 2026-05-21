import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import './LogViewer.css';

export default function LogViewer() {
  const { logs, loadingLogs, fetchLogs, clearLogs } = useApp();
  const [selectedLog, setSelectedLog] = useState(null);
  const [sessionFilter, setSessionFilter] = useState('');
  const [toolFilter, setToolFilter] = useState('all');
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [copiedText, setCopiedText] = useState(false);

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

  // Export functions (JSON / XML)
  const exportToJSON = (data, filename = 'logs_export.json') => {
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const exportToXML = (data, filename = 'logs_export.xml') => {
    let xmlStr = '<?xml version="1.0" encoding="UTF-8"?>\n<logs>\n';
    const items = Array.isArray(data) ? data : [data];
    
    items.forEach(log => {
      xmlStr += '  <log>\n';
      Object.keys(log).forEach(key => {
        let val = log[key];
        if (val === null || val === undefined) {
          val = '';
        } else if (typeof val === 'object') {
          val = JSON.stringify(val);
        }
        // XML Escape special characters
        const escapedVal = String(val)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&apos;');
        xmlStr += `    <${key}>${escapedVal}</${key}>\n`;
      });
      xmlStr += '  </log>\n';
    });
    xmlStr += '</logs>';
    
    const blob = new Blob([xmlStr], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Helper to format JSON params safely
  const getFormattedParams = (paramStr) => {
    if (!paramStr) return '无参数 (Empty Parameters)';
    try {
      // Decode if double serialized or string
      const parsed = typeof paramStr === 'string' ? JSON.parse(paramStr) : paramStr;
      return JSON.stringify(parsed, null, 2);
    } catch (e) {
      return String(paramStr);
    }
  };

  // Handle Copy text
  const handleCopyText = (text) => {
    navigator.clipboard.writeText(text);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 2000);
  };

  // Handle Clear Logs with confirmation
  const handleClearLogs = () => {
    if (window.confirm('🚨 警告：此操作将永久清空数据库中的所有调用链日志记录，是否继续？')) {
      clearLogs();
      setSelectedLog(null);
    }
  };

  return (
    <div className="log-viewer-workspace fade-in-slide-up">
      {/* 🚀 Header */}
      <div className="log-header">
        <span className="log-icon">👁️</span>
        <div className="log-header-text">
          <h2>全链路埋点与路径追踪 (Log Telemetry Flow)</h2>
          <p>管理员专用数据可视化追踪看板，提供调用路径红绿灰三色状态追踪</p>
        </div>
      </div>

      {/* 🔍 Filters & Top Actions Group */}
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

      {/* 📥 Top Export & Operations Bar */}
      <div className="log-top-actions-wrapper">
        <div className="actions-btn-group">
          <button 
            className="btn-action-outline" 
            onClick={() => exportToJSON(filteredLogs, 'filtered_logs.json')}
            disabled={filteredLogs.length === 0}
            title="导出当前筛选列表中所有日志为 JSON 格式"
          >
            📤 导出列表 (JSON)
          </button>
          <button 
            className="btn-action-outline" 
            onClick={() => exportToXML(filteredLogs, 'filtered_logs.xml')}
            disabled={filteredLogs.length === 0}
            title="导出当前筛选列表中所有日志为 XML 格式"
          >
            📤 导出列表 (XML)
          </button>
        </div>
        <button 
          className="btn-danger" 
          onClick={handleClearLogs}
          disabled={logs.length === 0}
          title="一键彻底清空数据库日志表记录"
        >
          🗑️ 清空所有日志
        </button>
      </div>

      {/* 💻 Main grid */}
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
                    onDoubleClick={() => {
                      setSelectedLog(log);
                      setIsDetailModalOpen(true);
                    }}
                    title="单击查看链路图，双击查看极其详尽的日志堆栈与导出参数"
                  >
                    <span className="col-time font-mono">{new Date(log.created_at).toLocaleTimeString()}</span>
                    <span className="col-tool font-mono">{log.tool_type}</span>
                    <span className="col-session font-mono ellipsis" title={log.session_id}>{log.session_id}</span>
                    <span className="col-delay font-mono text-glow">{log.execution_time_ms}ms</span>
                    <span className="col-status">
                      <span className={`status-badge-dot ${log.status}`}></span>
                      <span className="status-badge-text">{log.status === 'success' ? '成功' : '失败'}</span>
                    </span>
                    <button 
                      className="details-row-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedLog(log);
                        setIsDetailModalOpen(true);
                      }}
                    >
                      🔍 详情
                    </button>
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
                  <span className="node-title">UI 交互层 (Green)</span>
                  <span className="node-desc font-mono">{selectedLog.ui_path}</span>
                </div>
              </div>

              <div className="flow-arrow active-green">▼</div>

              {/* Path Node 2: API Gateway */}
              <div className="flow-node active-green">
                <div className="node-icon">⚡</div>
                <div className="node-info">
                  <span className="node-title">API 网关层 (Green)</span>
                  <span className="node-desc font-mono">/api/v1/logs/ [POST]</span>
                </div>
              </div>

              <div className={`flow-arrow ${selectedLog.status === 'success' ? 'active-green' : 'active-red'}`}>▼</div>

              {/* Path Node 3: Core Service Execution */}
              <div className={`flow-node ${selectedLog.status === 'success' ? 'active-green' : (selectedLog.status === 'error' ? 'active-red' : 'inactive-gray')}`}>
                <div className="node-icon">🧠</div>
                <div className="node-info">
                  <span className="node-title">核心逻辑层 {selectedLog.status === 'success' ? '(Green)' : (selectedLog.status === 'error' ? '(Red)' : '(Gray)')}</span>
                  <span className="node-desc font-mono ellipsis" title={selectedLog.execution_path}>
                    {selectedLog.execution_path}
                  </span>
                </div>
              </div>

              <div className={`flow-arrow ${selectedLog.status === 'success' ? 'active-green' : 'inactive-gray'}`}>▼</div>

              {/* Path Node 4: Database Storage (Only active green on success. Gray on error or pending since database step is skipped on failure) */}
              <div className={`flow-node ${selectedLog.status === 'success' ? 'active-green' : 'inactive-gray'}`}>
                <div className="node-icon">🗄️</div>
                <div className="node-info">
                  <span className="node-title">数据持久层 {selectedLog.status === 'success' ? '(Green)' : '(Gray - 未涉及)'}</span>
                  <span className="node-desc font-mono">MySQL: tool_invocations</span>
                </div>
              </div>

              {/* View details button inside visual flow panel */}
              <button 
                className="modal-btn modal-btn-primary" 
                onClick={() => setIsDetailModalOpen(true)}
                style={{ marginTop: '20px', width: '90%' }}
              >
                👁️ 调取完整日志详情与底层堆栈
              </button>

              {/* Legend Path Code Explanation */}
              <div className="flow-legend">
                <span className="legend-item"><span className="legend-dot green"></span>已使用成功运行 (Green)</span>
                <span className="legend-item"><span className="legend-dot red"></span>已使用捕获报错 (Red)</span>
                <span className="legend-item"><span className="legend-dot gray"></span>未激活空闲/受阻链路 (Gray)</span>
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

      {/* 🌟 Premium iOS Glassmorphism Modal Overlay */}
      {isDetailModalOpen && selectedLog && (
        <div className="log-viewer-modal-overlay" onClick={() => setIsDetailModalOpen(false)}>
          <div className="log-viewer-modal-card" onClick={(e) => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="modal-header">
              <div className="modal-header-left">
                <span className="modal-title">日志详细遥测数据 (Log Telemetry Details)</span>
                <span className={`modal-status-badge ${selectedLog.status}`}>
                  {selectedLog.status === 'success' ? 'SUCCESS 成功' : 'ERROR 错误'}
                </span>
              </div>
              <button className="modal-close-icon" onClick={() => setIsDetailModalOpen(false)}>✕</button>
            </div>

            {/* Modal Body */}
            <div className="modal-body">
              <div className="modal-section-grid">
                <div className="meta-field">
                  <span className="meta-label">日志编号 (Log ID)</span>
                  <span className="meta-value font-mono">#{selectedLog.id}</span>
                </div>
                <div className="meta-field">
                  <span className="meta-label">记录时间 (Timestamp)</span>
                  <span className="meta-value font-mono">{new Date(selectedLog.created_at).toLocaleString()}</span>
                </div>
                <div className="meta-field">
                  <span className="meta-label">微服务/工具模块 (Tool ID)</span>
                  <span className="meta-value font-mono text-glow" style={{ color: 'var(--glow-cyan)' }}>{selectedLog.tool_type}</span>
                </div>
                <div className="meta-field">
                  <span className="meta-label">底层执行耗时 (Delay)</span>
                  <span className="meta-value font-mono" style={{ color: selectedLog.status === 'success' ? 'var(--color-success)' : 'var(--color-error)' }}>
                    {selectedLog.execution_time_ms} ms
                  </span>
                </div>
                <div className="meta-field full-width">
                  <span className="meta-label">全链路 Session ID</span>
                  <span className="meta-value font-mono" style={{ color: '#94A3B8' }}>{selectedLog.session_id}</span>
                </div>
                <div className="meta-field full-width">
                  <span className="meta-label">前端触发路径 (UI Path)</span>
                  <span className="meta-value font-mono">{selectedLog.ui_path}</span>
                </div>
                <div className="meta-field full-width">
                  <span className="meta-label">核心逻辑层方法 (Execution Path)</span>
                  <span className="meta-value font-mono">{selectedLog.execution_path}</span>
                </div>
              </div>

              {/* Code Pre - parameters */}
              <div className="code-pre-container">
                <div className="code-pre-header">
                  <span>输入参数与上下文数据 (Input Parameters)</span>
                  <button 
                    className="copy-text-btn"
                    onClick={() => handleCopyText(getFormattedParams(selectedLog.parameters))}
                  >
                    {copiedText ? '✓ 已复制' : '📋 复制参数'}
                  </button>
                </div>
                <pre className="code-block-pre font-mono">
                  {getFormattedParams(selectedLog.parameters)}
                </pre>
              </div>

              {/* Code Pre - error stack (Only render when error) */}
              {selectedLog.status === 'error' && (
                <div className="code-pre-container">
                  <div className="code-pre-header">
                    <span style={{ color: 'var(--color-error)' }}>异常捕获报错与堆栈轨迹 (Exception Call Stack)</span>
                    <button 
                      className="copy-text-btn"
                      onClick={() => handleCopyText(`${selectedLog.error_message}\n\n${selectedLog.stack_trace}`)}
                    >
                      {copiedText ? '✓ 已复制' : '📋 复制堆栈'}
                    </button>
                  </div>
                  <pre className="code-block-pre error-stack font-mono">
                    <strong>Error Message:</strong> {selectedLog.error_message || 'No message provided'}\n\n
                    <strong>Stack Trace:</strong>\n{selectedLog.stack_trace || 'No detailed stack trace captured'}
                  </pre>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="modal-footer">
              <button 
                className="modal-btn modal-btn-close" 
                onClick={() => {
                  const log_dict = {
                    id: selectedLog.id,
                    session_id: selectedLog.session_id,
                    tool_type: selectedLog.tool_type,
                    ui_path: selectedLog.ui_path,
                    execution_path: selectedLog.execution_path,
                    execution_time_ms: selectedLog.execution_time_ms,
                    status: selectedLog.status,
                    parameters: selectedLog.parameters,
                    error_message: selectedLog.error_message,
                    stack_trace: selectedLog.stack_trace,
                    created_at: selectedLog.created_at
                  };
                  exportToXML(log_dict, `log_${selectedLog.id}_export.xml`);
                }}
              >
                📥 导出此日志 (XML)
              </button>
              <button 
                className="modal-btn modal-btn-close" 
                onClick={() => {
                  const log_dict = {
                    id: selectedLog.id,
                    session_id: selectedLog.session_id,
                    tool_type: selectedLog.tool_type,
                    ui_path: selectedLog.ui_path,
                    execution_path: selectedLog.execution_path,
                    execution_time_ms: selectedLog.execution_time_ms,
                    status: selectedLog.status,
                    parameters: selectedLog.parameters,
                    error_message: selectedLog.error_message,
                    stack_trace: selectedLog.stack_trace,
                    created_at: selectedLog.created_at
                  };
                  exportToJSON(log_dict, `log_${selectedLog.id}_export.json`);
                }}
              >
                📥 导出此日志 (JSON)
              </button>
              <button className="modal-btn modal-btn-primary" onClick={() => setIsDetailModalOpen(false)}>
                ✓ 确认关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

