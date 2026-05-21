import io
import os
import time
import hashlib
import json
from pathlib import Path
from typing import Dict, Any, Tuple
from PIL import Image, ImageEnhance, ImageDraw, ImageFont
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader

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
