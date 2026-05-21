# 编码笔记：移除腾讯云 OCR 并全面采用本地 OpenCV 智能裁剪

## 1. 功能说明
为了确保身份证智能裁剪功能在本地调试及离线环境下的 100% 识别与高可用，杜绝云端 SDK 与 API 密钥硬编码的依赖：
1. **完全移除腾讯云相关 OCR 接口**：彻底清除了所有与腾讯云 SDK 模块相关的包导入、密钥校验逻辑，以及前端多余的云端辅助开关和状态指示。
2. **纯本地 OpenCV 3D 逆透视变换裁剪与拉平**：全面采用基于 OpenCV 的本地智能纠偏裁剪，通过多重 Canny 边缘提取、CLAHE 自适应直方图均衡化、多精度 RDP 逼近以及面积-黄金宽高比（标准国标 1.586）双重打分机制，实现高精度的边缘识别和 3D 透视扶正。
3. **ReportLab 渲染层修复**：在 `backend/services/id_card_service.py` 服务的 PDF 生成模块中，正确导入了 `ImageReader`，消除了由于未导入 `ImageReader` 导致 PDF 生成失败的 `NameError` 隐患。
4. **轻量化调试工具**：将根目录的 `main.py` 重构为完全符合用户要求的纯本地 cv2 智能裁剪与调试工具，消除未定义的 `HAS_OPENCV` 语法错误。

---

## 2. 关键代码

### 本地 3D 逆透视变换算法与智能裁剪 (`main.py`)
```python
import cv2
import numpy as np

def order_points(pts):
    """
    将四个点排序为：左上、右上、右下、左下
    """
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]   # 左上
    rect[2] = pts[np.argmax(s)]   # 右下
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]  # 右上
    rect[3] = pts[np.argmax(diff)]  # 左下
    return rect

def four_point_transform(image, pts):
    rect = order_points(pts)
    tl, tr, br, bl = rect
    width_a = np.linalg.norm(br - bl)
    width_b = np.linalg.norm(tr - tl)
    max_width = int(max(width_a, width_b))
    height_a = np.linalg.norm(tr - br)
    height_b = np.linalg.norm(tl - bl)
    max_height = int(max(height_a, height_b))
    dst = np.array([
        [0, 0],
        [max_width - 1, 0],
        [max_width - 1, max_height - 1],
        [0, max_height - 1]
    ], dtype="float32")
    matrix = cv2.getPerspectiveTransform(rect, dst)
    warped = cv2.warpPerspective(image, matrix, (max_width, max_height))
    return warped
```

---

## 3. 注意事项
1. **环境依赖**：运行本地工具或后端服务时，需通过 `uv run --project backend` 在包含 `opencv-python` 和 `numpy` 的项目环境下运行。
2. **优雅降级保底**：后端服务依然保留了对 `crop_id_card_bytes` 异常捕获的无缝优雅降级机制（若 OpenCV 未能检出高置信度的身份证边框，会自动退避至 Pillow 的等比居中裁剪），以此在各种复杂的极端图片（如强反光、无边框、模糊等）中保证复印件 100% 成功生成。
