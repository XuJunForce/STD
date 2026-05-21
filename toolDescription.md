# 工具说明文档 (Tool Description)

该文档用于记录和维护小工具平台（STD）中的所有工具模块与平台基础微服务。

## 平台级基础微服务 (Platform Base Telemetry)

### 1. 全链路追踪与日志遥测 (Trace Logs)
- **ID**: `logs`
- **图标**: 👁️
- **服务路径**: `/api/v1/logs`
- **存在原因 (Why it exists)**:
  作为高级小工具开发平台（STD），所有工具的调用、时延以及报错必须有高度可视化的埋点遥测。该服务专门用于捕捉前台触发、API 网关、后端核心逻辑到数据库持久化的完整生命周期链路，为 AI Agent 和人类开发者提供极致直观的**红绿灰三色调用链追踪看板**。它能够有效隔离断点，快速通过异常堆栈定位报错根源，是平台不可或缺的排障与审计核心。

#### 详细用法 (Usage)
1. **前端页面**:
   - 作为一个完全独立的平台顶级页面展现。
   - **三色可视化**: 正常运行为绿色，异常中断为红色，因报错受阻未涉及的持久层节点则呈现灰色。
   - **元数据详情**: 支持点击行调取 iOS 毛玻璃卡片详情，美化展示 JSON 输入参数、详细报错与异常堆栈。
   - **格式化导出**: 详情内和主列表顶部均支持直接生成并下载 AI 友好的 JSON 及 XML 格式日志。
   - **一键清空**: 支持物理删除数据库中的所有日志，以便开启全新的干净链路测试。

2. **后端 API 调用**:
   - **记录日志**: `POST /api/v1/logs/`。接收完整 JSON 埋点信息并持久化。
   - **读取日志**: `GET /api/v1/logs/`。支持 session_id、tool_type、status 多维度过滤。
   - **清空日志**: `DELETE /api/v1/logs/clear`。彻底清空数据库日志表。

3. **CLI 命令行工具 (mini-tool)**:
   - 直连 MySQL 数据库，不依赖 FastAPI 服务，离线随时可用。支持管道重定向和人类友好表格输出。

#### 调用与交互示例 (Examples)

##### API 示例
- **请求方法**: `POST /api/v1/logs/`
- **Payload**:
  ```json
  {
    "session_id": "sess-a9x8y7-1716300000000",
    "tool_type": "pdf-merge",
    "ui_path": "/trace/pdf-merge",
    "execution_path": "backend.services.pdf:merge",
    "execution_time_ms": 145,
    "status": "success",
    "parameters": {
      "files": ["report_q1.pdf", "report_q2.pdf"],
      "output_name": "q1_q2_merged.pdf"
    }
  }
  ```
- **Standard Response**:
  ```json
  {
    "code": 0,
    "message": "success",
    "data": {
      "id": 12,
      "session_id": "sess-a9x8y7-1716300000000",
      "tool_type": "pdf-merge",
      "ui_path": "/trace/pdf-merge",
      "execution_path": "backend.services.pdf:merge",
      "execution_time_ms": 145,
      "status": "success",
      "parameters": "{\"files\": [\"report_q1.pdf\", \"report_q2.pdf\"], \"output_name\": \"q1_q2_merged.pdf\"}",
      "error_message": null,
      "stack_trace": null,
      "created_at": "2026-05-21T13:46:12"
    }
  }
  ```

##### CLI 命令行调用示例
- **输出精美表格列表**:
  ```bash
  ./mini-tool logs --all
  ```
- **搜索特定 Session 的调用链路**:
  ```bash
  ./mini-tool logs --search "sess-test"
  ```
- **查询特定 ID 的日志细节并输出 XML**:
  ```bash
  ./mini-tool logs --id 12 --format xml
  ```
- **将所有日志以 AI 友好的 JSON 格式直接导出到指定文件**:
  ```bash
  ./mini-tool logs --export --format json --output ./logs_dump.json
  ```
- **一键清空日志**:
  ```bash
  ./mini-tool logs --clear
  ```

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

### 身份证扫描复印
- **工具 ID**: `id-card-scanner`
- **所属分类**: `graphics`
- **显示图标**: `🪪`
- **功能简述**: 智能拼接身份证正反面至一张 A4 页面 PDF，支持像素级安全防伪水印、黑白/高对比度色彩模式调节，且完美支持 1:1 原大物理比例。

#### 1. 前端实现
- **组件路径**: `frontend/src/components/IdCardScanner.jsx`
- **UI 布局**: 左右分栏布局。左侧为正反面上传与旋转操作槽（包含极其精美的 iPhone 连续互通扫描步骤指引），下方为排版参数控制面板。右侧为所见即所得 A4 实时 Canvas 物理预览与生成后嵌入式 PDF 交互层。
- **交互逻辑**: 支持拖拽上传与剪贴板图片直接粘贴。用户修改参数滑块时右侧 A4 物理 Canvas 瞬时无缝重绘，生成后可一键下载或静默打印。

#### 2. 后端 API
- **API 路径**: `/api/v1/id-card/generate`（生成）与 `/api/v1/id-card/download/{file_id}`（下载/预览）
- **请求方法**: `POST`（上传流与表单配置）及 `GET`（流式输出 PDF）
- **请求参数**:
  ```json
  {
    "front_image": "UploadFile",
    "back_image": "UploadFile",
    "watermark_text": "str",
    "color_mode": "str (original | grayscale | monochrome)",
    "print_scale": "str (1to1 | fit)",
    "session_id": "str"
  }
  ```
- **返回数据**:
  ```json
  {
    "code": 0,
    "message": "success",
    "data": {
      "file_id": "cache_key_string",
      "download_url": "/api/v1/id-card/download/cache_key",
      "file_name": "身份证复印件.pdf"
    }
  }
  ```

#### 3. 缓存策略
- **缓存类型**: 本地文件存储缓存 (`backend/cache/`)
- **哈希字段**: 正反面图片文件 MD5 + 表单处理参数 SHA-256
- **TTL**: 30 分钟，总容量 100MB 限额，按 LRU 机制淘汰
- **隐私级别**: 全局缓存隔离（防信息泄露）

#### 4. CLI 命令行调用
- **命令格式**: `./mini-tool id-card --front <front_path> --back <back_path> [options]`
- **示例**: `./mini-tool id-card --front ./test_front.jpg --back ./test_back.jpg --output ./test_output_1to1.pdf --watermark "测试"`
