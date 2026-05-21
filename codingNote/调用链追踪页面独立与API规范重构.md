# 编码笔记：调用链追踪页面独立与 API 规范重构

## 1. 功能说明
为了优化小工具平台（STD）的产品交互层次及技术合规性，本次开发对底层日志与健康系统进行了全面重构：
1. **分类剥离与页面独立**: 彻底删除了与普通工具类别不符的“健康与状态”功能；将“调用链追踪”彻底移出小工具列表，并重新打造成一个专属的、高保真独立前端大画布页面，剥离了多余的侧边栏。
2. **三色全链路追踪精细化**: 优化了调用链路状态机的展现逻辑。UI 交互和 API 网关层标记为绿色。在核心逻辑执行成功时，所有节点包括持久层均为绿色；若核心逻辑抛出异常，则核心层高亮为红色展示报错，而受阻未涉及的数据库持久层节点完美呈现为灰色，清晰勾勒出断点位置。
3. **元数据详情 iOS 卡片与导出**:
   - 点击调用链行可以调取高斯模糊的 iOS Card Modal，以极高审美展示 ID、会话 ID、时延、触发和执行路径，并格式化美化展示 JSON 输入参数与异常堆栈。
   - 前台纯 JS 实现向后兼容、AI 友好的 JSON 及 XML 格式化导出，支持单条日志与过滤后的列表一键下载。
   - 增加前台“一键清空日志”控制权，支持物理清除数据库中的所有遥测记录。
4. **API 规范升级**: 后端路由全局迁移至 `/api/v1/logs` 路径下，并针对响应采用标准的包装结构，强制通过 Pydantic 校验为 `{"code": 0, "message": "success", "data": ...}`。

---

## 2. 关键代码

### 后端精确序列化与清空路由 (`backend/api/logs.py`)
为了兼容 SQLAlchemy 的 ORM 自动序列化，同时严格遵循平台 `code / message / data` 的三层响应模型规范，设计了特定泛型的 `StandardLogResponse`：

```python
class LogResponse(BaseModel):
    id: int
    session_id: str
    tool_type: str
    ui_path: str
    execution_path: str
    execution_time_ms: int
    status: str
    parameters: Optional[str] = None
    error_message: Optional[str] = None
    stack_trace: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

class StandardLogResponse(BaseModel):
    code: int = 0
    message: str = "success"
    data: LogResponse

class StandardLogListResponse(BaseModel):
    code: int = 0
    message: str = "success"
    data: List[LogResponse]

@router.get("/", response_model=StandardLogListResponse)
def read_log_entries(db: Session = Depends(get_db)):
    try:
        logs = get_logs(db=db)
        return {"code": 0, "message": "success", "data": logs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")

@router.delete("/clear", response_model=StandardResponse)
def clear_log_entries(db: Session = Depends(get_db)):
    try:
        num_deleted = db.query(ToolInvocation).delete()
        db.commit()
        return {"code": 0, "message": f"Cleared logs success ({num_deleted} deleted)", "data": None}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Clear failed: {e}")
```

### 前台纯 JS 的 XML 高兼容性转义导出 (`frontend/src/components/LogViewer.jsx`)
为使得导出的 XML 能够被主流大语言模型（LLM）及排障程序完美解析，对所有字段值进行了标准的字符实体转义防护：

```javascript
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
```

---

## 3. 注意事项
1. **后端服务热更新**: 在更改 Python 的 API Prefix 路由为 `/api/v1` 后，必须彻底杀掉旧的后台 FastAPI 进程（使用 `lsof -i :8000` 并 `kill`）再重新拉起，方可使新规则对前端与 CLI 完全生效。
2. **Vite 客户端自动响应**: 由于移除了健康检测相关的 `/api/system/status` 端口，客户端的连通性探测变更为对 `http://127.0.0.1:8000/health` 的心跳请求，从而完美兼容并保留了左下角的 API Gateway 状态状态指示灯。
3. **CLI 离线特征**: CLI 命令行脚本 `./mini-tool logs` 是通过直连 MySQL 会话操作，离线依然具备清空和多格式导出的完整自治性，不要试图修改其为网络 API 形式。
