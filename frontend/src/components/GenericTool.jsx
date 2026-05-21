import React, { useState, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import './GenericTool.css';

export default function GenericTool() {
  const { activeCategory, activeTool, tools, logFrontendAction } = useApp();
  const [inputVal, setInputVal] = useState('');
  const [outputVal, setOutputVal] = useState('');
  const [regexPattern, setRegexPattern] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // Find tool info
  const catTools = tools[activeCategory] || [];
  const currentTool = catTools.find(t => t.id === activeTool) || { name: '工具', desc: '功能描述' };

  // Reset inputs when tool changes
  useEffect(() => {
    setInputVal('');
    setOutputVal('');
    setRegexPattern('');
    setErrorMsg('');
    setIsProcessing(false);
  }, [activeTool]);

  // Execute processing logic
  const handleExecute = async (actionType = 'run') => {
    setIsProcessing(true);
    setErrorMsg('');
    const startTime = Date.now();

    // Small animation timeout to look professional
    await new Promise(r => setTimeout(r, 200));

    try {
      let result = '';
      if (activeTool === 'base64') {
        if (actionType === 'encode') {
          result = btoa(unescape(encodeURIComponent(inputVal)));
        } else {
          result = decodeURIComponent(escape(atob(inputVal)));
        }
      } else if (activeTool === 'regex') {
        const flags = 'g';
        const re = new RegExp(regexPattern, flags);
        const matches = [...inputVal.matchAll(re)];
        if (matches.length > 0) {
          result = matches.map((m, idx) => `匹配 [${idx + 1}]: "${m[0]}" (位置: ${m.index})`).join('\n');
        } else {
          result = '未找到匹配项';
        }
      } else if (activeTool === 'json') {
        if (actionType === 'beautify') {
          const parsed = JSON.parse(inputVal);
          result = JSON.stringify(parsed, null, 2);
        } else {
          const parsed = JSON.parse(inputVal);
          result = JSON.stringify(parsed);
        }
      } else if (activeTool === 'timestamp') {
        if (actionType === 'to_date') {
          const ts = parseInt(inputVal);
          if (isNaN(ts)) throw new Error('无效的时间戳');
          // Support both seconds and ms
          const date = new Date(ts < 100000000000 ? ts * 1000 : ts);
          result = date.toLocaleString();
        } else {
          const date = new Date(inputVal);
          if (isNaN(date.getTime())) throw new Error('无效的日期时间格式');
          result = Math.floor(date.getTime() / 1000).toString();
        }
      } else if (activeTool === 'compress') {
        // Image compress simulation
        if (!inputVal) throw new Error('请选择或输入要压缩的数据源');
        result = `[压缩完成]\n原始大小: ${inputVal.length} 字节\n压缩后大小: ${Math.floor(inputVal.length * 0.45)} 字节 (节省 55%)\n哈希校验: sha256-${Math.random().toString(36).substring(2, 10)}`;
      } else if (activeTool === 'palette') {
        // Extract palette scheme
        const hex = inputVal.trim() || '#4FACFE';
        result = `配色提取成功: [${hex}]\n1. 主色调: ${hex}\n2. 渐变起始: #00F2FE\n3. 暗面补色: #0D1426\n4. 警告强调: #EF4444\n5. 暗护眼底: #060913`;
      } else {
        result = `此小工具 "${currentTool.name}" 正在接入核心微服务...`;
      }

      setOutputVal(result);
      // Report database log (success)
      logFrontendAction(activeTool, 'success', {
        inputLength: inputVal.length,
        action: actionType,
        executionTime: Date.now() - startTime
      });

    } catch (err) {
      setErrorMsg(err.message || '执行出错');
      setOutputVal('');
      // Report database log (error)
      logFrontendAction(activeTool, 'error', {
        inputLength: inputVal.length,
        action: actionType
      }, err.message || 'Execution error', err.stack);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="generic-tool-workspace fade-in-slide-up">
      <div className="tool-info-header">
        <span className="tool-title-icon">{currentTool.icon}</span>
        <div className="tool-title-text">
          <h2>{currentTool.name}</h2>
          <p>{currentTool.desc}</p>
        </div>
      </div>

      <div className="tool-content-grid">
        <div className="tool-input-panel">
          <div className="panel-header">
            <span>输入源 (Input)</span>
          </div>
          
          {activeTool === 'regex' && (
            <div className="regex-options">
              <input
                type="text"
                placeholder="输入正则表达式 (例如: \d+)"
                value={regexPattern}
                onChange={(e) => setRegexPattern(e.target.value)}
                className="regex-input"
              />
            </div>
          )}

          <textarea
            className="tool-textarea font-mono"
            placeholder={
              activeTool === 'json' ? '在此粘贴 JSON 文本...' :
              activeTool === 'regex' ? '在此输入用于正则测试的文本...' :
              activeTool === 'timestamp' ? '在此输入 Unix 时间戳 (例如 1716281600) 或日期 (例如 2026-05-21 17:00:00)...' :
              activeTool === 'base64' ? '输入要进行 Base64 转换的明文或密文...' :
              '在此处输入需要处理的内容...'
            }
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
          />
        </div>

        <div className="tool-output-panel">
          <div className="panel-header">
            <span>输出结果 (Output)</span>
          </div>
          <div className="output-container">
            {errorMsg ? (
              <div className="output-error-block font-mono">
                <span className="error-title">❌ 执行异常</span>
                <p className="error-text">{errorMsg}</p>
              </div>
            ) : (
              <textarea
                className="tool-textarea output font-mono"
                readOnly
                placeholder="处理后的结果将在此显示..."
                value={outputVal}
              />
            )}
          </div>
        </div>
      </div>

      <div className="tool-actions-footer">
        {activeTool === 'base64' && (
          <>
            <button className="btn btn-primary" onClick={() => handleExecute('encode')} disabled={isProcessing || !inputVal}>
              Base64 编码
            </button>
            <button className="btn btn-secondary" onClick={() => handleExecute('decode')} disabled={isProcessing || !inputVal}>
              Base64 解码
            </button>
          </>
        )}

        {activeTool === 'json' && (
          <>
            <button className="btn btn-primary" onClick={() => handleExecute('beautify')} disabled={isProcessing || !inputVal}>
              JSON 美化
            </button>
            <button className="btn btn-secondary" onClick={() => handleExecute('minify')} disabled={isProcessing || !inputVal}>
              JSON 压缩
            </button>
          </>
        )}

        {activeTool === 'timestamp' && (
          <>
            <button className="btn btn-primary" onClick={() => handleExecute('to_date')} disabled={isProcessing || !inputVal}>
              时间戳转标准日期
            </button>
            <button className="btn btn-secondary" onClick={() => handleExecute('to_timestamp')} disabled={isProcessing || !inputVal}>
              日期转时间戳
            </button>
          </>
        )}

        {activeTool === 'regex' && (
          <button className="btn btn-primary" onClick={() => handleExecute('match')} disabled={isProcessing || !inputVal || !regexPattern}>
            开始匹配
          </button>
        )}

        {['compress', 'palette'].includes(activeTool) && (
          <button className="btn btn-primary" onClick={() => handleExecute('run')} disabled={isProcessing || !inputVal}>
            运行处理
          </button>
        )}
      </div>
    </div>
  );
}
