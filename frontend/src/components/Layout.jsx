import React from 'react';
import CategoryBar from './CategoryBar';
import Sidebar from './Sidebar';
import { useApp } from '../context/AppContext';
import LogViewer from './LogViewer';
import IdCardScanner from './IdCardScanner';
import Settings from './Settings';
import './Layout.css';

export default function Layout() {
  const { isSettingsOpen, activeTool } = useApp();

  return (
    <div className="layout-container">
      <CategoryBar />
      <div className="main-workspace">
        <Sidebar />
        <div className="content-canvas glass-panel fade-in-slide-up">
          {activeTool === 'id-card-scanner' ? <IdCardScanner /> : <LogViewer />}
        </div>
      </div>
      
      {/* iOS settings overlay */}
      {isSettingsOpen && <Settings />}
    </div>
  );
}

