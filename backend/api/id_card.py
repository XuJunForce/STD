import urllib.parse
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.services.id_card_service import process_and_generate_pdf, CACHE_DIR

router = APIRouter()

class StandardResponse(BaseModel):
    code: int = 0
    message: str = "success"
    data: Optional[dict] = None

@router.post("/generate", response_model=StandardResponse)
async def generate_id_card(
    front_image: UploadFile = File(..., description="身份证正面/头像面图片"),
    back_image: UploadFile = File(..., description="身份证反面/国徽面图片"),
    watermark_text: str = Form("", description="安全防伪水印文本"),
    watermark_opacity: float = Form(0.15, description="水印不透明度 (0.0-1.0)"),
    watermark_color: str = Form("#CCCCCC", description="水印颜色16进制码"),
    layout: str = Form("vertical", description="排版布局: vertical(纵向) | horizontal(横向)"),
    color_mode: str = Form("grayscale", description="色彩模式: original(原色) | grayscale(灰度复印) | monochrome(黑白对比)"),
    brightness: float = Form(1.0, description="亮度倍数 (0.5-2.0)"),
    contrast: float = Form(1.0, description="对比度倍数 (0.5-2.0)"),
    front_rotate: int = Form(0, description="正面旋转角度 (0, 90, 180, 270)"),
    back_rotate: int = Form(0, description="反面旋转角度 (0, 90, 180, 270)"),
    print_scale: str = Form("1to1", description="打印比例: 1to1(1:1原大) | fit(自适应最大化铺满)"),
    file_name: str = Form("身份证复印件.pdf", description="生成PDF的保存名称"),
    session_id: str = Form("sess-api-default", description="遥测链 Session ID")
):
    """上传身份证正反面图片并生成排版好的 A4 PDF 副本"""
    # 验证上传文件类型
    for img_file in [front_image, back_image]:
        if not img_file.content_type.startswith("image/"):
            raise HTTPException(
                status_code=400,
                detail=f"文件 '{img_file.filename}' 不是有效的图片格式，请上传任何图片形式"
            )
            
    try:
        # 读取文件字节流
        front_bytes = await front_image.read()
        back_bytes = await back_image.read()
        
        # 封装参数
        params = {
            "watermark_text": watermark_text,
            "watermark_opacity": watermark_opacity,
            "watermark_color": watermark_color,
            "layout": layout,
            "color_mode": color_mode,
            "brightness": brightness,
            "contrast": contrast,
            "front_rotate": front_rotate,
            "back_rotate": back_rotate,
            "print_scale": print_scale,
            "file_name": file_name
        }
        
        # 调用核心服务生成 PDF
        _, cache_key = process_and_generate_pdf(
            front_bytes=front_bytes,
            back_bytes=back_bytes,
            params=params,
            session_id=session_id
        )
        
        # 返回文件ID和下载路径
        download_url = f"/api/v1/id-card/download/{cache_key}?filename={urllib.parse.quote(file_name)}"
        
        return {
            "code": 0,
            "message": "success",
            "data": {
                "file_id": cache_key,
                "download_url": download_url,
                "file_name": file_name
            }
        }
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"身份证拼接 PDF 生成失败: {e}"
        )
        
@router.get("/download/{file_id}")
def download_pdf(file_id: str, filename: str = "身份证复印件.pdf"):
    """根据文件ID预览/下载生成的 PDF 文档流"""
    file_path = CACHE_DIR / f"{file_id}.pdf"
    
    if not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail="生成的复印件不存在或已过期自动清理，请重新提交生成。"
        )
        
    # 对中文文件名进行符合 RFC 5987 的安全编码，确保浏览器静默打印与保存时不出现乱码
    encoded_filename = urllib.parse.quote(filename)
    headers = {
        "Content-Disposition": f"inline; filename*=UTF-8''{encoded_filename}"
    }
    
    return FileResponse(
        path=file_path,
        media_type="application/pdf",
        headers=headers
    )
