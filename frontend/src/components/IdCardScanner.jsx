import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import './IdCardScanner.css';

export default function IdCardScanner() {
  const { sessionId, logFrontendAction } = useApp();

  // 状态管理
  const [frontFile, setFrontFile] = useState(null);
  const [frontPreview, setFrontPreview] = useState('');
  const [backFile, setBackFile] = useState(null);
  const [backPreview, setBackPreview] = useState('');

  const [watermarkText, setWatermarkText] = useState('仅用于业务办理，他用无效');
  const [watermarkOpacity, setWatermarkOpacity] = useState(0.15);
  const [watermarkColor, setWatermarkColor] = useState('#8A8A8A');
  const [layout, setLayout] = useState('vertical'); // vertical | horizontal
  const [colorMode, setColorMode] = useState('grayscale'); // original | grayscale | monochrome (默认为黑白复印)
  const [brightness, setBrightness] = useState(1.0);
  const [contrast, setContrast] = useState(1.0);
  const [frontRotate, setFrontRotate] = useState(0); // 0, 90, 180, 270
  const [backRotate, setBackRotate] = useState(0); // 0, 90, 180, 270
  const [printScale, setPrintScale] = useState('1to1'); // 1to1 | fit
  const [fileName, setFileName] = useState('身份证复印件.pdf');

  // 生成状态
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [generatedPdf, setGeneratedPdf] = useState(null); // { fileId, downloadUrl }

  // 文件输入引用
  const frontInputRef = useRef(null);
  const backInputRef = useRef(null);
  const previewCanvasRef = useRef(null);

  // 处理预览清理
  useEffect(() => {
    return () => {
      if (frontPreview) URL.revokeObjectURL(frontPreview);
      if (backPreview) URL.revokeObjectURL(backPreview);
    };
  }, [frontPreview, backPreview]);

  // 处理上传图片
  const handleFileChange = (e, side) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('请上传有效的图片文件！');
      return;
    }
    const url = URL.createObjectURL(file);
    if (side === 'front') {
      setFrontFile(file);
      setFrontPreview(url);
    } else {
      setBackFile(file);
      setBackPreview(url);
    }
    setGeneratedPdf(null); // 有变动时清空已生成的PDF
  };

  // 拖拽处理
  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e, side) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('请上传有效的图片文件！');
      return;
    }
    const url = URL.createObjectURL(file);
    if (side === 'front') {
      setFrontFile(file);
      setFrontPreview(url);
    } else {
      setBackFile(file);
      setBackPreview(url);
    }
    setGeneratedPdf(null);
  };

  // 剪贴板粘贴
  const handlePaste = (e, side) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        const url = URL.createObjectURL(file);
        if (side === 'front') {
          setFrontFile(file);
          setFrontPreview(url);
        } else {
          setBackFile(file);
          setBackPreview(url);
        }
        setGeneratedPdf(null);
        break;
      }
    }
  };

  // 清除图片
  const clearImage = (side) => {
    if (side === 'front') {
      if (frontPreview) URL.revokeObjectURL(frontPreview);
      setFrontFile(null);
      setFrontPreview('');
      setFrontRotate(0);
    } else {
      if (backPreview) URL.revokeObjectURL(backPreview);
      setBackFile(null);
      setBackPreview('');
      setBackRotate(0);
    }
    setGeneratedPdf(null);
  };

  // HTML5 Canvas 实时 A4 物理排版预览渲染
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // 设置 Canvas 物理分辨率（以保持高清 A4 比例）
    // A4 比例为 1 : 1.414。我们设置宽为 600，高为 848
    canvas.width = 600;
    canvas.height = 848;
    
    // 绘制 A4 纸底色与网格线 (以显 premium)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 600, 848);
    
    // 绘制一个淡雅的页面虚线框边距线
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.05)';
    ctx.lineWidth = 1;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(30, 30, 540, 788);
    ctx.setLineDash([]); // 还原

    // 身份证在 Canvas 上的比例尺寸
    // A4: 595 x 842 点。身份证: 243 x 153。
    // 在 600 x 848 预览画布中：
    // 1:1 标准模式: 宽 = 245，高 = 155
    // fit 铺满模式: 宽 = 450，高 = 285
    let cardW = 245;
    let cardH = 155;
    if (printScale === 'fit') {
      cardW = 450;
      cardH = 285;
    }

    const drawCard = (previewUrl, x, y, angle, side) => {
      // 绘制占位框 (如果未上传)
      if (!previewUrl) {
        ctx.fillStyle = '#F2F2F7';
        ctx.fillRect(x, y, cardW, cardH);
        
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.1)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x, y, cardW, cardH);
        
        ctx.fillStyle = '#8E8E93';
        ctx.font = '14px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(side === 'front' ? '身份证正面 (未上传)' : '身份证反面 (未上传)', x + cardW / 2, y + cardH / 2);
        return;
      }

      // 如果已上传，则绘制图片
      const img = new Image();
      img.src = previewUrl;
      img.onload = () => {
        ctx.save();
        
        // 创建卡片独立的离屏缓冲，以便完美渲染色彩/旋转滤镜
        const cardCanvas = document.createElement('canvas');
        cardCanvas.width = cardW;
        cardCanvas.height = cardH;
        const cardCtx = cardCanvas.getContext('2d');
        
        // 渲染旋转
        cardCtx.save();
        cardCtx.translate(cardW / 2, cardH / 2);
        cardCtx.rotate((angle * Math.PI) / 180);
        
        // 在旋转后绘制原图
        // 智能拉伸/居中填充原图
        cardCtx.drawImage(img, -cardW / 2, -cardH / 2, cardW, cardH);
        cardCtx.restore();
        
        // 应用色彩滤镜 (黑白复印/二值化)
        const imgData = cardCtx.getImageData(0, 0, cardW, cardH);
        const data = imgData.data;
        
        for (let i = 0; i < data.length; i += 4) {
          let r = data[i];
          let g = data[i+1];
          let b = data[i+2];
          
          // 对比度亮度调整
          r = ((r - 128) * contrast) + 128 * brightness;
          g = ((g - 128) * contrast) + 128 * brightness;
          b = ((b - 128) * contrast) + 128 * brightness;
          
          // 色彩模式处理
          if (colorMode === 'grayscale') {
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            r = g = b = gray;
          } else if (colorMode === 'monochrome') {
            const gray = 0.299 * r + 0.587 * g + 0.114 * b;
            const mono = gray > 127 ? 255 : 0;
            r = g = b = mono;
          }
          
          data[i] = Math.max(0, Math.min(255, r));
          data[i+1] = Math.max(0, Math.min(255, g));
          data[i+2] = Math.max(0, Math.min(255, b));
        }
        cardCtx.putImageData(imgData, 0, 0);

        // 在卡片层叠防伪倾斜水印 (所见即所得)
        if (watermarkText) {
          cardCtx.save();
          // 文字大小随比例缩放
          const fSize = Math.max(10, Math.floor(cardW * 0.045));
          cardCtx.font = `${fSize}px PingFang SC, sans-serif`;
          cardCtx.fillStyle = watermarkColor;
          cardCtx.globalAlpha = watermarkOpacity;
          
          // 平铺倾斜文字
          cardCtx.translate(cardW / 2, cardH / 2);
          cardCtx.rotate((-30 * Math.PI) / 180);
          cardCtx.translate(-cardW / 2, -cardH / 2);
          
          for (let wy = -cardH; wy < cardH * 2; wy += fSize * 2.5) {
            for (let wx = -cardW; wx < cardW * 2; wx += fSize * len(watermarkText) * 0.6 + 20) {
              cardCtx.fillText(watermarkText, wx, wy);
            }
          }
          cardCtx.restore();
        }

        // 把渲染完毕的卡片贴回主 A4 画布
        ctx.shadowColor = 'rgba(0, 0, 0, 0.08)';
        ctx.shadowBlur = 10;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 4;
        ctx.drawImage(cardCanvas, x, y);
        ctx.restore();
      };
    };

    // 根据布局计算绘制坐标
    if (layout === 'vertical') {
      const x = (600 - cardW) / 2;
      let yFront = 480;
      let yBack = 220;
      if (printScale === 'fit') {
        yFront = 450;
        yBack = 120;
      }
      // 绘制反面（上方）和正面（下方），这符合中国习惯
      drawCard(frontPreview, x, yFront, frontRotate, 'front');
      drawCard(backPreview, x, yBack, backRotate, 'back');
    } else {
      let spacing = 30;
      let totalW = cardW * 2 + spacing;
      let xFront = (600 - totalW) / 2;
      let xBack = xFront + cardW + spacing;
      let y = (848 - cardH) / 2;
      drawCard(frontPreview, xFront, y, frontRotate, 'front');
      drawCard(backPreview, xBack, y, backRotate, 'back');
    }

  }, [frontPreview, backPreview, watermarkText, watermarkOpacity, watermarkColor, layout, colorMode, brightness, contrast, frontRotate, backRotate, printScale]);

  // 计算字符长度辅助函数
  const len = (str) => {
    return str ? str.length : 0;
  };

  // 生成 PDF 提交逻辑
  const handleGeneratePdf = async () => {
    if (!frontFile || !backFile) {
      alert('请先同时上传身份证正面和反面图片！');
      return;
    }

    setGenerating(true);
    setProgress(15);
    setGeneratedPdf(null);

    const formData = new FormData();
    formData.append('front_image', frontFile);
    formData.append('back_image', backFile);
    formData.append('watermark_text', watermarkText);
    formData.append('watermark_opacity', watermarkOpacity);
    formData.append('watermark_color', watermarkColor);
    formData.append('layout', layout);
    formData.append('color_mode', colorMode);
    formData.append('brightness', brightness);
    formData.append('contrast', contrast);
    formData.append('front_rotate', frontRotate);
    formData.append('back_rotate', backRotate);
    formData.append('print_scale', printScale);
    formData.append('file_name', fileName);
    formData.append('session_id', sessionId);

    // 进度模拟
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 90) {
          clearInterval(progressInterval);
          return 90;
        }
        return prev + 12;
      });
    }, 200);

    try {
      const response = await fetch('http://127.0.0.1:8000/api/v1/id-card/generate', {
        method: 'POST',
        body: formData
      });

      clearInterval(progressInterval);
      setProgress(100);

      if (response.ok) {
        const res = await response.json();
        if (res.code === 0) {
          setGeneratedPdf({
            fileId: res.data.file_id,
            downloadUrl: `http://127.0.0.1:8000${res.data.download_url}`,
            fileName: res.data.file_name
          });
          // 前端链路打点
          logFrontendAction('id-card-scanner', 'success', {
            layout,
            color_mode: colorMode,
            watermark: watermarkText,
            print_scale: printScale,
            cache_hit: false
          });
        } else {
          alert(`生成失败: ${res.message}`);
          logFrontendAction('id-card-scanner', 'error', params(), res.message);
        }
      } else {
        const errText = await response.text();
        alert(`服务器异常: ${errText}`);
        logFrontendAction('id-card-scanner', 'error', params(), errText);
      }
    } catch (err) {
      clearInterval(progressInterval);
      alert(`网络连接失败: ${err.message}`);
      logFrontendAction('id-card-scanner', 'error', params(), err.message, err.stack);
    } finally {
      setTimeout(() => {
        setGenerating(false);
        setProgress(0);
      }, 500);
    }
  };

  const params = () => {
    return {
      watermark_text: watermarkText,
      layout,
      color_mode: colorMode,
      print_scale: printScale
    };
  };

  // 一键静默浏览器打印
  const handlePrint = () => {
    if (!generatedPdf) return;
    // 使用一个隐藏的 iframe 加载并唤起系统打印
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.src = generatedPdf.downloadUrl;
    document.body.appendChild(iframe);
    
    iframe.onload = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      // 延迟清除
      setTimeout(() => {
        document.body.removeChild(iframe);
      }, 5000);
    };
  };

  return (
    <div className="id-card-scanner-container fade-in-slide-up">
      {/* 工具页眉 */}
      <div className="tool-header">
        <h2 className="tool-title">🪪 身份证扫描复印</h2>
        <p className="tool-subtitle">高精确度 1:1 原大拼贴，采用像素级水印防伪覆盖与智能对比度调节，安全合规。</p>
      </div>

      <div className="tool-workspace">
        {/* 左栏：上传与配置面板 */}
        <div className="config-panel">
          
          {/* 上传区域 */}
          <div className="upload-section">
            <h3 className="section-title">📥 1. 上传身份证正反面照片</h3>
            
            <div className="upload-grids">
              {/* 正面上传 */}
              <div 
                className={`upload-card ${frontFile ? 'has-file' : ''}`}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, 'front')}
                onPaste={(e) => handlePaste(e, 'front')}
              >
                {frontPreview ? (
                  <div className="preview-wrap">
                    <img src={frontPreview} alt="正面预览" className="card-img" />
                    <div className="img-overlay">
                      <button className="rotate-btn" onClick={() => setFrontRotate((prev) => (prev + 90) % 360)} title="旋转90°">🔄 旋转 90°</button>
                      <button className="delete-btn" onClick={() => clearImage('front')} title="删除">🗑️</button>
                    </div>
                  </div>
                ) : (
                  <div className="upload-placeholder" onClick={() => frontInputRef.current.click()}>
                    <span className="upload-icon">👤</span>
                    <span className="upload-text">点击上传正面 (头像面)</span>
                    <span className="upload-subtext">支持拖拽或直接剪贴板粘贴图片</span>
                    <input 
                      type="file" 
                      ref={frontInputRef} 
                      onChange={(e) => handleFileChange(e, 'front')}
                      accept="image/*"
                      style={{ display: 'none' }}
                    />
                  </div>
                )}
              </div>

              {/* 反面上传 */}
              <div 
                className={`upload-card ${backFile ? 'has-file' : ''}`}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDrop(e, 'back')}
                onPaste={(e) => handlePaste(e, 'back')}
              >
                {backPreview ? (
                  <div className="preview-wrap">
                    <img src={backPreview} alt="反面预览" className="card-img" />
                    <div className="img-overlay">
                      <button className="rotate-btn" onClick={() => setBackRotate((prev) => (prev + 90) % 360)} title="旋转90°">🔄 旋转 90°</button>
                      <button className="delete-btn" onClick={() => clearImage('back')} title="删除">🗑️</button>
                    </div>
                  </div>
                ) : (
                  <div className="upload-placeholder" onClick={() => backInputRef.current.click()}>
                    <span className="upload-icon">🏛️</span>
                    <span className="upload-text">点击上传反面 (国徽面)</span>
                    <span className="upload-subtext">支持拖拽或直接剪贴板粘贴图片</span>
                    <input 
                      type="file" 
                      ref={backInputRef} 
                      onChange={(e) => handleFileChange(e, 'back')}
                      accept="image/*"
                      style={{ display: 'none' }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* 精美 iPhone 原生连续互通扫描步骤指引 */}
            <div className="iphone-integration-box">
              <div className="integration-header">
                <span className="iphone-icon">📱</span>
                <h4>无线配合 iPhone 原生摄像头扫描步骤</h4>
              </div>
              <div className="integration-body">
                <div className="step-item">
                  <span className="step-badge">1</span>
                  <p>确保 Mac 与 iPhone 开启蓝牙，连接在同一个 Wi-Fi 并使用相同 Apple ID。</p>
                </div>
                <div className="step-item">
                  <span className="step-badge">2</span>
                  <p>点击上方任何卡片，弹出系统文件选择框，在文件空白列表区域<strong>右键点击</strong>。</p>
                </div>
                <div className="step-item">
                  <span className="step-badge">3</span>
                  <p>在弹出的菜单中，选择 <strong>“从 iPhone 导入” &gt; “扫描文档”</strong> (或拍照)。</p>
                </div>
                <div className="step-item">
                  <span className="step-badge">4</span>
                  <p>此时手持 iPhone 自动识别对准卡片拍摄，保存后图片将**无缝秒传**填入此处！</p>
                </div>
              </div>
            </div>

          </div>

          {/* 配置面板 */}
          <div className="options-section">
            <h3 className="section-title">⚙️ 2. 排版与色彩校正配置</h3>
            
            <div className="options-grid">
              
              {/* 打印比例 - 物理原大 vs 紫石英自适应铺满 */}
              <div className="opt-group scale-group">
                <label className="opt-label">打印页面比例 (Scale Mode)</label>
                <div className="scale-switches">
                  <button 
                    className={`scale-btn ${printScale === '1to1' ? 'active' : ''}`}
                    onClick={() => setPrintScale('1to1')}
                  >
                    📏 1:1 标准原大复印 <span className="scale-desc">85.6 × 54mm 标准规格</span>
                  </button>
                  <button 
                    className={`scale-btn amethyst-glow ${printScale === 'fit' ? 'active' : ''}`}
                    onClick={() => setPrintScale('fit')}
                  >
                    🔮 紫石英自适应铺满 <span className="scale-desc">无损缩放至最大可视比例</span>
                  </button>
                </div>
              </div>

              {/* 色彩转换模式 */}
              <div className="opt-group">
                <label className="opt-label">色彩复印效果 (默认黑白复印)</label>
                <div className="mode-pills">
                  <button 
                    className={`mode-pill ${colorMode === 'original' ? 'active' : ''}`}
                    onClick={() => setColorMode('original')}
                  >
                    🌈 彩色高保真
                  </button>
                  <button 
                    className={`mode-pill ${colorMode === 'grayscale' ? 'active' : ''}`}
                    onClick={() => setColorMode('grayscale')}
                  >
                    📠 黑白复印
                  </button>
                  <button 
                    className={`mode-pill ${colorMode === 'monochrome' ? 'active' : ''}`}
                    onClick={() => setColorMode('monochrome')}
                  >
                    ✍️ 黑白高对比
                  </button>
                </div>
              </div>

              {/* 排版布局选择 */}
              <div className="opt-group">
                <label className="opt-label">A4 页面堆叠方向</label>
                <div className="layout-select">
                  <button 
                    className={`layout-btn ${layout === 'vertical' ? 'active' : ''}`}
                    onClick={() => setLayout('vertical')}
                  >
                    ↕️ 纵向上下排列 (标准推荐)
                  </button>
                  <button 
                    className={`layout-btn ${layout === 'horizontal' ? 'active' : ''}`}
                    onClick={() => setLayout('horizontal')}
                  >
                    ↔️ 横向并排排列
                  </button>
                </div>
              </div>

              {/* 水印配置 */}
              <div className="opt-group watermark-group">
                <label className="opt-label">防篡改隐私水印内容</label>
                <input 
                  type="text" 
                  className="opt-input"
                  value={watermarkText}
                  onChange={(e) => setWatermarkText(e.target.value)}
                  placeholder="留空即为不添加水印"
                />
                
                <div className="slider-row">
                  <div className="slider-col">
                    <span className="slider-label">水印透明度: {(watermarkOpacity * 100).toFixed(0)}%</span>
                    <input 
                      type="range" 
                      min="0.05" 
                      max="0.6" 
                      step="0.05"
                      value={watermarkOpacity}
                      onChange={(e) => setWatermarkOpacity(parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="slider-col">
                    <span className="slider-label">水印颜色</span>
                    <input 
                      type="color" 
                      className="color-input"
                      value={watermarkColor}
                      onChange={(e) => setWatermarkColor(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* 画面预微调 */}
              <div className="opt-group adjustments-group">
                <label className="opt-label">图像增强调节滑块</label>
                <div className="slider-grid">
                  <div className="slider-item">
                    <span className="slider-label">亮度调整: {(brightness * 100).toFixed(0)}%</span>
                    <input 
                      type="range" 
                      min="0.5" 
                      max="1.8" 
                      step="0.1"
                      value={brightness}
                      onChange={(e) => setBrightness(parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="slider-item">
                    <span className="slider-label">对比度增强: {(contrast * 100).toFixed(0)}%</span>
                    <input 
                      type="range" 
                      min="0.5" 
                      max="1.8" 
                      step="0.1"
                      value={contrast}
                      onChange={(e) => setContrast(parseFloat(e.target.value))}
                    />
                  </div>
                </div>
              </div>

              {/* 保存文件名 */}
              <div className="opt-group">
                <label className="opt-label">输出文件名</label>
                <input 
                  type="text" 
                  className="opt-input"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  placeholder="身份证复印件.pdf"
                />
              </div>

            </div>
          </div>

          {/* 生成按钮区域 */}
          <div className="action-section">
            <button 
              className={`generate-btn ${generating ? 'loading' : ''}`}
              onClick={handleGeneratePdf}
              disabled={generating}
            >
              {generating ? (
                <div className="loading-wrap">
                  <span className="loading-spinner"></span>
                  <span>拼合生成中 {progress}% ...</span>
                </div>
              ) : (
                '🚀 生成 A4 PDF 复印件'
              )}
            </button>
          </div>

        </div>

        {/* 右栏：所见即所得 A4 实时物理预览区 */}
        <div className="preview-panel">
          <div className="panel-header">
            <span className="preview-badge">A4所见即所得物理预览 (WYSIWYG)</span>
            <span className="preview-desc">根据调整滑块瞬时渲染。1:1 复印将精确控制真实打印机物理尺寸。</span>
          </div>
          
          <div className="a4-container-wrap">
            <div className="a4-page-frame">
              <canvas ref={previewCanvasRef} className="a4-canvas" />
            </div>
          </div>

          {/* 生成后的下载预览层 */}
          {generatedPdf && (
            <div className="output-overlay glass-panel fade-in">
              <div className="output-header">
                <span className="output-icon">🎉</span>
                <div className="output-meta">
                  <h4>PDF 复印件拼合完成！</h4>
                  <p>文件 ID: {generatedPdf.fileId.substring(0, 16)}...</p>
                </div>
              </div>
              <div className="output-actions">
                <a 
                  href={generatedPdf.downloadUrl} 
                  download={generatedPdf.fileName}
                  className="out-btn dl-btn"
                >
                  📥 下载 PDF
                </a>
                <button 
                  className="out-btn pr-btn"
                  onClick={handlePrint}
                >
                  🖨️ 立即打印 (静默)
                </button>
                <button 
                  className="out-btn cl-btn"
                  onClick={() => setGeneratedPdf(null)}
                >
                  ✨ 重置
                </button>
              </div>
              <div className="iframe-preview-wrap">
                <iframe src={generatedPdf.downloadUrl} title="PDF 打印预览" className="pdf-iframe" />
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
