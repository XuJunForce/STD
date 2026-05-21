# 新增 iOS 风格设置页面与深浅色模式切换

## 功能说明

为 Toolbox.io 平台新增了高保真的 iOS 风格设置中心，并引入了系统级深浅色主题无缝切换功能：
1. **触发起点**：用户点击左上角带呼吸脉冲动效的 “Toolbox.io” 徽标，设置面板会以平滑的滑入动画从下方覆盖呈现。
2. **主题控制**：采用 iOS 规范设计了“深色模式”与“浅色模式”的双模微缩屏幕预览卡片，用户点击即刻在全局根元素渲染 `data-theme` 属性并同步保存到 `localStorage` 中。
3. **内容栏目**：
   - **通用**：语言切换、会话特征 ID（支持一键复制）、内容哈希与 LRU 缓存指标。
   - **显示与外观**：浅色/深色视觉双预览、侧边栏默认展开开关、字体大小无级微调。
   - **隐私与安全**：清空缓存（带网络同步和日志重刷）、敏感会话参数埋点脱敏开关。
   - **关于本机**：极简关于看板、API 网关实时连通性、OS 核心类型、Python 核心版本与服务运行时长。
4. **无损返回**：点击左上角的“◀ 返回”，设置浮层流畅退出，且**原本正在操作的工具状态绝不丢失**（由于采用了 Overlay 渲染，未卸载底层组件）。

---

## 关键代码

### 1. 全局样式变量与深浅色切换机制 (`frontend/src/index.css`)
```css
:root {
  /* 默认深色模式下的变量 */
  --bg-main: #060913;
  --bg-card: rgba(13, 20, 38, 0.6);
  --bg-sidebar: #0a0e1a;
  --bg-pill: rgba(255, 255, 255, 0.03);
  --border-color: rgba(255, 255, 255, 0.07);

  --text-title: #FFFFFF;
  --text-primary: #E2E8F0;
  --text-secondary: #94A3B8;
  --text-muted: #64748B;
  --text-pure: #FFFFFF;
  --logo-text-color: #FFFFFF;
}

[data-theme="light"] {
  /* 浅色模式（iOS风格）下的变量覆盖 */
  --bg-main: #F2F2F7;
  --bg-card: rgba(255, 255, 255, 0.85);
  --bg-sidebar: #FFFFFF;
  --bg-sidebar-collapsed: #E5E5EA;
  --bg-pill: rgba(0, 0, 0, 0.04);
  --bg-pill-hover: rgba(0, 0, 0, 0.08);
  --border-color: rgba(0, 0, 0, 0.08);
  --border-color-hover: rgba(0, 0, 0, 0.15);

  --glow-cyan: #007AFF; /* 浅色下转换为 iOS 经典蓝色 */
  --glow-purple: #AF52DE;

  --text-title: #1C1C1E;
  --text-primary: #2C2C2E;
  --text-secondary: #3A3A3C;
  --text-muted: #8E8E93;
  --text-pure: #000000;
  --logo-text-color: #1C1C1E;
}
```

### 2. 全局状态存储与初始化 (`frontend/src/context/AppContext.jsx`)
```jsx
// 声明设置打开与主题切换状态
const [isSettingsOpen, setIsSettingsOpen] = useState(false);
const [theme, setThemeState] = useState(() => localStorage.getItem('theme') || 'dark');

// 实现设置并持久化主题
const setTheme = (newTheme) => {
  setThemeState(newTheme);
  localStorage.setItem('theme', newTheme);
  document.documentElement.setAttribute('data-theme', newTheme);
};

// 在挂载和变更时同步 DOM 属性
useEffect(() => {
  document.documentElement.setAttribute('data-theme', theme);
}, [theme]);
```

### 3. 主布局内非破坏性挂载集成 (`frontend/src/components/Layout.jsx`)
```jsx
return (
  <div className="layout-container">
    <CategoryBar />
    <div className="main-workspace">
      <Sidebar />
      <div className="content-canvas glass-panel fade-in-slide-up" key={`${activeCategory}-${activeTool}`}>
        {renderActiveTool()}
      </div>
    </div>
    
    {/* 绝对定位浮于顶层的 iOS 设置遮罩层 */}
    {isSettingsOpen && <Settings />}
  </div>
);
```

---

## 注意事项

1. **样式继承与重构**：侧边栏、标题栏和系统监控部分的很多文字之前使用的是硬编码的灰色（如 `#94A3B8`）和白色，现已全面重构为 `var(--text-secondary)` 和 `var(--text-title)` 等变量，确保浅色模式下不会出现白底白字的视障缺陷。
2. **缓存清空模拟**：在“隐私与安全”中，清除缓存触发后会虚拟等待并刷新调用日志，可配合后端 `logs/` 清理逻辑进行二次扩展。
3. **响应式两栏式自适应**：在 Settings.css 中通过 `@media (max-width: 768px)` 实现了侧边导航栏和详情界面的纵向折叠流布局，保障移动设备与大屏 PC 同样拥有绝佳的观感。
