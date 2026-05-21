import React from 'react';
import { useApp } from '../context/AppContext';
import './CategoryBar.css';

export default function CategoryBar() {
  const { categories, activeCategory, changeCategory, setIsSettingsOpen } = useApp();

  return (
    <div className="category-bar glass-panel">
      <div 
        className="logo-section" 
        onClick={() => setIsSettingsOpen(true)}
        title="点击打开系统设置 (Settings)"
      >
        <span className="logo-pulse"></span>
        <span className="logo-text">Toolbox<span className="text-glow">.io</span></span>
      </div>
      <div className="pill-container">
        {categories.map((cat) => {
          const isActive = cat.id === activeCategory;
          return (
            <button
              key={cat.id}
              className={`category-pill ${isActive ? 'active' : ''}`}
              onClick={() => changeCategory(cat.id)}
            >
              <span className="pill-icon">{cat.icon}</span>
              <span className="pill-name">{cat.name}</span>
              {isActive && <span className="pill-glow-dot"></span>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
