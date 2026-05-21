import React from 'react';
import CategoryBar from './CategoryBar';
import Sidebar from './Sidebar';
import { useApp } from '../context/AppContext';
import SystemStatus from './SystemStatus';
import LogViewer from './LogViewer';
import GenericTool from './GenericTool';
import Settings from './Settings';
import './Layout.css';

export default function Layout() {
  const { activeCategory, activeTool, isSettingsOpen } = useApp();

  // Route active components dynamically based on state
  const renderActiveTool = () => {
    if (activeCategory === 'system') {
      if (activeTool === 'status') return <SystemStatus />;
      if (activeTool === 'logs') return <LogViewer />;
    }
    
    // For all other text/dev/graphics tools, render generic fully styled workspace
    return <GenericTool />;
  };

  return (
    <div className="layout-container">
      <CategoryBar />
      <div className="main-workspace">
        <Sidebar />
        <div className="content-canvas glass-panel fade-in-slide-up" key={`${activeCategory}-${activeTool}`}>
          {renderActiveTool()}
        </div>
      </div>
      
      {/* iOS settings overlay */}
      {isSettingsOpen && <Settings />}
    </div>
  );
}
