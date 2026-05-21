import io
import os
import time
import hashlib
import json
import base64
from pathlib import Path
from typing import Dict, Any, Tuple
from PIL import Image, ImageEnhance, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
import cv2
import numpy as np

from backend.services.db_service import SessionLocal
from backend.services.log_service import log_invocation

# 缓存配置与目录
CACHE_DIR = Path(__file__).resolve().parent.parent / "cache"
CACHE_LIMIT_BYTES = 100 * 1024 * 1024  # 100 MB
CACHE_TTL_SECONDS = 30 * 60  # 30 Minutes

def ensure_cache_dir():
    """确保缓存目录存在并进行LRU/TTL清理"""
    if not CACHE_DIR.exists():
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
    
    # 清理过期和超出大小限制的缓存文件
    now = time.time()
    cache_files = []
    
    for f in CACHE_DIR.glob("*"):
        if f.is_file():
            stat = f.stat()
            age = now - stat.st_mtime
            # TTL 清理
            if age > CACHE_TTL_SECONDS:
                try:
                    f.unlink()
                except Exception:
                    pass
            else:
                cache_files.append((f, stat.st_size, stat.st_mtime))
    
    # 按最后修改时间排序（最近使用的在后）
    cache_files.sort(key=lambda x: x[2])
    
    # LRU 限额清理
    total_size = sum(x[1] for x in cache_files)
    while total_size > CACHE_LIMIT_BYTES and cache_files:
        oldest_file, size, _ = cache_files.pop(0)
        try:
            oldest_file.unlink()
            total_size -= size
        except Exception:
            pass

def get_system_font(size: int = 20) -> ImageFont.ImageFont:
    """获取系统级的中文TrueType字体以支持水印，附带完美降级逻辑"""
    font_paths = [
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Cache/PingFang.ttc"
    ]
    for path in font_paths:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    # 终极保底
    return ImageFont.load_default()

def order_points(pts):
    """
    将四个点排序为：
    左上、右上、右下、左下
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


ID_CARD_RATIO = 85.6 / 54.0


def expand_to_id_card_rect(x: int, y: int, w: int, h: int, img_w: int, img_h: int) -> Tuple[int, int, int, int]:
    """Expand a detected card foreground box to the standard ID-card ratio."""
    pad = 0.01
    width = w * (1 + pad * 2)
    height = h * (1 + pad * 2)

    if width / height > ID_CARD_RATIO:
        height = width / ID_CARD_RATIO
    else:
        width = height * ID_CARD_RATIO

    cx = x + w / 2
    left = int(round(cx - width / 2))
    top = int(round(y - h * pad))

    if left < 0:
        left = 0
    if top < 0:
        top = 0
    if left + width > img_w:
        left = max(0, int(round(img_w - width)))
    if top + height > img_h:
        top = max(0, int(round(img_h - height)))

    width = min(img_w - left, int(round(width)))
    height = min(img_h - top, int(round(height)))
    return left, top, width, height


def shrink_quad(pts, factor=0.985):
    """将4个角点向中心收缩指定的比例，默认收缩1.5%"""
    center = np.mean(pts, axis=0)
    shrunk = []
    for pt in pts:
        shrunk.append(center + (pt - center) * factor)
    return np.array(shrunk, dtype="float32")


def add_white_border(image, thickness=8):
    """给图像边缘绘制一圈纯白色边框，遮盖任何残存的细微毛边"""
    h, w = image.shape[:2]
    # 绘制纯白色矩形边框覆盖边缘 (thickness * 2 像素线宽)
    cv2.rectangle(image, (0, 0), (w, h), (255, 255, 255), thickness * 2)
    return image


def crop_by_grabcut(image: np.ndarray) -> np.ndarray | None:
    """Segment the card from busy fabric backgrounds before contour fallback."""
    img_h, img_w = image.shape[:2]
    img_area = img_h * img_w
    margin = 0.08
    rect = (
        int(img_w * margin),
        int(img_h * margin),
        int(img_w * (1 - 2 * margin)),
        int(img_h * (1 - 2 * margin)),
    )

    mask = np.zeros((img_h, img_w), np.uint8)
    bg_model = np.zeros((1, 65), np.float64)
    fg_model = np.zeros((1, 65), np.float64)

    try:
        cv2.grabCut(image, mask, rect, bg_model, fg_model, 3, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return None

    foreground = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype("uint8")
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (21, 21))
    foreground = cv2.morphologyEx(foreground, cv2.MORPH_CLOSE, kernel)
    foreground = cv2.morphologyEx(
        foreground,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
    )

    contours, _ = cv2.findContours(foreground, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = []

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < img_area * 0.10 or area > img_area * 0.80:
            continue

        x, y, w, h = cv2.boundingRect(cnt)
        if w == 0 or h == 0:
            continue

        ratio = max(w, h) / min(w, h)
        if 1.30 <= ratio <= 2.05:
            score = area * (1.0 - abs(ratio - ID_CARD_RATIO) / ID_CARD_RATIO)
            candidates.append((score, x, y, w, h))

    if not candidates:
        return None

    _, x, y, w, h = sorted(candidates, reverse=True, key=lambda item: item[0])[0]
    
    # 向内收缩 2.5% 以去除 GrabCut 边界可能带有的背景毛边与虚影
    inset_px_w = int(w * 0.025)
    inset_px_h = int(h * 0.025)
    x += inset_px_w
    y += inset_px_h
    w -= inset_px_w * 2
    h -= inset_px_h * 2

    x, y, w, h = expand_to_id_card_rect(x, y, w, h, img_w, img_h)
    if w <= 0 or h <= 0:
        return None

    return image[y:y + h, x:x + w]


def crop_id_card_bytes(img_bytes: bytes) -> bytes:
    """使用本地 OpenCV 进行身份证边框检测与 3D 透视扶正裁剪，返回裁剪后的图片 bytes。
    如果未检测到身份证边框，抛出 ValueError，由上层捕获降级。
    """
    nparr = np.frombuffer(img_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("图片解码失败")

    grabcut_crop = crop_by_grabcut(image)
    if grabcut_crop is not None:
        cropped_resized = cv2.resize(grabcut_crop, (1063, 710), interpolation=cv2.INTER_LANCZOS4)
        # 绘制纯物理白边遮挡边缘 (thickness=16, 覆盖 16 像素，线宽 32)
        cropped_resized = add_white_border(cropped_resized, thickness=16)
        success, encoded_img = cv2.imencode(".jpg", cropped_resized)
        if not success:
            raise ValueError("图片编码失败")
        return encoded_img.tobytes()

    original = image.copy()
    img_area = image.shape[0] * image.shape[1]

    # 1. 灰度化
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # 2. 自适应直方图均衡化，增强对比度
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    # 3. 去噪
    blur = cv2.GaussianBlur(gray, (5, 5), 0)

    # 4. 多种边缘检测方法并合并，增强检测力
    edges1 = cv2.Canny(blur, 30, 100)
    edges2 = cv2.Canny(blur, 50, 150)
    edges3 = cv2.Canny(blur, 75, 200)
    edges = cv2.bitwise_or(edges1, cv2.bitwise_or(edges2, edges3))

    # 5. 形态学操作
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
    edges = cv2.dilate(edges, kernel, iterations=1)

    # 6. 找轮廓
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates = []

    for cnt in contours:
        area = cv2.contourArea(cnt)

        # 限制面积并拒绝整图外框，避免把照片边界或背景纹理误判为身份证
        if area < img_area * 0.03 or area > img_area * 0.80:
            continue

        # 多边形拟合，尝试不同的精度
        peri = cv2.arcLength(cnt, True)
        
        for epsilon_factor in [0.02, 0.03, 0.04, 0.05]:
            approx = cv2.approxPolyDP(cnt, epsilon_factor * peri, True)
            
            # 接受4-6边形（有些情况下可能不是完美的四边形）
            if 4 <= len(approx) <= 6:
                # 如果是5或6边形，取外接矩形的四个角点
                if len(approx) > 4:
                    rect = cv2.minAreaRect(cnt)
                    box = cv2.boxPoints(rect)
                    pts = np.intp(box)
                else:
                    pts = approx.reshape(-1, 2)

                x, y, w, h = cv2.boundingRect(pts)
                touches_frame = x <= 2 or y <= 2 or x + w >= image.shape[1] - 2 or y + h >= image.shape[0] - 2
                if touches_frame:
                    continue
                
                if w == 0 or h == 0:
                    continue
                    
                ratio = max(w, h) / min(w, h)

                # 放宽比例限制，从1.45-1.75扩大到1.3-2.0
                if 1.3 <= ratio <= 2.0:
                    # 计算轮廓占图像的比例
                    area_ratio = area / img_area
                    
                    # 优先选择面积较大且比例接近1.586的
                    score = area * (1.0 - abs(ratio - 1.586) / 1.586)
                    candidates.append((score, pts))
                    break

    if not candidates:
        raise ValueError("未检测到身份证边框")

    # 按评分排序
    candidates = sorted(candidates, key=lambda x: x[0], reverse=True)
    card_pts = candidates[0][1]

    # 几何收缩角点 4.0% 向中心收缩，消除边界残留的背景与投影毛边
    shrunk_pts = shrink_quad(card_pts, factor=0.96)

    # 7. 透视矫正并裁剪
    cropped = four_point_transform(original, shrunk_pts)

    # 如果裁剪后是竖着的，自动转正
    h, w = cropped.shape[:2]
    if h > w:
        cropped = cv2.rotate(cropped, cv2.ROTATE_90_CLOCKWISE)

    # 强行缩放到 1:1 标准高精尺寸 1063 x 710，采用 Lanczos4 获最高品质
    cropped_resized = cv2.resize(cropped, (1063, 710), interpolation=cv2.INTER_LANCZOS4)

    # 绘制纯物理白边以遮盖边缘毛刺 (thickness=16, 覆盖 16 像素，线宽 32)
    cropped_resized = add_white_border(cropped_resized, thickness=16)

    # 编码回 bytes
    success, encoded_img = cv2.imencode(".jpg", cropped_resized)
    if not success:
        raise ValueError("图片编码失败")
        
    return encoded_img.tobytes()

def enhance_image(
    img_bytes: bytes,
    rotate_angle: int,
    brightness: float,
    contrast: float,
    color_mode: str
) -> Image.Image:
    """使用 Pillow 对单张身份证图片进行画面微调、90度倍数旋转与色彩模式转换"""
    img = Image.open(io.BytesIO(img_bytes))
    
    # 1. 旋转调整 (支持顺时针 0, 90, 180, 270 度)
    if rotate_angle in [90, 180, 270]:
        # Image.rotate 顺时针旋转用负数，或使用内置常量
        img = img.rotate(360 - rotate_angle, expand=True)
        
    # 2. 亮度调整
    if brightness != 1.0:
        enhancer = ImageEnhance.Brightness(img)
        img = enhancer.enhance(brightness)
        
    # 3. 对比度调整
    if contrast != 1.0:
        enhancer = ImageEnhance.Contrast(img)
        img = enhancer.enhance(contrast)
        
    # 4. 色彩模式转换
    if color_mode == "grayscale":
        # 黑白复印效果
        img = img.convert("L").convert("RGB")
    elif color_mode == "monochrome":
        # 智能二值化高对比度（省墨、去除背景噪点）
        gray = img.convert("L")
        # 127 阈值二值化
        mono = gray.point(lambda x: 255 if x > 127 else 0, mode='1')
        img = mono.convert("RGB")
    else:
        # 彩色原画模式
        img = img.convert("RGB")
        
    return img

def apply_watermark(img: Image.Image, text: str, opacity: float, color_hex: str) -> Image.Image:
    """在身份证图像像素级打上倾斜拼贴的水印，达到金融级的防篡改物理融合效果"""
    if not text:
        return img
        
    w, h = img.size
    # 创建相同尺寸的透明图层
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # 颜色解析
    r, g, b = 204, 204, 204  # 默认 #CCCCCC
    if color_hex.startswith("#"):
        try:
            h_color = color_hex.lstrip("#")
            r = int(h_color[0:2], 16)
            g = int(h_color[2:4], 16)
            b = int(h_color[4:6], 16)
        except Exception:
            pass
    alpha = int(opacity * 255)
    
    # 动态适应文字大小（大图用大字，小图用小字）
    font_size = max(16, int(min(w, h) * 0.045))
    font = get_system_font(font_size)
    
    # 创建一个稍大的旋转文本小画布，避免裁剪边缘
    txt_box_w = font_size * len(text) + 60
    txt_box_h = font_size + 40
    txt_img = Image.new("RGBA", (txt_box_w, txt_box_h), (0, 0, 0, 0))
    txt_draw = ImageDraw.Draw(txt_img)
    txt_draw.text((30, 20), text, font=font, fill=(r, g, b, alpha))
    
    # 逆时针倾斜 30 度
    rotated_txt = txt_img.rotate(30, expand=True, resample=Image.Resampling.BICUBIC)
    
    # 斜向拼贴平铺水印
    rt_w, rt_h = rotated_txt.size
    x_step = int(rt_w * 1.2)
    y_step = int(rt_h * 1.5)
    
    for y in range(-rt_h, h + rt_h, y_step):
        for x in range(-rt_w, w + rt_w, x_step):
            overlay.paste(rotated_txt, (x, y), rotated_txt)
            
    # 与原图合成
    img_rgba = img.convert("RGBA")
    composited = Image.alpha_composite(img_rgba, overlay)
    return composited.convert("RGB")

def process_and_generate_pdf(
    front_bytes: bytes,
    back_bytes: bytes,
    params: Dict[str, Any],
    session_id: str
) -> Tuple[bytes, str]:
    """主服务：接收图片字节流与排版参数，输出生成的 PDF 字节流，并记录遥测日志"""
    start_time = time.time()
    
    # 参数解析
    watermark_text = params.get("watermark_text", "")
    watermark_opacity = float(params.get("watermark_opacity", 0.15))
    watermark_color = params.get("watermark_color", "#CCCCCC")
    layout = params.get("layout", "vertical")  # vertical | horizontal
    color_mode = params.get("color_mode", "grayscale")  # original | grayscale | monochrome (默认为 grayscale 黑白复印)
    brightness = float(params.get("brightness", 1.0))
    contrast = float(params.get("contrast", 1.0))
    front_rotate = int(params.get("front_rotate", 0))
    back_rotate = int(params.get("back_rotate", 0))
    print_scale = params.get("print_scale", "1to1")  # 1to1 (1:1 打印原大) | fit (自适应最大化铺满)
    status = "success"
    error_msg = None
    stack_trace = None
    pdf_bytes = b""
    
    # 1. 缓存匹配机制 (基于图片内容哈希 + 所有参数)
    param_hash_str = f"{watermark_text}_{watermark_opacity}_{watermark_color}_{layout}_{color_mode}_{brightness}_{contrast}_{front_rotate}_{back_rotate}_{print_scale}"
    front_md5 = hashlib.md5(front_bytes).hexdigest()
    back_md5 = hashlib.md5(back_bytes).hexdigest()
    
    cache_key = hashlib.sha256(f"{front_md5}_{back_md5}_{param_hash_str}".encode()).hexdigest()
    cache_file = CACHE_DIR / f"{cache_key}.pdf"
    
    ensure_cache_dir()
    
    if cache_file.exists():
        try:
            # 命中缓存
            pdf_bytes = cache_file.read_bytes()
            # 刷新修改时间以维护 LRU
            cache_file.touch()
            
            # 记录缓存命中日志
            execution_time_ms = int((time.time() - start_time) * 1000)
            db = SessionLocal()
            try:
                log_invocation(
                    db=db,
                    session_id=session_id,
                    tool_type="id-card-scanner",
                    ui_path="/trace/id-card-scanner",
                    execution_path="backend.services.id_card_service:process_and_generate_pdf [CACHE_HIT]",
                    execution_time_ms=execution_time_ms,
                    status="success",
                    parameters={**params, "cache_hit": True}
                )
            finally:
                db.close()
                
            return pdf_bytes, cache_key
        except Exception:
            pass  # 如果缓存读取失败，降级重新生成
            
    try:
        # 1.5. 启动本地 OpenCV 身份证智能边缘捕捉与透视校正裁剪，自动扶正
        try:
            front_cropped = crop_id_card_bytes(front_bytes)
            front_bytes = front_cropped
            print("🔥 [OpenCV Local] Front image cropped and deskewed successfully.")
        except Exception as e:
            print(f"⚠️ [OpenCV Local] Front crop failed: {e}. Falling back to original/uploaded image.")
        
        try:
            back_cropped = crop_id_card_bytes(back_bytes)
            back_bytes = back_cropped
            print("🔥 [OpenCV Local] Back image cropped and deskewed successfully.")
        except Exception as e:
            print(f"⚠️ [OpenCV Local] Back crop failed: {e}. Falling back to original/uploaded image.")

        # 2. 图像增强与色彩变换
        front_enhanced = enhance_image(front_bytes, front_rotate, brightness, contrast, color_mode)
        back_enhanced = enhance_image(back_bytes, back_rotate, brightness, contrast, color_mode)
        
        # 3. 施加防伪水印
        front_watermarked = apply_watermark(front_enhanced, watermark_text, watermark_opacity, watermark_color)
        back_watermarked = apply_watermark(back_enhanced, watermark_text, watermark_opacity, watermark_color)
        
        # 4. 生成高精度矢量 PDF (ReportLab A4 画布)
        # A4 页面标准尺寸: 595.27 x 841.89 points
        # 身份证物理标准尺寸: 85.6mm x 54.0mm
        # 换算为 PDF 画布 Points: 1mm ≈ 2.8346 pt
        # 宽 = 85.6 * 2.8346 = 242.6 pt
        # 高 = 54.0 * 2.8346 = 153.1 pt
        card_w = 242.6
        card_h = 153.1
        
        # 自适应铺满缩放倍率 (如果用户选择自适应铺满)
        if print_scale == "fit":
            # 自适应最大化铺满，放大到 450 pt 宽 (比例一致)
            card_w = 450.0
            card_h = 284.0
            
        pdf_buffer = io.BytesIO()
        pdf_canvas = canvas.Canvas(pdf_buffer, pagesize=A4)
        
        # 将 PIL 图像转换为 ReportLab Reader 结构进行高精度渲染 (不落盘)
        front_reader = ImageReader(front_watermarked)
        back_reader = ImageReader(back_watermarked)
        
        # 计算排版位置并绘制
        if layout == "vertical":
            # 纵向堆叠排版 (最标准的银行/政府复印件格式)
            # 水平居中
            x = (A4[0] - card_w) / 2
            
            if print_scale == "fit":
                # 铺满模式下，上下留白略多些
                y_front = 450.0
                y_back = 120.0
            else:
                # 1:1 标准模式下，上下间距美观协调 (上边距约 65mm，中缝约 37mm)
                y_front = 480.0
                y_back = 220.0
                
            pdf_canvas.drawImage(front_reader, x, y_front, width=card_w, height=card_h)
            pdf_canvas.drawImage(back_reader, x, y_back, width=card_w, height=card_h)
        else:
            # 横向并排排版 (部分特殊审查要求)
            if print_scale == "fit":
                # 铺满模式下横向尺寸
                card_w_h = 260.0
                card_h_h = 164.0
                spacing = 20.0
                total_w = card_w_h * 2 + spacing
                x_front = (A4[0] - total_w) / 2
                x_back = x_front + card_w_h + spacing
                y = (A4[1] - card_h_h) / 2
                pdf_canvas.drawImage(front_reader, x_front, y, width=card_w_h, height=card_h_h)
                pdf_canvas.drawImage(back_reader, x_back, y, width=card_w_h, height=card_h_h)
            else:
                # 1:1 模式下横向
                spacing = 30.0
                total_w = card_w * 2 + spacing
                x_front = (A4[0] - total_w) / 2
                x_back = x_front + card_w + spacing
                y = (A4[1] - card_h) / 2
                pdf_canvas.drawImage(front_reader, x_front, y, width=card_w, height=card_h)
                pdf_canvas.drawImage(back_reader, x_back, y, width=card_w, height=card_h)
                
        pdf_canvas.save()
        pdf_bytes = pdf_buffer.getvalue()
        
        # 5. 存储至本地缓存中
        try:
            cache_file.write_bytes(pdf_bytes)
        except Exception:
            pass
            
    except Exception as e:
        status = "error"
        error_msg = str(e)
        import traceback
        stack_trace = traceback.format_exc()
        raise e
    finally:
        # 6. 后端全链路三色日志上报
        execution_time_ms = int((time.time() - start_time) * 1000)
        db = SessionLocal()
        try:
            log_invocation(
                db=db,
                session_id=session_id,
                tool_type="id-card-scanner",
                ui_path="/trace/id-card-scanner",
                execution_path="backend.services.id_card_service:process_and_generate_pdf",
                execution_time_ms=execution_time_ms,
                status=status,
                parameters={**params, "cache_hit": False},
                error_message=error_msg,
                stack_trace=stack_trace
            )
        finally:
            db.close()
            
    return pdf_bytes, cache_key
