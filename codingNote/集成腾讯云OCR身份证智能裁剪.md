# 编码笔记：集成腾讯云 OCR 与本地 OpenCV 3D 透视矫正三级金字塔高可用系统

## 1. 功能说明
为了向用户提供金融级、高精度、免受倾斜反光和梯形失真干扰的身份证裁剪与 A4 拼接复印体验，本次开发将**腾讯云身份证识别接口 (IDCardOCR)** 无缝接入系统，并结合本地 OpenCV 算法，打造了 Web 应用与本地批处理脚本的“三级金字塔”式高可用系统：
1. **第一防线：云端 AI 智能扶正与纠偏**:
   - 后端集成腾讯云 SDK。当开启云端 AI 功能时，上传的高分辨率身份证原图会自动发送至腾讯云 `IDCardOCR`。
   - 利用其强大的云端计算机视觉算法，智能去掉证件外多余的边缘、自动矫正拍摄角度（实现 360 度扶正），并返回完美的正交直立裁剪身份证图像 Base64。
2. **第二防线：本地 OpenCV 智能抠图与 3D 透视矫正**:
   - 如果云端 AI 识别由于网络超时、频控或者没有配置 API 密钥报错，批处理脚本 `main.py` 会自动无缝过渡至**第二层本地 OpenCV 算法防御**。
   - 利用 Canny 多阈值算子合并检测物理边缘，结合多精度多边形轮廓拟合逼近（支持 4~6 边形并由最小外接矩形 `minAreaRect` 拟合 4 角点），排除干扰背景，基于宽高比与面积得分获取黄金身份证位置坐标。
   - 最终使用极坐标顶点时针排序与 `getPerspectiveTransform` + `warpPerspective` 完成极致精细的 **3D 射影几何逆变换拉平扶正抠图**！
3. **第三防线：本地 Pillow 居中等比裁剪保底**:
   - 在极端反光、背景极端复杂导致本地 OpenCV 也无法检出高置信度边缘轮廓的情况下，系统会自动进入**第三层 Pillow 物理保底防线**，执行等比居中裁剪，百分百确保拼合大图任务能够 100% 成功生成。
4. **极美前端 UI 开关与呼吸灯**：
   - 在前端配置面板中增加磨砂玻璃高质感的“云端 AI 辅助 (智能裁剪与纠偏)”开关，配备微动效与专属的状态呼吸指示灯。
5. **极速包管理器集成 (`uv`)**：
   - 依赖项通过 `uv` 瞬时加锁安装至后端项目环境，包含 `opencv-python==4.13.0.92` 与 `numpy==2.4.6`，为本地 3D 抠图纠偏算法提供了极致的底层运算支撑。

---

## 2. 关键代码

### 本地 OpenCV 3D 透视纠偏扶正算法 (`main.py`)
利用 OpenCV 的高级计算机视觉算子实现本地高精矫正，即使倾斜拍摄也能强力扶正：

```python
def order_points(pts):
    """将四个点排序为：左上、右上、右下、左下"""
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]   # 左上
    rect[2] = pts[np.argmax(s)]   # 右下
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]  # 右上
    rect[3] = pts[np.argmax(diff)]  # 左下
    return rect

def four_point_transform(image, pts):
    """射影几何逆变换"""
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
    return cv2.warpPerspective(image, matrix, (max_width, max_height))

def local_opencv_crop_and_resize(src_path, dest_path):
    """边缘检测与透视变换"""
    image = cv2.imread(src_path)
    original = image.copy()
    img_area = image.shape[0] * image.shape[1]
    
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    
    # 边缘缝合
    edges1 = cv2.Canny(blur, 30, 100)
    edges2 = cv2.Canny(blur, 50, 150)
    edges3 = cv2.Canny(blur, 75, 200)
    edges = cv2.bitwise_or(edges1, cv2.bitwise_or(edges2, edges3))
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
    edges = cv2.dilate(edges, kernel, iterations=1)
    
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []
    
    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < img_area * 0.03: continue
        peri = cv2.arcLength(cnt, True)
        for epsilon_factor in [0.02, 0.03, 0.04, 0.05]:
            approx = cv2.approxPolyDP(cnt, epsilon_factor * peri, True)
            if 4 <= len(approx) <= 6:
                if len(approx) > 4:
                    rect = cv2.minAreaRect(cnt)
                    box = cv2.boxPoints(rect)
                    pts = np.intp(box)
                else:
                    pts = approx.reshape(-1, 2)
                x, y, w, h = cv2.boundingRect(pts)
                ratio = max(w, h) / min(w, h)
                if 1.3 <= ratio <= 2.0:
                    score = area * (1.0 - abs(ratio - 1.586) / 1.586)
                    candidates.append((score, pts))
                    break
                    
    if not candidates:
        raise ValueError("未检测到合适的身份证边缘。")
        
    candidates = sorted(candidates, key=lambda x: x[0], reverse=True)
    card_pts = candidates[0][1]
    cropped = four_point_transform(original, card_pts)
    
    h, w = cropped.shape[:2]
    if h > w:
        cropped = cv2.rotate(cropped, cv2.ROTATE_90_CLOCKWISE)
        
    cropped_resized = cv2.resize(cropped, (1063, 710), interpolation=cv2.INTER_LANCZOS4)
    cv2.imwrite(dest_path, cropped_resized)
```

---

## 3. 注意事项
1. **多级金字塔调用设计**: 在 `main.py` 内部对 OpenCV 库采取了 `try-except` 导入保护，并用 `HAS_OPENCV` 标记状态。即使在没有安装 `opencv-python` 的精简环境中，程序也能优雅且安全地直接落到 Pillow 第三层防线执行拼接，做到了绝对的高可用。
2. **QPS 与保护控制**: 对腾讯云 OCR 的免费套餐进行了 `time.sleep(0.5)` 的限频保护。
3. **数字配对硬性限制**: 批处理脚本要求偶数编号图为正面，奇数编号图为反面，且图片对数量必须为 2 的倍数。
