import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import './IdCardScanner.css';

/**
 * 纯前端高性能身份证边缘与区域提取算法 (Sobel算子 + 投影密度分析)
 * @param {HTMLImageElement} img 原始Image对象
 * @returns {Object} { success: boolean, x: number, y: number, width: number, height: number }
 */
/**
 * 纯前端高性能身份证边缘与区域提取算法 (自适应双向二值化 + 边缘闭合漫水填充 + 几何打分排名)
 * @param {HTMLImageElement} img 原始Image对象
 * @returns {Object} { success: boolean, x: number, y: number, width: number, height: number }
 */
function detectIdCardRect(img) {
  try {
    // 1. 下采样处理，控制在 160px 左右，极大提升纯 JS 像素遍历的速度并实现高频滤波去噪
    const canvas = document.createElement('canvas');
    const maxDim = 160;
    let w = img.width;
    let h = img.height;
    if (w > maxDim || h > maxDim) {
      if (w > h) {
        h = Math.round((h * maxDim) / w);
        w = maxDim;
      } else {
        w = Math.round((w * maxDim) / h);
        h = maxDim;
      }
    }
    canvas.width = w;
    canvas.height = h;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // 2. 灰度化处理
    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0; i < data.length; i += 4) {
      gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }

    // 3. 辅助函数：计算 Otsu 自适应灰度二值化阈值
    const getOtsuThreshold = (grayArr) => {
      const hist = new Int32Array(256);
      for (let i = 0; i < grayArr.length; i++) {
        hist[grayArr[i]]++;
      }
      const total = grayArr.length;
      let sum = 0;
      for (let i = 0; i < 256; i++) sum += i * hist[i];

      let sumB = 0;
      let wB = 0;
      let wF = 0;
      let varMax = 0;
      let threshold = 128;

      for (let i = 0; i < 256; i++) {
        wB += hist[i];
        if (wB === 0) continue;
        wF = total - wB;
        if (wF === 0) break;

        sumB += i * hist[i];
        const mB = sumB / wB;
        const mF = (sum - sumB) / wF;

        const varBetween = wB * wF * (mB - mF) * (mB - mF);
        if (varBetween > varMax) {
          varMax = varBetween;
          threshold = i;
        }
      }
      return threshold;
    };

    const otsuThresh = getOtsuThreshold(gray);

    // 4. 辅助函数：广度优先搜索 (BFS) 寻找连通域，避免 JS 递归导致的大图爆栈
    const findConnectedComponents = (binaryData) => {
      const visited = new Uint8Array(w * h);
      const components = [];
      
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (binaryData[idx] === 1 && !visited[idx]) {
            let minX = x, maxX = x, minY = y, maxY = y;
            let area = 0;
            const queue = [idx];
            visited[idx] = 1;
            
            let head = 0;
            while (head < queue.length) {
              const curIdx = queue[head++];
              const cx = curIdx % w;
              const cy = Math.floor(curIdx / w);
              area++;

              if (cx < minX) minX = cx;
              if (cx > maxX) maxX = cx;
              if (cy < minY) minY = cy;
              if (cy > maxY) maxY = cy;

              // 4邻域扩散
              const neighbors = [curIdx - 1, curIdx + 1, curIdx - w, curIdx + w];
              for (const nIdx of neighbors) {
                if (nIdx >= 0 && nIdx < w * h) {
                  const nx = nIdx % w;
                  const ny = Math.floor(nIdx / w);
                  // 避免跨行换边折返
                  if (Math.abs(nx - cx) <= 1) {
                    if (binaryData[nIdx] === 1 && !visited[nIdx]) {
                      visited[nIdx] = 1;
                      queue.push(nIdx);
                    }
                  }
                }
              }
            }

            components.push({
              minX, maxX, minY, maxY,
              width: maxX - minX + 1,
              height: maxY - minY + 1,
              area
            });
          }
        }
      }
      return components;
    };

    // 5. 构建候选矩形池
    const candidates = [];

    // --- 通道一：Otsu 正向二值化连通域 (用于深色桌面上的浅色身份证) ---
    const binNormal = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      binNormal[i] = gray[i] >= otsuThresh ? 1 : 0;
    }
    const compsNormal = findConnectedComponents(binNormal);
    candidates.push(...compsNormal.map(c => ({ ...c, source: 'otsu-normal' })));

    // --- 通道二：Otsu 反向二值化连通域 (用于白桌子上的深色卡套/暗身份证) ---
    const binInverted = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      binInverted[i] = gray[i] < otsuThresh ? 1 : 0;
    }
    const compsInverted = findConnectedComponents(binInverted);
    candidates.push(...compsInverted.map(c => ({ ...c, source: 'otsu-inverted' })));

    // --- 通道三：Sobel 强边缘闭合 + 背景漫水填充 (用于极低对比度、白白对比或纯边缘封闭场景) ---
    const grad = new Float32Array(w * h);
    let maxGrad = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const gx =
          gray[(y - 1) * w + x + 1] + 2 * gray[y * w + x + 1] + gray[(y + 1) * w + x + 1] -
          (gray[(y - 1) * w + x - 1] + 2 * gray[y * w + x - 1] + gray[(y + 1) * w + x - 1]);
        const gy =
          gray[(y + 1) * w + x - 1] + 2 * gray[(y + 1) * w + x] + gray[(y + 1) * w + x + 1] -
          (gray[(y - 1) * w + x - 1] + 2 * gray[(y - 1) * w + x] + gray[(y - 1) * w + x - 1]);
        const m = Math.sqrt(gx * gx + gy * gy);
        grad[y * w + x] = m;
        if (m > maxGrad) maxGrad = m;
      }
    }

    // 提取强边缘 (选择前 15% 强梯度的像素值作为阈值)
    const nonzeroGrads = [];
    for (let i = 0; i < w * h; i++) {
      if (grad[i] > 2) nonzeroGrads.push(grad[i]);
    }
    nonzeroGrads.sort((a, b) => a - b);
    const threshIdx = Math.floor(nonzeroGrads.length * 0.85); // 分位数
    const gradThresh = nonzeroGrads.length > 0 ? nonzeroGrads[threshIdx] : 20;

    const edgeBin = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      edgeBin[i] = grad[i] >= gradThresh ? 1 : 0;
    }

    // 3x3 边缘膨胀以连接微小的断点，形成封闭外框
    const edgeDilated = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = y * w + x;
        if (edgeBin[idx] === 1) {
          edgeDilated[idx] = 1;
          continue;
        }
        let hasNeighbor = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ny = y + dy;
            const nx = x + dx;
            if (ny >= 0 && ny < h && nx >= 0 && nx < w) {
              if (edgeBin[ny * w + nx] === 1) {
                hasNeighbor = true;
                break;
              }
            }
          }
          if (hasNeighbor) break;
        }
        edgeDilated[idx] = hasNeighbor ? 1 : 0;
      }
    }

    // 从四周边界所有无边缘的点进行漫水填充以提取背景，被边缘阻挡的部分保留为前景
    const bgMask = new Uint8Array(w * h);
    const bgQueue = [];
    
    // 搜集上下左右边缘的种子点
    for (let x = 0; x < w; x++) {
      if (edgeDilated[x] === 0) { bgMask[x] = 1; bgQueue.push(x); }
      const bottomIdx = (h - 1) * w + x;
      if (edgeDilated[bottomIdx] === 0 && !bgMask[bottomIdx]) { bgMask[bottomIdx] = 1; bgQueue.push(bottomIdx); }
    }
    for (let y = 0; y < h; y++) {
      const leftIdx = y * w;
      if (edgeDilated[leftIdx] === 0 && !bgMask[leftIdx]) { bgMask[leftIdx] = 1; bgQueue.push(leftIdx); }
      const rightIdx = y * w + (w - 1);
      if (edgeDilated[rightIdx] === 0 && !bgMask[rightIdx]) { bgMask[rightIdx] = 1; bgQueue.push(rightIdx); }
    }

    // 广度优先漫水填充
    let bgHead = 0;
    while (bgHead < bgQueue.length) {
      const curIdx = bgQueue[bgHead++];
      const cx = curIdx % w;
      const cy = Math.floor(curIdx / w);

      const neighbors = [curIdx - 1, curIdx + 1, curIdx - w, curIdx + w];
      for (const nIdx of neighbors) {
        if (nIdx >= 0 && nIdx < w * h) {
          const nx = nIdx % w;
          const ny = Math.floor(nIdx / w);
          if (Math.abs(nx - cx) <= 1) {
            if (edgeDilated[nIdx] === 0 && !bgMask[nIdx]) {
              bgMask[nIdx] = 1;
              bgQueue.push(nIdx);
            }
          }
        }
      }
    }

    // 提取前景非背景区域（即 bgMask 为 0 的闭合漏洞区域）
    const fgBin = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      fgBin[i] = bgMask[i] === 0 ? 1 : 0;
    }
    const compsEdgeHole = findConnectedComponents(fgBin);
    candidates.push(...compsEdgeHole.map(c => ({ ...c, source: 'edge-hole' })));

    // 6. 多维度评估与打分体系
    let bestCandidate = null;
    let maxScore = -1;

    for (const comp of candidates) {
      // A. 宽高比打分 (身份证 1.586，合理比例容差 [1.1, 2.1])
      const ratio = comp.width / comp.height;
      const ratioNorm = ratio < 1.0 ? 1.0 / ratio : ratio; // 完美兼容竖版拍摄的转换
      if (ratioNorm < 1.1 || ratioNorm > 2.1) continue;

      const diff = Math.abs(ratioNorm - 1.586);
      const scoreRatio = Math.max(0, 1.0 - diff / 0.4); // 越接近 1.586 得分越高

      // B. 面积合理性打分 (占比全图的 8% ~ 85%)
      const areaPct = (comp.width * comp.height) / (w * h);
      if (areaPct < 0.08 || areaPct > 0.85) continue;
      // 倾向于面积中等偏大的矩形 (避开噪点，一般身份证在中心占据 20%~60% 面积)
      const scoreArea = areaPct;

      // C. 图像中心契合度打分 (拍照身份证一般位于图像中央)
      const cx = comp.minX + comp.width / 2;
      const cy = comp.minY + comp.height / 2;
      const distToCenter = Math.sqrt((cx - w / 2) ** 2 + (cy - h / 2) ** 2);
      const maxDist = Math.sqrt((w / 2) ** 2 + (h / 2) ** 2);
      const scoreCenter = 1.0 - distToCenter / maxDist;

      // D. 连通域内部实心填充率过滤 (防止空心细线)
      const fillRatio = comp.area / (comp.width * comp.height);
      if (fillRatio < 0.45) continue;

      // 加权综合得分：宽高比(45%) + 中心度(30%) + 面积合理度(25%)
      const totalScore = scoreRatio * 0.45 + scoreCenter * 0.3 + scoreArea * 0.25;

      if (totalScore > maxScore) {
        maxScore = totalScore;
        bestCandidate = comp;
      }
    }

    // 7. 导出最终结果 (如果评分达到基础合理度阈值 0.40)
    if (bestCandidate && maxScore >= 0.40) {
      const scaleX = img.width / w;
      const scaleY = img.height / h;
      return {
        success: true,
        x: Math.round(bestCandidate.minX * scaleX),
        y: Math.round(bestCandidate.minY * scaleY),
        width: Math.round(bestCandidate.width * scaleX),
        height: Math.round(bestCandidate.height * scaleY),
        score: maxScore,
        source: bestCandidate.source
      };
    }

    return { success: false };
  } catch (e) {
    console.error("ID card edge detection failed: ", e);
    return { success: false };
  }
}

export default function IdCardScanner() {
  const { sessionId, logFrontendAction } = useApp();

  // 状态管理
  const [frontFile, setFrontFile] = useState(null);
  const [frontPreview, setFrontPreview] = useState('');
  const [frontOriginal, setFrontOriginal] = useState(null); // 原始大图以支持重新裁切
  const [backFile, setBackFile] = useState(null);
  const [backPreview, setBackPreview] = useState('');
  const [backOriginal, setBackOriginal] = useState(null); // 原始大图以支持重新裁切

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

  // 保存正反面各自动/手动微调的裁剪缩放与平移参数
  const [frontCropParams, setFrontCropParams] = useState({ zoom: 1.0, offset: { x: 0, y: 0 } });
  const [backCropParams, setBackCropParams] = useState({ zoom: 1.0, offset: { x: 0, y: 0 } });

  // 证件裁切相关状态
  const [cropModal, setCropModal] = useState({ isOpen: false, side: null, imgSrc: null });
  const [cropZoom, setCropZoom] = useState(1.0);
  const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
  const [isCropDragging, setIsCropDragging] = useState(false);
  const [cropStartPos, setCropStartPos] = useState({ x: 0, y: 0 });

  // 生成状态
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [generatedPdf, setGeneratedPdf] = useState(null); // { fileId, downloadUrl }

  // 文件输入引用
  const frontInputRef = useRef(null);
  const backInputRef = useRef(null);
  const previewCanvasRef = useRef(null);

  // 处理正面预览清理
  useEffect(() => {
    return () => {
      if (frontPreview) URL.revokeObjectURL(frontPreview);
    };
  }, [frontPreview]);

  // 处理反面预览清理
  useEffect(() => {
    return () => {
      if (backPreview) URL.revokeObjectURL(backPreview);
    };
  }, [backPreview]);

  // 裁切模态框逻辑
  const openCropModal = (side, file) => {
    const params = side === 'front' ? frontCropParams : backCropParams;
    const reader = new FileReader();
    reader.onload = () => {
      setCropZoom(params.zoom);
      setCropOffset({ x: params.offset.x, y: params.offset.y });
      setCropModal({
        isOpen: true,
        side,
        imgSrc: reader.result
      });
    };
    reader.readAsDataURL(file);
  };

  const handleCropMouseDown = (e) => {
    setIsCropDragging(true);
    setCropStartPos({ x: e.clientX - cropOffset.x, y: e.clientY - cropOffset.y });
  };

  const handleCropMouseMove = (e) => {
    if (!isCropDragging) return;
    setCropOffset({
      x: e.clientX - cropStartPos.x,
      y: e.clientY - cropStartPos.y
    });
  };

  const handleCropMouseUp = () => {
    setIsCropDragging(false);
  };

  const handleCropTouchStart = (e) => {
    if (e.touches.length === 1) {
      setIsCropDragging(true);
      const touch = e.touches[0];
      setCropStartPos({ x: touch.clientX - cropOffset.x, y: touch.clientY - cropOffset.y });
    }
  };

  const handleCropTouchMove = (e) => {
    if (!isCropDragging || e.touches.length !== 1) return;
    const touch = e.touches[0];
    setCropOffset({
      x: touch.clientX - cropStartPos.x,
      y: touch.clientY - cropStartPos.y
    });
  };

  // 核心自动图像分析、边缘提取、参数重定位与自动裁剪流
  const handleFileProcess = (file, side) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.src = reader.result;
      img.onload = () => {
        // 1. 调用边缘检测算法
        const detection = detectIdCardRect(img);

        const frameW = 380;
        const frameH = 240;
        const scaleToFit = Math.max(frameW / img.width, frameH / img.height);

        let finalZoom = 1.0;
        let finalOffset = { x: 0, y: 0 };

        if (detection.success) {
          // A. 成功识别：利用数学公式反算出让身份证正好完美铺满 frame 的 zoom 和 offset
          const { x, y, width, height } = detection;
          finalZoom = Math.min(3.0, Math.max(1.0, frameW / (width * scaleToFit)));
          finalOffset = {
            x: (img.width / 2 - (x + width / 2)) * scaleToFit * finalZoom,
            y: (img.height / 2 - (y + height / 2)) * scaleToFit * finalZoom
          };
        } else {
          // B. 识别失败：友好报警提示并降级为居中裁剪
          alert(`💡 提示：未能自动识别出清晰的身份证边缘。
请尽量上传“背景对比鲜明、光线均匀、四周无遮挡且平铺”的身份证原图。

已自动为您居中裁剪，您可以点击图片上出现的“✂️ 裁切”按钮进行手动调整。`);
          finalZoom = 1.0;
          finalOffset = { x: 0, y: 0 };
        }

        // 保存大图以支持重新裁切，并保存计算所得的裁剪微调坐标
        if (side === 'front') {
          setFrontOriginal(file);
          setFrontCropParams({ zoom: finalZoom, offset: finalOffset });
        } else {
          setBackOriginal(file);
          setBackCropParams({ zoom: finalZoom, offset: finalOffset });
        }

        // 2. 在离屏 Canvas 中自动剪裁并导出
        const canvas = document.createElement('canvas');
        canvas.width = 856;
        canvas.height = 540;
        const ctx = canvas.getContext('2d');

        const drawW = img.width * scaleToFit;
        const drawH = img.height * scaleToFit;
        const k = 856 / frameW;

        const finalLeft = (frameW / 2 + finalOffset.x - (drawW * finalZoom) / 2) * k;
        const finalTop = (frameH / 2 + finalOffset.y - (drawH * finalZoom) / 2) * k;
        const finalW = drawW * finalZoom * k;
        const finalH = drawH * finalZoom * k;

        ctx.drawImage(img, finalLeft, finalTop, finalW, finalH);

        canvas.toBlob((blob) => {
          const croppedUrl = URL.createObjectURL(blob);
          if (side === 'front') {
            setFrontFile(new File([blob], "front_cropped.jpg", { type: "image/jpeg" }));
            setFrontPreview(croppedUrl);
          } else {
            setBackFile(new File([blob], "back_cropped.jpg", { type: "image/jpeg" }));
            setBackPreview(croppedUrl);
          }
          setGeneratedPdf(null);
        }, 'image/jpeg', 0.95);
      };
    };
    reader.readAsDataURL(file);
  };

  const handleSaveCrop = () => {
    const img = new Image();
    img.src = cropModal.imgSrc;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 856;
      canvas.height = 540;
      const ctx = canvas.getContext('2d');
      
      const frameW = 380;
      const frameH = 240;
      
      const scaleToFit = Math.max(frameW / img.width, frameH / img.height);
      const drawW = img.width * scaleToFit;
      const drawH = img.height * scaleToFit;
      
      const k = 856 / frameW;
      
      const finalLeft = (frameW / 2 + cropOffset.x - (drawW * cropZoom) / 2) * k;
      const finalTop = (frameH / 2 + cropOffset.y - (drawH * cropZoom) / 2) * k;
      const finalW = drawW * cropZoom * k;
      const finalH = drawH * cropZoom * k;
      
      ctx.drawImage(img, finalLeft, finalTop, finalW, finalH);
      
      canvas.toBlob((blob) => {
        const croppedUrl = URL.createObjectURL(blob);
        if (cropModal.side === 'front') {
          setFrontFile(new File([blob], "front_cropped.jpg", { type: "image/jpeg" }));
          setFrontPreview(croppedUrl);
          setFrontCropParams({ zoom: cropZoom, offset: { x: cropOffset.x, y: cropOffset.y } });
        } else {
          setBackFile(new File([blob], "back_cropped.jpg", { type: "image/jpeg" }));
          setBackPreview(croppedUrl);
          setBackCropParams({ zoom: cropZoom, offset: { x: cropOffset.x, y: cropOffset.y } });
        }
        setGeneratedPdf(null);
        setCropModal({ isOpen: false, side: null, imgSrc: null });
      }, 'image/jpeg', 0.95);
    };
  };

  const handleRecrop = (side) => {
    const originalFile = side === 'front' ? frontOriginal : backOriginal;
    if (originalFile) {
      openCropModal(side, originalFile);
    }
  };

  // 处理上传图片
  const handleFileChange = (e, side) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      alert('请上传有效的图片文件！');
      return;
    }
    handleFileProcess(file, side);
    e.target.value = ''; // 清空以保证同一个文件能够重复上传触发
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
    handleFileProcess(file, side);
  };

  // 剪贴板粘贴
  const handlePaste = (e, side) => {
    const items = e.clipboardData.items;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf('image') !== -1) {
        const file = items[i].getAsFile();
        handleFileProcess(file, side);
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
      setFrontOriginal(null);
      setFrontRotate(0);
      setFrontCropParams({ zoom: 1.0, offset: { x: 0, y: 0 } });
    } else {
      if (backPreview) URL.revokeObjectURL(backPreview);
      setBackFile(null);
      setBackPreview('');
      setBackOriginal(null);
      setBackRotate(0);
      setBackCropParams({ zoom: 1.0, offset: { x: 0, y: 0 } });
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
      let yFront = 220;
      let yBack = 480;
      if (printScale === 'fit') {
        yFront = 120;
        yBack = 450;
      }
      // 绘制正面（上方）和反面（下方），这符合复印习惯
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
                      <button className="crop-btn" onClick={() => handleRecrop('front')} title="裁切证件范围">✂️ 裁切</button>
                      <button className="rotate-btn" onClick={() => setFrontRotate((prev) => (prev + 90) % 360)} title="旋转90°">🔄 旋转 90°</button>
                      <button className="delete-btn" onClick={() => clearImage('front')} title="删除">🗑️</button>
                    </div>
                  </div>
                ) : (
                  <div className="upload-placeholder" onClick={() => frontInputRef.current.click()}>
                    <span className="upload-icon">👤</span>
                    <span className="upload-text">点击上传正面 (头像面)</span>
                    <span className="upload-subtext">支持拖拽或直接剪贴板粘贴图片</span>
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
                      <button className="crop-btn" onClick={() => handleRecrop('back')} title="裁切证件范围">✂️ 裁切</button>
                      <button className="rotate-btn" onClick={() => setBackRotate((prev) => (prev + 90) % 360)} title="旋转90°">🔄 旋转 90°</button>
                      <button className="delete-btn" onClick={() => clearImage('back')} title="删除">🗑️</button>
                    </div>
                  </div>
                ) : (
                  <div className="upload-placeholder" onClick={() => backInputRef.current.click()}>
                    <span className="upload-icon">🏛️</span>
                    <span className="upload-text">点击上传反面 (国徽面)</span>
                    <span className="upload-subtext">支持拖拽或直接剪贴板粘贴图片</span>
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

      {/* 隐藏的永久文件输入域，确保不被 unmount 引起 React 节点重用与覆盖 bug */}
      <input 
        type="file" 
        ref={frontInputRef} 
        onChange={(e) => handleFileChange(e, 'front')}
        accept="image/*"
        style={{ display: 'none' }}
      />
      <input 
        type="file" 
        ref={backInputRef} 
        onChange={(e) => handleFileChange(e, 'back')}
        accept="image/*"
        style={{ display: 'none' }}
      />

      {/* 极其精美强大的连续互通裁剪框模态浮层 */}
      {cropModal.isOpen && (
        <div className="crop-modal-overlay glass-panel fade-in">
          <div className="crop-modal-container glass-card">
            <div className="crop-modal-header">
              <h3>✂️ 裁切证件范围 ({cropModal.side === 'front' ? '正面/头像面' : '反面/国徽面'})</h3>
              <button className="close-btn" onClick={() => setCropModal({ isOpen: false, side: null, imgSrc: null })}>×</button>
            </div>
            
            <div className="crop-modal-body">
              <p className="crop-tips">◀ 鼠标左键按住拖动图片进行平移，使用下方滑块缩放 🔍 ▶</p>
              
              <div 
                className="crop-frame-container"
                onMouseDown={handleCropMouseDown}
                onMouseMove={handleCropMouseMove}
                onMouseUp={handleCropMouseUp}
                onMouseLeave={handleCropMouseUp}
                onTouchStart={handleCropTouchStart}
                onTouchMove={handleCropTouchMove}
                onTouchEnd={handleCropMouseUp}
              >
                {/* 裁剪框视觉参考线 */}
                <div className="crop-target-frame">
                  <div className="crop-reference-card">
                    {cropModal.side === 'front' ? (
                      <div className="ref-avatar-box"></div>
                    ) : (
                      <div className="ref-emblem-box"></div>
                    )}
                  </div>
                </div>
                
                {/* 原始图片，通过CSS做平移与缩放 */}
                <img 
                  src={cropModal.imgSrc} 
                  alt="裁剪图片" 
                  className="crop-image-element"
                  style={{
                    transform: `translate(${cropOffset.x}px, ${cropOffset.y}px) scale(${cropZoom})`,
                    transformOrigin: 'center center'
                  }}
                  draggable="false"
                />
              </div>
              
              {/* 缩放控制器 */}
              <div className="crop-control-row">
                <span className="control-icon">🔍</span>
                <input 
                  type="range" 
                  min="1.0" 
                  max="3.0" 
                  step="0.02"
                  value={cropZoom}
                  onChange={(e) => setCropZoom(parseFloat(e.target.value))}
                  className="crop-zoom-slider"
                />
                <span className="zoom-text">{(cropZoom * 100).toFixed(0)}%</span>
              </div>
            </div>
            
            <div className="crop-modal-footer">
              <button className="crop-btn-cancel" onClick={() => setCropModal({ isOpen: false, side: null, imgSrc: null })}>取消</button>
              <button className="crop-btn-confirm" onClick={handleSaveCrop}>确认裁切</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
