---
name: mini-tools-platform-rules
description: 小工具平台开发规范 - 每次对话必须加载此文件
---

# 小工具平台开发规范

**📝 语言要求**: 所有计划、说明、文档产物必须使用中文编写。

## 核心架构

```
技术栈: Vite+React (frontend/) | FastAPI (backend/) | MySQL | Redis | uv
目录: backend/{api/,services/,cli.py} | assets/ | .env
```

## API规范

**URL**: `/api/v1/资源名`

**响应格式**:
```json
{"code": 0, "message": "success", "data": {...}}
```
- `code: 0` = 成功
- 数据放在 `data` 字段

## 缓存策略

- **工具级自定义**: 每个工具独立配置
- **内容哈希**: 相同内容命中缓存（文件名无关）
- **限制**: 100MB全局，30分钟TTL，LRU淘汰
- **隐私**: 敏感数据用户隔离，公开数据全局共享

## 日志系统

**记录**: 时间戳、工具类型、路径、参数、结果
**可视化**: 绿色(成功) | 红色(错误) | 灰色(未涉及)
**存储**: MySQL，支持导出JSON/CSV/XML

## CLI规范

### 架构设计
**包级设计**: `backend/cli/` 模块包（一子命令一文件）
```
backend/cli/
├── __main__.py    # 极简入口，仅负责分发
├── logs.py        # logs子命令（完全自治）
├── cache.py       # cache子命令
└── tools.py       # tools子命令
└── ........
```

**根目录入口**: `./mini-tool` (Shell脚本)
```bash
exec uv run --project backend python -m backend.cli "$@"
```

### 数据层
- **直连MySQL**: 通过 `SessionLocal` 直接访问数据库
- **独立运行**: 不依赖FastAPI服务，离线可用

### Agentic工作流
```
自然语言 → CLI → LLM理解 → toolDescription.md → 选择工具 → backend/services
```

### 输出设计
- **人类**: 精美表格（控制台）
- **AI/程序**: JSON/XML结构化输出
- **管道友好**: 支持 `stdout` 重定向和 `| jq` 等

### 命令示例
```bash
mini-tool logs --all                      # 表格输出
mini-tool logs --id <id> --format json   # JSON输出
mini-tool logs --export --format xml     # 导出XML
```

**退出码**: 0=成功, 1=用户错误, 2=系统错误

## Git规范

**分支**: `feature-xxx` | `bugfix-xxx` | `refactor-xxx` | `docs-xxx`

**工作流**:
1. 创建分支并开发
2. 提交代码（清晰message）
3. Push到GitHub
4. **合并到main分支**(main分支为default分支)

## UI规范

- 顶部: 椭圆形分类标签，悬停微动效
- 左侧: 可折叠导航，平滑动画
- 内容: 大圆角容器(16-24px)

## 安全规范

- 所有输入必须验证，防注入
- 错误不暴露敏感信息
- 敏感缓存加密存储

## 编码笔记规范

**强制要求**: 每次新增功能或bug修复后，必须：
1. 在 `/Users/xujunforce/STD/codingNote/` 创建笔记文件
2. 文件命名: `本次摘要.md` (使用中文描述)
3. 内容包含: 功能说明、关键代码、注意事项

## 检查清单

开发时必须确认:
- [ ] API使用 `/api/v1/` 和标准响应格式
- [ ] 工具定义缓存配置
- [ ] 添加日志埋点
- [ ] Git提交后push
- [ ] **合并到main分支**
- [ ] 输入验证和错误处理
- [ ] **所有文档使用中文**
- [ ] **创建编码笔记到 codingNote/**

---

**重要**: 此文件必须在每次对话时加载。所有开发工作必须遵循此规范。
