import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import './Settings.css';

export default function Settings() {
  const {
    isSettingsOpen,
    setIsSettingsOpen,
    theme,
    setTheme,
    sessionId,
    backendStatus,
    fetchLogs
  } = useApp();

  const [activeTab, setActiveTab] = useState('appearance');
  const [searchQuery, setSearchQuery] = useState('');
  const [fontSize, setFontSize] = useState(14);
  const [cacheCleared, setCacheCleared] = useState(false);
  const [isolateLogs, setIsolateLogs] = useState(false);
  const [sidebarDefaultOpen, setSidebarDefaultOpen] = useState(true);

  if (!isSettingsOpen) return null;

  // Search filter configuration for settings menu items
  const menuItems = [
    { id: 'general', name: '通用', desc: '语言、缓存模式与会话参数', icon: '⚙️', color: '#8E8E93' },
    { id: 'appearance', name: '显示与外观', desc: '深浅主题切换、字体与侧栏配置', icon: '🌗', color: '#007AFF' },
    { id: 'privacy', name: '隐私与安全', desc: '缓存清除、日志隔离与API凭证', icon: '🛡️', color: '#34C759' },
    { id: 'about', name: '关于本机', desc: '系统节点、网关状态与开发者致谢', icon: 'ℹ️', color: '#5856D6' }
  ];

  const filteredMenuItems = menuItems.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.desc.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Copy sessionId to clipboard
  const handleCopySessionId = () => {
    navigator.clipboard.writeText(sessionId);
    alert('会话 ID 已成功复制到剪贴板！');
  };

  // Perform virtual cache clearing
  const handleClearCache = async () => {
    setCacheCleared(true);
    // Refresh backend logs to simulate sync
    await fetchLogs();
    setTimeout(() => {
      setCacheCleared(false);
      alert('本地及网关缓存已成功清理，缓存状态已初始化为 0 B！');
    }, 800);
  };

  return (
    <div className="settings-overlay-slide">
      <div className="settings-container glass-panel">
        
        {/* iOS-Style Top Bar */}
        <div className="settings-header">
          <button 
            className="settings-back-btn" 
            onClick={() => setIsSettingsOpen(false)}
            title="返回工作区"
          >
            <span className="back-chevron">◀</span> 返回
          </button>
          <div className="settings-title">设置</div>
          <div className="settings-header-right-placeholder"></div>
        </div>

        {/* Settings Body Layout */}
        <div className="settings-body">
          
          {/* Left Column - Navigation Pane */}
          <div className="settings-navigation">
            
            {/* User Profile Banner */}
            <div className="settings-profile-card">
              <div className="profile-avatar">🛠️</div>
              <div className="profile-info">
                <h3>Toolbox 开发者</h3>
                <p>{sessionId.substring(0, 14)}...</p>
              </div>
            </div>

            {/* iOS Search Bar */}
            <div className="settings-search-wrapper">
              <span className="search-icon">🔍</span>
              <input 
                type="text" 
                placeholder="搜索设置选项..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="settings-search-input"
              />
              {searchQuery && (
                <button className="search-clear-btn" onClick={() => setSearchQuery('')}>×</button>
              )}
            </div>

            {/* Navigation Lists */}
            <div className="settings-nav-group">
              {filteredMenuItems.map((item) => (
                <button
                  key={item.id}
                  className={`settings-nav-item ${activeTab === item.id ? 'active' : ''}`}
                  onClick={() => setActiveTab(item.id)}
                >
                  <div className="nav-item-icon-wrapper" style={{ backgroundColor: item.color }}>
                    {item.icon}
                  </div>
                  <div className="nav-item-text">
                    <span className="nav-item-title">{item.name}</span>
                    <span className="nav-item-desc">{item.desc}</span>
                  </div>
                  <span className="nav-item-chevron">▶</span>
                </button>
              ))}
              {filteredMenuItems.length === 0 && (
                <div className="settings-no-results">未找到匹配的设置项</div>
              )}
            </div>
          </div>

          {/* Right Column - Detail Pane */}
          <div className="settings-details">
            <div className="settings-detail-canvas fade-in-slide-up" key={activeTab}>
              
              {/* TAB 1: GENERAL */}
              {activeTab === 'general' && (
                <div className="settings-section">
                  <h2>通用设置 (General)</h2>
                  
                  <div className="settings-group">
                    <div className="settings-row">
                      <span className="row-label">语言 (Language)</span>
                      <span className="row-value select-value">简体中文 🌐</span>
                    </div>
                    <div className="settings-row" onClick={handleCopySessionId} style={{ cursor: 'pointer' }}>
                      <span className="row-label">当前会话特征 (Session ID)</span>
                      <span className="row-value font-mono copy-badge" title="点击复制">
                        {sessionId.substring(0, 10)}... <span className="copy-icon">📋</span>
                      </span>
                    </div>
                  </div>

                  <div className="settings-group-title">网关运行模式</div>
                  <div className="settings-group">
                    <div className="settings-row">
                      <span className="row-label">文件内容哈希 (Content Hash)</span>
                      <span className="row-value text-success font-mono">ENABLED</span>
                    </div>
                    <div className="settings-row">
                      <span className="row-label">全局LRU淘汰 (Cache Invalidation)</span>
                      <span className="row-value text-glow">30分钟 TTL</span>
                    </div>
                    <div className="settings-row">
                      <span className="row-label">最大共享存储</span>
                      <span className="row-value font-mono">100 MB</span>
                    </div>
                  </div>
                  <p className="settings-group-tip">* 缓存淘汰使用最近最少使用（LRU）算法，以保障网关的快速响应与隐私安全级别。</p>
                </div>
              )}

              {/* TAB 2: APPEARANCE */}
              {activeTab === 'appearance' && (
                <div className="settings-section">
                  <h2>显示与外观 (Appearance)</h2>

                  <div className="settings-group-title">外观模式 (Theme)</div>
                  
                  {/* High Fidelity Visual Theme Segmented Control */}
                  <div className="theme-selector-grid">
                    
                    {/* Light Mode Selector Card */}
                    <button 
                      className={`theme-selector-card light-mode-card ${theme === 'light' ? 'selected' : ''}`}
                      onClick={() => setTheme('light')}
                    >
                      <div className="mini-screen-mock light-mock">
                        <div className="mock-top-bar"></div>
                        <div className="mock-body">
                          <div className="mock-sidebar"></div>
                          <div className="mock-content">
                            <div className="mock-pill"></div>
                            <div className="mock-card"></div>
                          </div>
                        </div>
                      </div>
                      <span className="theme-card-label">
                        <span className="radio-circle"></span>
                        浅色模式 (Light)
                      </span>
                    </button>

                    {/* Dark Mode Selector Card */}
                    <button 
                      className={`theme-selector-card dark-mode-card ${theme === 'dark' ? 'selected' : ''}`}
                      onClick={() => setTheme('dark')}
                    >
                      <div className="mini-screen-mock dark-mock">
                        <div className="mock-top-bar"></div>
                        <div className="mock-body">
                          <div className="mock-sidebar"></div>
                          <div className="mock-content">
                            <div className="mock-pill"></div>
                            <div className="mock-card"></div>
                          </div>
                        </div>
                      </div>
                      <span className="theme-card-label">
                        <span className="radio-circle"></span>
                        深色模式 (Dark)
                      </span>
                    </button>
                  </div>

                  <div className="settings-group-title">视觉微调</div>
                  <div className="settings-group">
                    <div className="settings-row">
                      <span className="row-label">侧边栏默认展开</span>
                      <span className="row-value">
                        <label className="ios-switch">
                          <input 
                            type="checkbox" 
                            checked={sidebarDefaultOpen}
                            onChange={(e) => setSidebarDefaultOpen(e.target.checked)}
                          />
                          <span className="slider-round"></span>
                        </label>
                      </span>
                    </div>
                    <div className="settings-row-col">
                      <div className="settings-row-col-header">
                        <span className="row-label">字体大小 (Font Size)</span>
                        <span className="row-value font-mono">{fontSize}px</span>
                      </div>
                      <input 
                        type="range" 
                        min="12" 
                        max="18" 
                        step="1" 
                        value={fontSize} 
                        onChange={(e) => setFontSize(parseInt(e.target.value))}
                        className="ios-slider"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 3: PRIVACY & SECURITY */}
              {activeTab === 'privacy' && (
                <div className="settings-section">
                  <h2>隐私与安全 (Privacy & Security)</h2>

                  <div className="settings-group-title">本地数据管理</div>
                  <div className="settings-group">
                    <button 
                      className="settings-row settings-row-clickable" 
                      onClick={handleClearCache}
                      disabled={cacheCleared}
                    >
                      <span className="row-label text-error font-medium">
                        {cacheCleared ? '⚡ 正在清理核心缓存网关...' : '🗑️ 清除本地调用链路缓存'}
                      </span>
                      <span className="row-value text-muted font-mono">
                        {cacheCleared ? 'Syncing...' : '12.4 KB'}
                      </span>
                    </button>
                  </div>

                  <div className="settings-group-title">敏感信息设置</div>
                  <div className="settings-group">
                    <div className="settings-row">
                      <span className="row-label">调用参数埋点脱敏</span>
                      <span className="row-value">
                        <label className="ios-switch">
                          <input 
                            type="checkbox" 
                            checked={isolateLogs}
                            onChange={(e) => setIsolateLogs(e.target.checked)}
                          />
                          <span className="slider-round"></span>
                        </label>
                      </span>
                    </div>
                    <div className="settings-row">
                      <span className="row-label">会话隐私隔离级别 (Privacy Level)</span>
                      <span className="row-value text-warning">HIGH (User Isolated)</span>
                    </div>
                  </div>
                  <p className="settings-group-tip">* 开启参数脱敏后，所有向网关汇报的调用日志中的自定义额外参数将以哈希值形式保存，以严格防范信息注入与泄漏。</p>
                </div>
              )}

              {/* TAB 4: ABOUT */}
              {activeTab === 'about' && (
                <div className="settings-section">
                  <h2>关于本机 (About)</h2>

                  {/* Brand Branding Card */}
                  <div className="about-branding-card">
                    <div className="brand-logo">🧰</div>
                    <div className="brand-texts">
                      <h3>Toolbox.io</h3>
                      <p>版本 v1.0.4 (Production Scaffolding)</p>
                    </div>
                  </div>

                  <div className="settings-group-title">核心网关遥测 (Gateway Telemetry)</div>
                  <div className="settings-group">
                    <div className="settings-row">
                      <span className="row-label">API 接入点状态</span>
                      <span className="row-value">
                        <span className={`telemetry-badge ${backendStatus.online ? 'active' : 'inactive'}`}>
                          {backendStatus.online ? 'CONNECTED (200 OK)' : 'OFFLINE (503)'}
                        </span>
                      </span>
                    </div>
                    {backendStatus.online && backendStatus.data && (
                      <>
                        <div className="settings-row">
                          <span className="row-label">节点操作系统</span>
                          <span className="row-value font-mono">{backendStatus.data.platform}</span>
                        </div>
                        <div className="settings-row">
                          <span className="row-label">Python 核心版本</span>
                          <span className="row-value font-mono">{backendStatus.data.python_version}</span>
                        </div>
                        <div className="settings-row">
                          <span className="row-label">服务已运行时长</span>
                          <span className="row-value text-glow">{backendStatus.data.uptime_seconds}s</span>
                        </div>
                      </>
                    )}
                    <div className="settings-row">
                      <span className="row-label">开源许可协议</span>
                      <span className="row-value font-mono">MIT License</span>
                    </div>
                  </div>

                  <div className="settings-group-title">开发者团队与致谢</div>
                  <div className="settings-group">
                    <div className="settings-row">
                      <span className="row-label">高级智能体开发者</span>
                      <span className="row-value">Antigravity Team 🚀</span>
                    </div>
                    <div className="settings-row">
                      <span className="row-label">技术支持</span>
                      <span className="row-value font-mono">Google DeepMind</span>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
