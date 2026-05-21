import React, { useState, useRef, useEffect } from 'react';
import { useApp } from '../context/AppContext';
import './IdCardScanner.css';

/**
 * 纯前端高性能身份证智能透视校正与边缘提取算法 (OpenCV.js Wasm 纠偏 + 自研双向二值化漫水填充 + 多维度几何打分)
 * @param {HTMLImageElement} img 原始Image对象
 * @returns {Object} { success: boolean, x: number, y: number, width: number, height: number, warpedCanvas: HTMLCanvasElement, source: string }
 */
/**
 * 辅助数学函数：计算 cv.minAreaRect 旋转矩形的四个顶点
 * 避免依赖 OpenCV.js 内部可能未导出的 cv.boxPoints 或 cv.RotatedRect.points
 */
function getRotatedRectPoints(rotatedRect) {
  const cx = rotatedRect.center.x;
  const cy = rotatedRect.center.y;
  const w = rotatedRect.size.width;
  const h = rotatedRect.size.height;
  const angle = (rotatedRect.angle * Math.PI) / 180.0;

  const dx1 = (w / 2) * Math.cos(angle);
  const dy1 = (w / 2) * Math.sin(angle);
  const dx2 = -(h / 2) * Math.sin(angle);
  const dy2 = (h / 2) * Math.cos(angle);

  return [
    { x: cx - dx1 - dx2, y: cy - dy1 - dy2 },
    { x: cx + dx1 - dx2, y: cy + dy1 - dy2 },
    { x: cx + dx1 + dx2, y: cy + dy1 + dy2 },
    { x: cx - dx1 + dx2, y: cy - dy1 + dy2 }
  ];
}

const ID_CARD_RATIO = 85.6 / 54.0;

function expandToIdCardRect(x, y, width, height, imgWidth, imgHeight) {
  const pad = 0.01;
  let nextWidth = width * (1 + pad * 2);
  let nextHeight = height * (1 + pad * 2);

  if (nextWidth / nextHeight > ID_CARD_RATIO) {
    nextHeight = nextWidth / ID_CARD_RATIO;
  } else {
    nextWidth = nextHeight * ID_CARD_RATIO;
  }

  const cx = x + width / 2;
  let left = Math.round(cx - nextWidth / 2);
  let top = Math.round(y - height * pad);

  if (left < 0) left = 0;
  if (top < 0) top = 0;
  if (left + nextWidth > imgWidth) left = Math.max(0, Math.round(imgWidth - nextWidth));
  if (top + nextHeight > imgHeight) top = Math.max(0, Math.round(imgHeight - nextHeight));

  return {
    x: left,
    y: top,
    width: Math.min(imgWidth - left, Math.round(nextWidth)),
    height: Math.min(imgHeight - top, Math.round(nextHeight))
  };
}

function detectCardByGrabCut(cv, src) {
  if (!cv.grabCut || !cv.Rect || typeof cv.GC_INIT_WITH_RECT === 'undefined') {
    return null;
  }

  let rgb = new cv.Mat();
  let mask = null;
  let bgdModel = null;
  let fgdModel = null;
  let foreground = null;
  let closed = null;
  let opened = null;
  let closeKernel = null;
  let openKernel = null;
  let contours = null;
  let hierarchy = null;

  try {
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
    const imgWidth = src.cols;
    const imgHeight = src.rows;
    const imgArea = imgWidth * imgHeight;
    const margin = 0.08;
    const rect = new cv.Rect(
      Math.round(imgWidth * margin),
      Math.round(imgHeight * margin),
      Math.round(imgWidth * (1 - 2 * margin)),
      Math.round(imgHeight * (1 - 2 * margin))
    );

    mask = cv.Mat.zeros(imgHeight, imgWidth, cv.CV_8UC1);
    bgdModel = new cv.Mat(1, 65, cv.CV_64FC1, new cv.Scalar(0));
    fgdModel = new cv.Mat(1, 65, cv.CV_64FC1, new cv.Scalar(0));
    cv.grabCut(rgb, mask, rect, bgdModel, fgdModel, 3, cv.GC_INIT_WITH_RECT);

    foreground = cv.Mat.zeros(imgHeight, imgWidth, cv.CV_8UC1);
    for (let i = 0; i < mask.data.length; i++) {
      const value = mask.data[i];
      foreground.data[i] = (value === cv.GC_FGD || value === cv.GC_PR_FGD) ? 255 : 0;
    }

    closed = new cv.Mat();
    opened = new cv.Mat();
    closeKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(21, 21));
    openKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(5, 5));
    cv.morphologyEx(foreground, closed, cv.MORPH_CLOSE, closeKernel);
    cv.morphologyEx(closed, opened, cv.MORPH_OPEN, openKernel);

    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(opened, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates = [];
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area >= imgArea * 0.10 && area <= imgArea * 0.80) {
        const box = cv.boundingRect(contour);
        if (box.width > 0 && box.height > 0) {
          const ratio = Math.max(box.width, box.height) / Math.min(box.width, box.height);
          if (ratio >= 1.3 && ratio <= 2.05) {
            const score = area * (1.0 - Math.abs(ratio - ID_CARD_RATIO) / ID_CARD_RATIO);
            candidates.push({ score, ...box });
          }
        }
      }
      contour.delete();
    }

    if (candidates.length === 0) {
      return null;
    }

    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0];
    
    // 先扩展到身份证标准比例
    const expanded = expandToIdCardRect(best.x, best.y, best.width, best.height, imgWidth, imgHeight);
    
    // 对符合比例的最终包围盒进行等比强力向内收缩 3.5%，避免背景与投影毛边
    const insetX = Math.round(expanded.width * 0.035);
    const insetY = Math.round(expanded.height * 0.035);
    const newX = expanded.x + insetX;
    const newY = expanded.y + insetY;
    const newWidth = expanded.width - insetX * 2;
    const newHeight = expanded.height - insetY * 2;
    if (expanded.width <= 0 || expanded.height <= 0) {
      return null;
    }

    const cropRect = new cv.Rect(expanded.x, expanded.y, expanded.width, expanded.height);
    const roi = src.roi(cropRect);
    const resized = new cv.Mat();
    cv.resize(roi, resized, new cv.Size(856, 540), 0, 0, cv.INTER_LANCZOS4);

    // 绘制一圈 12 像素纯白边框遮挡边缘毛刺 (线粗为 24 像素，中心对齐刚好覆盖 12 像素)
    cv.rectangle(resized, new cv.Point(0, 0), new cv.Point(resized.cols, resized.rows), new cv.Scalar(255, 255, 255, 255), 24);

    const warpedCanvas = document.createElement('canvas');
    warpedCanvas.width = 856;
    warpedCanvas.height = 540;
    cv.imshow(warpedCanvas, resized);

    roi.delete();
    resized.delete();

    return {
      success: true,
      warpedCanvas,
      source: 'opencv-grabcut'
    };
  } catch (error) {
    console.warn("⚠️ OpenCV.js GrabCut card segmentation failed, falling back to contour detection:", error);
    return null;
  } finally {
    if (rgb) rgb.delete();
    if (mask) mask.delete();
    if (bgdModel) bgdModel.delete();
    if (fgdModel) fgdModel.delete();
    if (foreground) foreground.delete();
    if (closed) closed.delete();
    if (opened) opened.delete();
    if (closeKernel) closeKernel.delete();
    if (openKernel) openKernel.delete();
    if (contours) contours.delete();
    if (hierarchy) hierarchy.delete();
  }
}

/**
 * 纯前端高性能身份证智能透视校正与边缘提取算法 (OpenCV.js Wasm 纠偏 + 自研双向二值化漫水填充 + 多维度几何打分)
 * @param {HTMLImageElement} img 原始Image对象
 * @returns {Object} { success: boolean, x: number, y: number, width: number, height: number, warpedCanvas: HTMLCanvasElement, source: string }
 */
function detectIdCardRect(img) {
  // ==================== 第一防线：OpenCV.js Wasm 智能四角检测与 3D 透视纠偏 ====================
  if (window.cv && window.cv.Mat && window.cv.getPerspectiveTransform) {
    try {
      const cv = window.cv;
      
      // 1. 读取原图为 Mat
      let src = cv.imread(img);
      const grabCutDetection = detectCardByGrabCut(cv, src);
      if (grabCutDetection) {
        src.delete();
        console.log("🔥 [AI Engine] OpenCV.js GrabCut 前景分割定位成功！");
        return grabCutDetection;
      }

      let gray = new cv.Mat();
      let blurred = new cv.Mat();
      
      // 2. 预处理：灰度化
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      
      // 3. 自适应直方图均衡化 (CLAHE) - 显著增强局部对比度以应对阴影和昏暗环境
      let preprocessed = new cv.Mat();
      try {
        let clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
        clahe.apply(gray, preprocessed);
        clahe.delete();
      } catch (claheError) {
        console.warn("⚠️ OpenCV.js CLAHE is not supported in this build, falling back to basic gray.", claheError);
        gray.copyTo(preprocessed);
      }
      gray.delete();
      
      // 4. 去噪
      cv.GaussianBlur(preprocessed, blurred, new cv.Size(5, 5), 0);
      preprocessed.delete();
      
      // 5. 多种 Canny 算子边缘检测并合并，大幅提高边缘检测召回率
      let edges1 = new cv.Mat();
      let edges2 = new cv.Mat();
      let edges3 = new cv.Mat();
      let edgesTemp = new cv.Mat();
      let edges = new cv.Mat();
      
      cv.Canny(blurred, edges1, 30, 100);
      cv.Canny(blurred, edges2, 50, 150);
      cv.Canny(blurred, edges3, 75, 200);
      
      cv.bitwise_or(edges1, edges2, edgesTemp);
      cv.bitwise_or(edgesTemp, edges3, edges);
      
      edges1.delete();
      edges2.delete();
      edges3.delete();
      edgesTemp.delete();
      blurred.delete();
      
      // 6. 形态学操作：先闭合后膨胀，粗化和桥接断裂的边缘
      let closed = new cv.Mat();
      let dilated = new cv.Mat();
      let kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
      cv.morphologyEx(edges, closed, cv.MORPH_CLOSE, kernel);
      cv.dilate(closed, dilated, kernel, new cv.Point(-1, -1), 1);
      
      kernel.delete();
      edges.delete();
      closed.delete();
      
      // 7. 提取外部边缘轮廓
      let contours = new cv.MatVector();
      let hierarchy = new cv.Mat();
      cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      
      let candidates = [];
      const imgArea = src.cols * src.rows;
      
      // 遍历所有外部轮廓
      for (let i = 0; i < contours.size(); ++i) {
        let contour = contours.get(i);
        let area = cv.contourArea(contour);
        
        // 限制面积并拒绝整图外框，避免把照片边界或背景纹理误判为身份证
        if (area < imgArea * 0.03 || area > imgArea * 0.80) {
          contour.delete();
          continue;
        }
        
        let peri = cv.arcLength(contour, true);
        
        // 尝试不同的 RDP 逼近精度因子以求最精确的多边形拟合
        for (let epsilonFactor of [0.02, 0.03, 0.04, 0.05]) {
          let approx = new cv.Mat();
          cv.approxPolyDP(contour, approx, epsilonFactor * peri, true);
          
          let numVertices = approx.rows;
          
          // 接受 4 到 6 边形（有效滤除轻微弯曲或圆角干扰）
          if (numVertices >= 4 && numVertices <= 6) {
            let pts = [];
            if (numVertices > 4) {
              // 5或6边形，采用最小外接矩形 (minAreaRect) 四角兜底
              let rotRect = cv.minAreaRect(contour);
              pts = getRotatedRectPoints(rotRect);
            } else {
              // 完美四边形直接读取顶点
              for (let j = 0; j < 4; j++) {
                pts.push({
                  x: approx.data32S[j * 2],
                  y: approx.data32S[j * 2 + 1]
                });
              }
            }
            
            // 估计外包围矩形及宽高比
            let minX = Math.min(...pts.map(p => p.x));
            let maxX = Math.max(...pts.map(p => p.x));
            let minY = Math.min(...pts.map(p => p.y));
            let maxY = Math.max(...pts.map(p => p.y));
            let w = maxX - minX;
            let h = maxY - minY;
            const touchesFrame =
              minX <= 2 ||
              minY <= 2 ||
              maxX >= src.cols - 2 ||
              maxY >= src.rows - 2;
            if (touchesFrame) {
              continue;
            }
            
            if (w > 0 && h > 0) {
              let ratio = Math.max(w, h) / Math.min(w, h);
              // 宽高比放宽限制至 [1.3, 2.0]
              if (ratio >= 1.3 && ratio <= 2.0) {
                // 精英评分机制：面积越大且比例越接近标准 1.586 (85.6 / 54) 得分越高
                let score = area * (1.0 - Math.abs(ratio - 1.586) / 1.586);
                candidates.push({
                  score,
                  area,
                  ratio,
                  pts
                });
                approx.delete();
                break; // 拟合成功后跳出精度尝试
              }
            }
          }
          approx.delete();
        }
        contour.delete();
      }
      
      // A1. 首选高维智能多边形四角透视纠偏
      if (candidates.length > 0) {
        // 按综合评分从高到低排序
        candidates.sort((a, b) => b.score - a.score);
        let best = candidates[0];
        let pts = best.pts;
        
        // 四点顺时针严格排序 (左上, 右上, 右下, 左下)
        let sortedPts = new Array(4);
        let sums = pts.map(p => p.x + p.y);
        let diffs = pts.map(p => p.x - p.y);
        
        let tl_idx = sums.indexOf(Math.min(...sums));
        let br_idx = sums.indexOf(Math.max(...sums));
        let tr_idx = diffs.indexOf(Math.max(...diffs));
        let bl_idx = diffs.indexOf(Math.min(...diffs));
        
        if (tl_idx === br_idx || tr_idx === bl_idx) {
          // 极少数冲突退化排序
          pts.sort((a, b) => a.x - b.x);
          let leftHalf = [pts[0], pts[1]].sort((a, b) => a.y - b.y);
          let rightHalf = [pts[2], pts[3]].sort((a, b) => a.y - b.y);
          sortedPts[0] = leftHalf[0];
          sortedPts[1] = rightHalf[0];
          sortedPts[2] = rightHalf[1];
          sortedPts[3] = leftHalf[1];
        } else {
          sortedPts[0] = pts[tl_idx];
          sortedPts[1] = pts[tr_idx];
          sortedPts[2] = pts[br_idx];
          sortedPts[3] = pts[bl_idx];
        }
        // 几何收缩角点 5.5% 向中心收缩，彻底消除边界外部任何残存的背景与投影毛边
        let cx = (sortedPts[0].x + sortedPts[1].x + sortedPts[2].x + sortedPts[3].x) / 4;
        let cy = (sortedPts[0].y + sortedPts[1].y + sortedPts[2].y + sortedPts[3].y) / 4;
        for (let k = 0; k < 4; k++) {
          sortedPts[k].x = cx + (sortedPts[k].x - cx) * 0.945;
          sortedPts[k].y = cy + (sortedPts[k].y - cy) * 0.945;
        }

        // 进行透视变换，拉平为 856x540 的标准比例
        let srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
          sortedPts[0].x, sortedPts[0].y,
          sortedPts[1].x, sortedPts[1].y,
          sortedPts[2].x, sortedPts[2].y,
          sortedPts[3].x, sortedPts[3].y
        ]);
        let dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
          0, 0,
          856, 0,
          856, 540,
          0, 540
        ]);
        
        let transMat = cv.getPerspectiveTransform(srcTri, dstTri);
        let warpedMat = new cv.Mat();
        cv.warpPerspective(src, warpedMat, transMat, new cv.Size(856, 540), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
        
        // -------------------- 纯物理白边覆盖（比二值化更安全，绝不损坏人像与文字） --------------------
        // 绘制一圈 12 像素纯白边框以消除毛刺 (线宽 24)
        cv.rectangle(warpedMat, new cv.Point(0, 0), new cv.Point(warpedMat.cols, warpedMat.rows), new cv.Scalar(255, 255, 255, 255), 24);

        // 显示最终清理后的图像
        const warpedCanvas = document.createElement('canvas');
        warpedCanvas.width = 856;
        warpedCanvas.height = 540;
        cv.imshow(warpedCanvas, warpedMat);
        // -------------------------------------------------------
        // 垃圾回收，绝不泄露
        src.delete();
        dilated.delete();
        contours.delete();
        hierarchy.delete();
        srcTri.delete();
        dstTri.delete();
        transMat.delete();
        warpedMat.delete();
        console.log("🔥 [AI Engine] OpenCV.js Wasm 智能透视收缩与白边裁切成功！得分:", best.score);
        return {
          success: true,
          warpedCanvas,
          source: 'opencv-perspective'
        };
      }
      
      // ==================== 第二防线：OpenCV.js 直立外接包围矩形定位 (逼近失败时二级降级) ====================
      let maxContourArea = -1;
      let rectMat = null;
      
      // 重新提取轮廓进行外接矩形匹配
      let tempContours = new cv.MatVector();
      let tempHierarchy = new cv.Mat();
      cv.findContours(dilated, tempContours, tempHierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      
      for (let i = 0; i < tempContours.size(); ++i) {
        let contour = tempContours.get(i);
        let area = cv.contourArea(contour);
        if (area > imgArea * 0.05 && area < imgArea * 0.80) {
          let rect = cv.boundingRect(contour);
          const touchesFrame =
            rect.x <= 2 ||
            rect.y <= 2 ||
            rect.x + rect.width >= src.cols - 2 ||
            rect.y + rect.height >= src.rows - 2;
          if (touchesFrame) {
            contour.delete();
            continue;
          }
          const ratio = rect.width / rect.height;
          const ratioNorm = ratio < 1.0 ? 1.0 / ratio : ratio;
          
          if (ratioNorm >= 1.15 && ratioNorm <= 2.0) {
            if (area > maxContourArea) {
              maxContourArea = area;
              rectMat = rect;
            }
          }
        }
        contour.delete();
      }
      
      tempContours.delete();
      tempHierarchy.delete();
      dilated.delete();
      contours.delete();
      hierarchy.delete();
      
      if (rectMat) {
        const x = rectMat.x;
        const y = rectMat.y;
        const width = rectMat.width;
        const height = rectMat.height;
        src.delete();
        console.log("💡 [AI Engine] OpenCV.js 轮廓直立外接矩形兜底提取成功！");
        return {
          success: true,
          x,
          y,
          width,
          height,
          source: 'opencv-bbox'
        };
      }
      
      src.delete();
    } catch (e) {
      console.warn("⚠️ OpenCV.js processing error, auto fallback to custom JS algorithm: ", e);
    }
  }

  // ==================== 第三防线：自研双向自适应 Otsu + 形态学边缘漫水算法 (纯前端极速兜底) ====================
  try {
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

    const gray = new Uint8ClampedArray(w * h);
    for (let i = 0; i < data.length; i += 4) {
      gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }

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

              const neighbors = [curIdx - 1, curIdx + 1, curIdx - w, curIdx + w];
              for (const nIdx of neighbors) {
                if (nIdx >= 0 && nIdx < w * h) {
                  const nx = nIdx % w;
                  const ny = Math.floor(nIdx / w);
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

    const candidates = [];

    const binNormal = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      binNormal[i] = gray[i] >= otsuThresh ? 1 : 0;
    }
    const compsNormal = findConnectedComponents(binNormal);
    candidates.push(...compsNormal.map(c => ({ ...c, source: 'otsu-normal' })));

    const binInverted = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      binInverted[i] = gray[i] < otsuThresh ? 1 : 0;
    }
    const compsInverted = findConnectedComponents(binInverted);
    candidates.push(...compsInverted.map(c => ({ ...c, source: 'otsu-inverted' })));

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

    const nonzeroGrads = [];
    for (let i = 0; i < w * h; i++) {
      if (grad[i] > 2) nonzeroGrads.push(grad[i]);
    }
    nonzeroGrads.sort((a, b) => a - b);
    const threshIdx = Math.floor(nonzeroGrads.length * 0.85);
    const gradThresh = nonzeroGrads.length > 0 ? nonzeroGrads[threshIdx] : 20;

    const edgeBin = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      edgeBin[i] = grad[i] >= gradThresh ? 1 : 0;
    }

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

    const bgMask = new Uint8Array(w * h);
    const bgQueue = [];
    
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

    const fgBin = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      fgBin[i] = bgMask[i] === 0 ? 1 : 0;
    }
    const compsEdgeHole = findConnectedComponents(fgBin);
    candidates.push(...compsEdgeHole.map(c => ({ ...c, source: 'edge-hole' })));

    let bestCandidate = null;
    let maxScore = -1;

    for (const comp of candidates) {
      const ratio = comp.width / comp.height;
      const ratioNorm = ratio < 1.0 ? 1.0 / ratio : ratio;
      if (ratioNorm < 1.1 || ratioNorm > 2.1) continue;

      const diff = Math.abs(ratioNorm - 1.586);
      const scoreRatio = Math.max(0, 1.0 - diff / 0.4);

      const areaPct = (comp.width * comp.height) / (w * h);
      if (areaPct < 0.08 || areaPct > 0.85) continue;
      const scoreArea = areaPct;

      const cx = comp.minX + comp.width / 2;
      const cy = comp.minY + comp.height / 2;
      const distToCenter = Math.sqrt((cx - w / 2) ** 2 + (cy - h / 2) ** 2);
      const maxDist = Math.sqrt((w / 2) ** 2 + (h / 2) ** 2);
      const scoreCenter = 1.0 - distToCenter / maxDist;

      const fillRatio = comp.area / (comp.width * comp.height);
      if (fillRatio < 0.45) continue;

      const totalScore = scoreRatio * 0.45 + scoreCenter * 0.3 + scoreArea * 0.25;

      if (totalScore > maxScore) {
        maxScore = totalScore;
        bestCandidate = comp;
      }
    }

    if (bestCandidate && maxScore >= 0.40) {
      const scaleX = img.width / w;
      const scaleY = img.height / h;
      
      console.log(`💡 [AI Engine] 自研二值化漫水定位成功！通道: ${bestCandidate.source}`);
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

  // OpenCV.js Wasm 加载状态
  const [isOpenCvLoaded, setIsOpenCvLoaded] = useState(false);
  const [isOpenCvLoading, setIsOpenCvLoading] = useState(false);

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

  // OpenCV.js 异步极速按需加载器
  useEffect(() => {
    if (window.cv && window.cv.Mat) {
      setIsOpenCvLoaded(true);
      return;
    }

    setIsOpenCvLoading(true);

    if (!window.Module) {
      window.Module = {};
    }

    const existingCallback = window.Module.onRuntimeInitialized;
    window.Module.onRuntimeInitialized = () => {
      if (existingCallback) {
        existingCallback();
      }
      console.log("🔥 [AI Engine] OpenCV.js WebAssembly compiled & initialized successfully.");
      setIsOpenCvLoaded(true);
      setIsOpenCvLoading(false);
    };

    let script = document.getElementById('opencv-script');
    if (!script) {
      script = document.createElement('script');
      script.id = 'opencv-script';
      script.src = '/libs/opencv.js';
      script.async = true;
      script.type = 'text/javascript';
      script.onerror = (e) => {
        console.error("⚠️ [AI Engine] Failed to load OpenCV.js static library:", e);
        setIsOpenCvLoading(false);
      };
      document.body.appendChild(script);
    } else {
      if (window.cv && window.cv.Mat) {
        setIsOpenCvLoaded(true);
        setIsOpenCvLoading(false);
      }
    }
  }, []);

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

        // A. OpenCV.js 3D 透视校正一键直出
        if (detection.success && detection.warpedCanvas) {
          const finalZoom = 1.0;
          const finalOffset = { x: 0, y: 0 };
          if (side === 'front') {
            setFrontOriginal(file);
            setFrontCropParams({ zoom: finalZoom, offset: finalOffset });
          } else {
            setBackOriginal(file);
            setBackCropParams({ zoom: finalZoom, offset: finalOffset });
          }

          detection.warpedCanvas.toBlob((blob) => {
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
          return;
        }

        const frameW = 380;
        const frameH = 240;
        const scaleToFit = Math.max(frameW / img.width, frameH / img.height);

        let finalZoom = 1.0;
        let finalOffset = { x: 0, y: 0 };

        if (detection.success) {
          // B. 传统边缘或自研算法识别成功
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

        // 绘制一圈 12 像素纯白边框以消除毛刺 (stroke 线宽为 24 像素，一半向内对齐覆盖)
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 24;
        ctx.strokeRect(0, 0, 856, 540);

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
      
      // 绘制一圈 12 像素纯白边框以消除毛刺 (stroke 线宽为 24 像素，一半向内对齐覆盖)
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 24;
      ctx.strokeRect(0, 0, 856, 540);
      
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
          
          {/* AI 引擎状态栏 */}
          <div className="ai-engine-status-bar">
            <span className={`status-indicator-dot ${isOpenCvLoaded ? 'loaded' : 'loading'}`}></span>
            <span className="status-indicator-text">
              {isOpenCvLoaded ? (
                <>
                  <span className="sparkle-icon">✨</span> 本地 OpenCV WebAssembly 智能裁剪引擎已就绪
                </>
              ) : (
                <>
                  <span className="spinner-icon">⏳</span> AI 引擎加载中... (已开启自研算法兜底)
                </>
              )}
            </span>
          </div>

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
