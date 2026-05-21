import os
import sys
import json
from pathlib import Path
import xml.etree.ElementTree as ET
from xml.dom import minidom

from backend.services.id_card_service import process_and_generate_pdf

def register(subparsers):
    """Register the id-card subcommand parser."""
    id_card_parser = subparsers.add_parser("id-card", help="Stitch ID card front and back photos into A4 PDF")
    
    # Required arguments
    id_card_parser.add_argument("--front", required=True, type=str, help="Path to the ID card front side photo")
    id_card_parser.add_argument("--back", required=True, type=str, help="Path to the ID card back side photo")
    
    # Optional arguments
    id_card_parser.add_argument("--output", type=str, default="./身份证复印件.pdf", help="Destination path for the output PDF (default: ./身份证复印件.pdf)")
    id_card_parser.add_argument("--watermark", type=str, default="", help="Watermark text overlay")
    id_card_parser.add_argument("--watermark-opacity", type=float, default=0.15, help="Watermark text opacity (0.0-1.0, default: 0.15)")
    id_card_parser.add_argument("--watermark-color", type=str, default="#CCCCCC", help="Watermark text hex color (default: #CCCCCC)")
    id_card_parser.add_argument("--layout", choices=["vertical", "horizontal"], default="vertical", help="Page layout (default: vertical)")
    id_card_parser.add_argument("--color-mode", choices=["original", "grayscale", "monochrome"], default="grayscale", help="Color transform mode (default: grayscale - 黑白复印)")
    id_card_parser.add_argument("--brightness", type=float, default=1.0, help="Image brightness adjustment factor (0.5-2.0, default: 1.0)")
    id_card_parser.add_argument("--contrast", type=float, default=1.0, help="Image contrast adjustment factor (0.5-2.0, default: 1.0)")
    id_card_parser.add_argument("--front-rotate", type=int, choices=[0, 90, 180, 270], default=0, help="Rotation angle in degrees for the front image (default: 0)")
    id_card_parser.add_argument("--back-rotate", type=int, choices=[0, 90, 180, 270], default=0, help="Rotation angle in degrees for the back image (default: 0)")
    id_card_parser.add_argument("--print-scale", choices=["1to1", "fit"], default="1to1", help="Stitching print scale: 1to1(1:1 original size) or fit(maximized fill) (default: 1to1)")
    
    # Formatting argument
    id_card_parser.add_argument("--format", choices=["text", "json", "xml"], default="text", help="Output format for scripts/AI agents integration (default: text)")

def handle(args):
    """Execute the id-card subcommand."""
    front_path = Path(args.front)
    back_path = Path(args.back)
    output_path = Path(args.output)
    
    # 验证输入文件是否存在
    if not front_path.exists():
        error_exit(f"Front side image file not found: {args.front}", args.format)
    if not back_path.exists():
        error_exit(f"Back side image file not found: {args.back}", args.format)
        
    try:
        # 读取输入字节流
        front_bytes = front_path.read_bytes()
        back_bytes = back_path.read_bytes()
        
        # 封装参数
        params = {
            "watermark_text": args.watermark,
            "watermark_opacity": args.watermark_opacity,
            "watermark_color": args.watermark_color,
            "layout": args.layout,
            "color_mode": args.color_mode,
            "brightness": args.brightness,
            "contrast": args.contrast,
            "front_rotate": args.front_rotate,
            "back_rotate": args.back_rotate,
            "print_scale": args.print_scale,
            "file_name": output_path.name
        }
        
        # 调用核心服务生成 PDF (使用 CLI 默认的 Session ID)
        session_id = "sess-cli-" + os.urandom(4).hex()
        pdf_bytes, cache_key = process_and_generate_pdf(
            front_bytes=front_bytes,
            back_bytes=back_bytes,
            params=params,
            session_id=session_id
        )
        
        # 保存到目标文件
        output_path.write_bytes(pdf_bytes)
        
        # 获取最终元数据
        file_size = output_path.stat().st_size
        
        # 输出结果
        if args.format == "json":
            output_json({
                "code": 0,
                "message": "success",
                "data": {
                    "output_path": str(output_path.resolve()),
                    "file_size_bytes": file_size,
                    "cache_key": cache_key,
                    "session_id": session_id
                }
            })
        elif args.format == "xml":
            output_xml({
                "output_path": str(output_path.resolve()),
                "file_size_bytes": file_size,
                "cache_key": cache_key,
                "session_id": session_id
            })
        else:
            # 适合人类查看的精美控制台输出
            print("=" * 60)
            print("🪪  身份证正反面拼接 PDF 生成成功！")
            print("=" * 60)
            print(f"输出路径:  {output_path.resolve()}")
            print(f"文件大小:  {file_size / 1024:.2f} KB ({file_size} 字节)")
            print(f"排版模式:  {args.layout} ({'纵向叠排' if args.layout == 'vertical' else '横向并排'})")
            print(f"色彩模式:  {args.color_mode} ({'黑白复印' if args.color_mode == 'grayscale' else '原色原画' if args.color_mode == 'original' else '高对比二值化'})")
            print(f"打印比例:  {args.print_scale} ({'1:1原大复印' if args.print_scale == '1to1' else '自适应最大化铺满'})")
            if args.watermark:
                print(f"安全水印:  \"{args.watermark}\" (不透明度: {args.watermark_opacity})")
            print(f"追踪哈希:  {cache_key}")
            print(f"系统日志:  已直连 MySQL 记录，会话ID 为 {session_id}")
            print("=" * 60)
            
    except Exception as e:
        error_exit(f"Execution failed: {e}", args.format)

def error_exit(message: str, output_format: str):
    """通用错误输出并退出"""
    if output_format == "json":
        print(json.dumps({"code": 1, "message": message, "data": None}, ensure_ascii=False))
    elif output_format == "xml":
        root = ET.Element("result")
        code = ET.SubElement(root, "code")
        code.text = "1"
        msg = ET.SubElement(root, "message")
        msg.text = message
        rough_string = ET.tostring(root, 'utf-8')
        reparsed = minidom.parseString(rough_string)
        print(reparsed.toprettyxml(indent="  "))
    else:
        print(f"Error: {message}", file=sys.stderr)
    sys.exit(1)

def output_json(data: dict):
    """序列化输出 JSON"""
    print(json.dumps(data, indent=2, ensure_ascii=False))

def output_xml(data: dict):
    """序列化输出 XML"""
    root = ET.Element("result")
    code = ET.SubElement(root, "code")
    code.text = "0"
    msg = ET.SubElement(root, "message")
    msg.text = "success"
    data_elem = ET.SubElement(root, "data")
    for key, value in data.items():
        child = ET.SubElement(data_elem, key)
        child.text = str(value)
    rough_string = ET.tostring(root, 'utf-8')
    reparsed = minidom.parseString(rough_string)
    print(reparsed.toprettyxml(indent="  "))
