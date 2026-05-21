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

ID_CARD_RATIO = 85.6 / 54.0


def order_points(pts):
    pts = np.asarray(pts, dtype=np.float32)
    rect = np.zeros((4, 2), dtype=np.float32)

    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]   # 左上
    rect[2] = pts[np.argmax(s)]   # 右下

    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]  # 右上
    rect[3] = pts[np.argmax(diff)]  # 左下

    return rect


def line_intersection(line1, line2):
    vx1, vy1, x1, y1 = line1
    vx2, vy2, x2, y2 = line2

    A = np.array([[vx1, -vx2], [vy1, -vy2]], dtype=np.float64)
    b = np.array([x2 - x1, y2 - y1], dtype=np.float64)

    det = np.linalg.det(A)
    if abs(det) < 1e-6:
        return None

    t, _ = np.linalg.solve(A, b)
    return np.array([x1 + t * vx1, y1 + t * vy1], dtype=np.float32)


def overlap_len(a1, a2, b1, b2):
    return max(0.0, min(a2, b2) - max(a1, b1))


import math


def detect_card_by_hough(image):
    h, w = image.shape[:2]

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # 降噪，同时保留边缘
    gray = cv2.bilateralFilter(gray, 9, 75, 75)

    # 增强局部对比度
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    v = np.median(gray)
    lower = int(max(0, 0.66 * v))
    upper = int(min(255, 1.33 * v))

    edges = cv2.Canny(gray, lower, upper)

    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=max(35, int(min(w, h) * 0.08)),
        minLineLength=int(min(w, h) * 0.20),
        maxLineGap=int(min(w, h) * 0.06),
    )

    if lines is None:
        raise RuntimeError("没有检测到足够的直线边缘。")

    def cluster_lines(orientation):
        angle_tol = 25
        cluster_dist = max(10, int(min(w, h) * 0.025))

        segs = []

        for line in lines[:, 0]:
            x1, y1, x2, y2 = map(float, line)

            dx = x2 - x1
            dy = y2 - y1
            length = math.hypot(dx, dy)

            angle = math.degrees(math.atan2(dy, dx))
            angle = ((angle + 90) % 180) - 90

            if orientation == "h":
                if abs(angle) > angle_tol:
                    continue

                if length < w * 0.14:
                    continue

                coord = (y1 + y2) / 2
                span1 = min(x1, x2)
                span2 = max(x1, x2)

            else:
                if abs(abs(angle) - 90) > angle_tol:
                    continue

                if length < h * 0.14:
                    continue

                coord = (x1 + x2) / 2
                span1 = min(y1, y2)
                span2 = max(y1, y2)

            segs.append((coord, span1, span2, length, (x1, y1, x2, y2)))

        segs.sort(key=lambda item: item[0])

        clusters = []

        for seg in segs:
            coord, span1, span2, length, points = seg
            target = None

            for c in clusters:
                if abs(coord - c["coord"]) <= cluster_dist:
                    target = c
                    break

            if target is None:
                clusters.append({
                    "coord": coord,
                    "minspan": span1,
                    "maxspan": span2,
                    "length": length,
                    "items": [seg],
                })
            else:
                target["items"].append(seg)

                total = sum(item[3] for item in target["items"])

                target["coord"] = sum(item[0] * item[3] for item in target["items"]) / total
                target["minspan"] = min(item[1] for item in target["items"])
                target["maxspan"] = max(item[2] for item in target["items"])
                target["length"] = total

        # 每一组线段拟合成一条直线
        for c in clusters:
            pts = []

            for item in c["items"]:
                x1, y1, x2, y2 = item[4]
                pts.append([x1, y1])
                pts.append([x2, y2])

            pts = np.array(pts, dtype=np.float32)

            vx, vy, x0, y0 = cv2.fitLine(
                pts,
                cv2.DIST_L2,
                0,
                0.01,
                0.01,
            ).flatten()

            c["line"] = (float(vx), float(vy), float(x0), float(y0))

        return clusters

    h_lines = cluster_lines("h")
    v_lines = cluster_lines("v")

    candidates = []
    img_area = w * h

    for top in h_lines:
        for bottom in h_lines:
            if bottom["coord"] <= top["coord"]:
                continue

            for left in v_lines:
                for right in v_lines:
                    if right["coord"] <= left["coord"]:
                        continue

                    tl = line_intersection(top["line"], left["line"])
                    tr = line_intersection(top["line"], right["line"])
                    br = line_intersection(bottom["line"], right["line"])
                    bl = line_intersection(bottom["line"], left["line"])

                    if any(p is None for p in [tl, tr, br, bl]):
                        continue

                    pts = np.array([tl, tr, br, bl], dtype=np.float32)

                    if not np.all(np.isfinite(pts)):
                        continue

                    width_top = np.linalg.norm(tr - tl)
                    width_bottom = np.linalg.norm(br - bl)
                    height_left = np.linalg.norm(bl - tl)
                    height_right = np.linalg.norm(br - tr)

                    avg_width = (width_top + width_bottom) / 2
                    avg_height = (height_left + height_right) / 2

                    if avg_width <= 0 or avg_height <= 0:
                        continue

                    ratio = max(avg_width, avg_height) / min(avg_width, avg_height)

                    if not 1.25 <= ratio <= 2.05:
                        continue

                    area = abs(cv2.contourArea(pts))

                    if area < img_area * 0.05 or area > img_area * 0.85:
                        continue

                    x_min, y_min = pts.min(axis=0)
                    x_max, y_max = pts.max(axis=0)

                    edge_margin = min(w, h) * 0.02
                    touch_count = 0
                    touch_count += int(x_min <= edge_margin)
                    touch_count += int(y_min <= edge_margin)
                    touch_count += int((w - x_max) <= edge_margin)
                    touch_count += int((h - y_max) <= edge_margin)

                    # 防止把整张图片外边界误判成身份证
                    if touch_count >= 2 and area > img_area * 0.60:
                        continue

                    top_cov = overlap_len(
                        top["minspan"],
                        top["maxspan"],
                        min(tl[0], tr[0]),
                        max(tl[0], tr[0]),
                    ) / max(avg_width, 1)

                    bottom_cov = overlap_len(
                        bottom["minspan"],
                        bottom["maxspan"],
                        min(bl[0], br[0]),
                        max(bl[0], br[0]),
                    ) / max(avg_width, 1)

                    left_cov = overlap_len(
                        left["minspan"],
                        left["maxspan"],
                        min(tl[1], bl[1]),
                        max(tl[1], bl[1]),
                    ) / max(avg_height, 1)

                    right_cov = overlap_len(
                        right["minspan"],
                        right["maxspan"],
                        min(tr[1], br[1]),
                        max(tr[1], br[1]),
                    ) / max(avg_height, 1)

                    if min(top_cov, bottom_cov, left_cov, right_cov) < 0.18:
                        continue

                    ratio_score = max(0.0, 1 - abs(ratio - ID_CARD_RATIO) / ID_CARD_RATIO)
                    coverage_score = (top_cov + bottom_cov + left_cov + right_cov) / 4

                    score = area * ratio_score * coverage_score

                    candidates.append((score, pts))

    if not candidates:
        raise RuntimeError(
            f"没有找到身份证矩形。检测到横线组 {len(h_lines)} 个，竖线组 {len(v_lines)} 个。"
        )

    candidates.sort(key=lambda item: item[0], reverse=True)

    best_pts = order_points(candidates[0][1])

    best_pts[:, 0] = np.clip(best_pts[:, 0], 0, w - 1)
    best_pts[:, 1] = np.clip(best_pts[:, 1], 0, h - 1)

    return best_pts


def perspective_correct(image, pts, output_width=1011):
    rect = order_points(pts)

    tl, tr, br, bl = rect

    width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2

    # 如果身份证是竖着拍的，调整点顺序，让输出仍然是横向
    if width < height:
        rect = np.array([bl, tl, tr, br], dtype=np.float32)

    output_height = int(round(output_width / ID_CARD_RATIO))

    dst = np.array([
        [0, 0],
        [output_width - 1, 0],
        [output_width - 1, output_height - 1],
        [0, output_height - 1],
    ], dtype=np.float32)

    M = cv2.getPerspectiveTransform(rect, dst)

    warped = cv2.warpPerspective(
        image,
        M,
        (output_width, output_height),
        flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )

    return warped


def crop_inner_margin(image, margin_ratio=0.004):
    h, w = image.shape[:2]

    mx = int(w * margin_ratio)
    my = int(h * margin_ratio)

    if mx <= 0 or my <= 0:
        return image

    return image[my:h - my, mx:w - mx]


def to_black_white(image):
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # 轻微去噪，避免把底纹二值化成大片噪点
    gray = cv2.GaussianBlur(gray, (3, 3), 0)

    _, bw = cv2.threshold(
        gray,
        0,
        255,
        cv2.THRESH_BINARY + cv2.THRESH_OTSU,
    )

    if np.mean(bw) < 127:
        bw = 255 - bw

    return bw


def add_white_border(image, thickness=20):
    """给图像边缘绘制一圈纯白色边框，遮盖任何残存的细微毛边和阴影"""
    h, w = image.shape[:2]
    # 绘制纯白色矩形边框覆盖边缘 (thickness * 2 像素线宽)
    # 增加厚度以完全覆盖阴影区域
    cv2.rectangle(image, (0, 0), (w, h), (255, 255, 255), thickness * 2)
    return image


def crop_id_card_bytes(img_bytes: bytes) -> bytes:
    """使用本地 OpenCV 进行基于 Hough 变换的身份证高精边缘检测与透视扶正裁剪，返回 bytes。
    如果未检测到身份证边框，抛出 ValueError，由上层捕获降级。
    """
    nparr = np.frombuffer(img_bytes, np.uint8)
    image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("图片解码失败")

    try:
        pts = detect_card_by_hough(image)
        # 扶正并缩放到标准高精尺寸，并在内侧裁剪后加 20px 纯白遮挡边框以保证边缘完美无瑕
        corrected = perspective_correct(image, pts, output_width=1063)
        corrected = crop_inner_margin(corrected, margin_ratio=0.004)
        corrected = add_white_border(corrected, thickness=20)

        success, encoded_img = cv2.imencode(".jpg", corrected)
        if not success:
            raise ValueError("图片编码失败")
        return encoded_img.tobytes()
    except Exception as e:
        raise ValueError(f"未检测到身份证边框: {e}")


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
        cv_img = np.array(img)
        # Convert RGB to BGR
        cv_img = cv_img[:, :, ::-1].copy()
        
        bw = to_black_white(cv_img)
        
        # 将二值化后的图像转回 PIL Image
        img = Image.fromarray(bw).convert("RGB")
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
