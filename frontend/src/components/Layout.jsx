import React from 'react';
import CategoryBar from './CategoryBar';
import { useApp } from '../context/AppContext';
import LogViewer from './LogViewer';
import Settings from './Settings';
import './Layout.css';

export default function Layout() {
  const { isSettingsOpen } = useApp();

  return (
    <div className="layout-container">
      <CategoryBar />
      <div className="main-workspace">
        <div className="content-canvas glass-panel fade-in-slide-up">
          <LogViewer />
        </div>
      </div>
      
      {/* iOS settings overlay */}
      {isSettingsOpen && <Settings />}
    </div>
  );
}
