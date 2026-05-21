# 工具说明文档 (Tool Description)

该文档用于记录和维护小工具平台（STD）中的所有工具模块。随着平台的迭代和新工具的开发，所有新增加的工具必须在此文档中注册并详细记录其功能、接口规范、缓存配置以及调用方式。

## 平台基础工具 (Platform Base Tools)

系统目前已完成所有 mock/临时小工具的清理，仅保留平台级基础微服务。

### 1. 系统状态 (System Status)
- **ID**: `status`
- **分类**: `system` (系统状态)
- **图标**: 📊
- **描述**: 用于实时监测系统运行指标、后端服务活性、数据库连接与缓存层状态。

### 2. 调用链追踪 (Trace Logs)
- **ID**: `logs`
- **分类**: `system` (系统状态)
- **图标**: 👁️
- **描述**: 红绿灰三色可视化埋点调用路径界面，记录并展示所有工具的调用历史和执行耗时。

---

## 工具注册规范与模板 (Tool Registration Specification)

任何新增加的工具模块均须遵循以下注册模板，并将其补充至本文件的**应用工具列表**中。

### 工具定义模板

```markdown
### [工具名称]
- **工具 ID**: `[unique-tool-id]` (全小写, kebab-case)
- **所属分类**: `[text | dev | graphics | others]`
- **显示图标**: `[Emoji]`
- **功能简述**: [一句话描述该工具的核心作用]

#### 1. 前端实现
- **组件路径**: `frontend/src/components/[ToolComponentName].jsx`
- **UI 布局**: [简述界面构成，如输入框、操作按钮、输出框等]
- **交互逻辑**: [简述主要交互动作，如点击编码、解码等]

#### 2. 后端 API (可选)
- **API 路径**: `/api/v1/[tool-id]/[endpoint]`
- **请求方法**: `POST | GET`
- **请求参数**:
  ```json
  {
    "param1": "value"
  }
  ```
- **返回数据**:
  ```json
  {
    "code": 0,
    "message": "success",
    "data": { ... }
  }
  ```

#### 3. 缓存策略 (若有)
- **缓存类型**: `Redis_Store | file system`
- **哈希字段**: [例如: 输入文本的 SHA-256 哈希值]
- **TTL**: [缓存有效期, 默认 30 分钟]
- **隐私级别**: `global | user-isolated`

#### 4. CLI 命令行调用
- **命令格式**: `mini-tools [command-name] [options]`
- **示例**: `mini-tools [command-name] --input "data"`
```

---

## 应用工具列表 (Application Tools)

*(当前暂无活跃应用工具。所有 mock 工具已全部移除，等待后续按需逐步开发与注册。)*
