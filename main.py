import os
import io
import re
import sys
import time
import json
import base64
from PIL import Image
from dotenv import load_dotenv

try:
    from tencentcloud.common import credential
    from tencentcloud.common.profile.client_profile import ClientProfile
    from tencentcloud.common.profile.http_profile import HttpProfile
    from tencentcloud.common.exception.tencent_cloud_sdk_exception import TencentCloudSDKException
    from tencentcloud.ocr.v20181119 import ocr_client, models
except ImportError:
    print("\033[91m错误：未检测到 tencentcloud-sdk-python 库。\033[0m")
    print("请先执行：\033[93mpip install --upgrade tencentcloud-sdk-python\033[0m")
    sys.exit(1)

# 加载 .env 环境变量
load_dotenv()

SecretId = os.getenv("TENCENTCLOUD_SECRET_ID", "").strip()
SecretKey = os.getenv("TENCENTCLOUD_SECRET_KEY", "").strip()

# 颜色控制台打印工具
def print_success(msg):
    print(f"\033[92m[✓] {msg}\033[0m")

def print_info(msg):
    print(f"\033[94m[*] {msg}\033[0m")

def print_warning(msg):
    print(f"\033[93m[!] {msg}\033[0m")

def print_error(msg):
    print(f"\033[91m[✗] {msg}\033[0m")

def init_env():
    """初始化目录并验证 API 密钥"""
    if not SecretId or not SecretKey:
        print_error("未检测到腾讯云 API 密钥配置！")
        print_warning("请在根目录的 .env 文件中填入相应的 TENCENTCLOUD_SECRET_ID 和 TENCENTCLOUD_SECRET_KEY。")
        sys.exit(1)

    # 创临时与输出目录
    if not os.path.exists("./tmp"):
        os.makedirs("./tmp")
    if not os.path.exists("./output"):
        os.makedirs("./output")

def clear_tmp():
    """清理临时文件夹"""
    if os.path.exists("./tmp"):
        for f in os.listdir("./tmp"):
            try:
                os.remove(os.path.join("./tmp", f))
            except Exception:
                pass

def picture2base(path):
    """图片转 Base64 编码"""
    with open(path, 'rb') as f:
        return base64.b64encode(f.read()).decode('utf-8')

def base2picture(b64_data, dest_path):
    """Base64 编码保存为图片"""
    img_data = base64.b64decode(b64_data)
    with open(dest_path, 'wb') as f:
        f.write(img_data)

def set_image_dpi_resize(src_path, dest_path):
    """将裁剪后的身份证图片缩放到 1:1 标准 DPI 物理比例 (1063 x 710)"""
    with Image.open(src_path) as img:
        # 使用现代高级的 LANCZOS 重采样算法，获得最平滑抗锯齿清晰度
        img_resized = img.resize((1063, 710), Image.Resampling.LANCZOS)
        img_resized = img_resized.convert('RGB')
        img_resized.save(dest_path, dpi=(300, 300))

def crop_id_card_side(img_b64, side="FRONT"):
    """使用腾讯云 OCR 对单面身份证进行智能裁剪纠偏"""
    cred = credential.Credential(SecretId, SecretKey)
    httpProfile = HttpProfile()
    httpProfile.endpoint = "ocr.tencentcloudapi.com"
    
    clientProfile = ClientProfile()
    clientProfile.httpProfile = httpProfile
    client = ocr_client.OcrClient(cred, "ap-guangzhou", clientProfile)
    
    req = models.IDCardOCRRequest()
    card_side = "FRONT" if side.upper() == "FRONT" else "BACK"
    params = {
        "ImageBase64": img_b64,
        "CardSide": card_side,
        "Config": json.dumps({"CropIdCard": True, "CropPortrait": False})
    }
    req.from_json_string(json.dumps(params))
    
    resp = client.IDCardOCR(req)
    resp_json = json.loads(resp.to_json_string())
    
    advanced_info_str = resp_json.get("AdvancedInfo")
    if not advanced_info_str:
        raise ValueError("腾讯云未返回高级识别结果 (AdvancedInfo)，请确保图片中身份证清晰可见。")
        
    advanced_info = json.loads(advanced_info_str)
    cropped_b64 = advanced_info.get("IdCard")
    if not cropped_b64:
        raise ValueError("腾讯云未能自动抠图裁剪出身份证，请确保身份证四周无遮挡。")
        
    return cropped_b64

def local_crop_and_resize(src_path, dest_path):
    """本地居中等比裁剪并缩放到 1063 x 710，保存为 300 DPI"""
    with Image.open(src_path) as img:
        img_w, img_h = img.size
        target_ratio = 1063 / 710
        current_ratio = img_w / img_h
        
        if current_ratio > target_ratio:
            # 原始图片过宽，需要裁掉左右边缘
            new_w = int(img_h * target_ratio)
            left = (img_w - new_w) // 2
            right = left + new_w
            img_cropped = img.crop((left, 0, right, img_h))
        else:
            # 原始图片过高，需要裁掉上下边缘
            new_h = int(img_w / target_ratio)
            top = (img_h - new_h) // 2
            bottom = top + new_h
            img_cropped = img.crop((0, top, img_w, bottom))
            
        img_resized = img_cropped.resize((1063, 710), Image.Resampling.LANCZOS)
        img_resized = img_resized.convert('RGB')
        img_resized.save(dest_path, dpi=(300, 300))
        img_cropped.close()

def get_print_img(imgPath1, imgPath2):
    """拼合两张身份证正反面至 A4 大图"""
    clear_tmp()
    
    # 1. 裁剪正面
    try:
        img1_b64 = picture2base(imgPath1)
        front_cropped_b64 = crop_id_card_side(img1_b64, "FRONT")
        base2picture(front_cropped_b64, "tmp/Front_raw.jpg")
        set_image_dpi_resize("tmp/Front_raw.jpg", "tmp/Front.jpg")
        print_success("正面云端智能裁剪并扶正成功")
    except Exception as e:
        print_warning(f"正面云端识别裁剪失败 ({e})，正在启用本地居中等比裁剪兜底...")
        local_crop_and_resize(imgPath1, "tmp/Front.jpg")
        
    time.sleep(0.5)  # 避免过快请求触发腾讯云 QPS 限制

    # 2. 裁剪反面
    try:
        img2_b64 = picture2base(imgPath2)
        back_cropped_b64 = crop_id_card_side(img2_b64, "BACK")
        base2picture(back_cropped_b64, "tmp/Back_raw.jpg")
        set_image_dpi_resize("tmp/Back_raw.jpg", "tmp/Back.jpg")
        print_success("反面云端智能裁剪并扶正成功")
    except Exception as e:
        print_warning(f"反面云端识别裁剪失败 ({e})，正在启用本地居中等比裁剪兜底...")
        local_crop_and_resize(imgPath2, "tmp/Back.jpg")
        
    time.sleep(0.5)

    # 3. 拼合到 A4 白板 (300 DPI)
    # A4 页面在 300 DPI 下的标准分辨率为 2481 x 3510 像素
    width, height = int(8.27 * 300), int(11.7 * 300)
    page = Image.new('RGB', (width, height), 'white')
    
    # 粘贴正反面，居中位置排列 (标准 1:1 复印排版)
    front_img = Image.open('tmp/Front.jpg')
    back_img = Image.open('tmp/Back.jpg')
    
    page.paste(front_img, box=(710, 720))
    page.paste(back_img, box=(710, 1740))
    
    front_img.close()
    back_img.close()
    
    # 提取文件名便于命名
    img1_name = os.path.splitext(os.path.basename(imgPath1))[0]
    img2_name = os.path.splitext(os.path.basename(imgPath2))[0]
    imgName = img1_name + '+' + img2_name
    
    output_path = os.path.join("./output", f"{imgName}.jpg")
    page.save(output_path, dpi=(300, 300))
    page.close()
    
    clear_tmp()
    return output_path


def get_sorted_numeric_images(root_dir="."):
    """搜索目录下所有以数字命名的图片文件，并按数值升序排序"""
    img_list = []
    # 过滤主流图片格式
    valid_exts = ('.bmp', '.dib', '.png', '.jpg', '.jpeg', '.pbm', '.pgm', '.ppm', '.tif', '.tiff', '.webp')
    
    for entry in os.scandir(root_dir):
        if entry.is_file() and entry.name.lower().endswith(valid_exts):
            base_name = os.path.splitext(entry.name)[0]
            # 严格验证是否纯数字命名
            if re.match(r'^\d+$', base_name):
                num_val = int(base_name)
                img_list.append((num_val, entry.path))
                
    # 按数值进行升序排序
    img_list.sort(key=lambda x: x[0])
    return [item[1] for item in img_list]

def main():
    print_info("=" * 50)
    print_info("  🪪 腾讯云 OCR 身份证自动裁剪与 A4 批处理拼版工具")
    print_info("=" * 50)
    
    init_env()
    
    # 检索图片路径
    images = get_sorted_numeric_images(".")
    img_len = len(images)
    
    if img_len == 0:
        print_warning("未在当前目录下找到以纯数字命名的身份证图片文件。")
        print_info("请确保图片重命名为偶数正面、奇数反面（如 0.jpg 1.jpg 2.png 3.png 依次递增）。")
        return
        
    print_success(f"成功扫描并排序得到 {img_len} 张数字编号的身份证图片。")
    for idx, path in enumerate(images):
        side_tag = "正面" if idx % 2 == 0 else "反面"
        print(f"  └─ 编号 {os.path.basename(path)} -> 归入：{side_tag}")
        
    if img_len % 2 != 0:
        print_error("【致命错误】身份证图片的总数量必须为 2 的倍数（正反双面配对），当前数量为奇数，拒绝继续执行。")
        sys.exit(1)
        
    total_pairs = img_len // 2
    print_info(f"开始批量拼版处理，共需生成 {total_pairs} 张 A4 复印件...")
    
    for i in range(total_pairs):
        front_path = images[i * 2]
        back_path = images[i * 2 + 1]
        
        front_name = os.path.basename(front_path)
        back_name = os.path.basename(back_path)
        
        print_info(f"正在拼合对：{front_name} (正面) + {back_name} (反面) ... [进度 {i+1}/{total_pairs}]")
        
        try:
            out_file = get_print_img(front_path, back_path)
            print_success(f"完成！生成拼合文件：{out_file}")
        except Exception as e:
            print_error(f"处理配对 {front_name} + {back_name} 失败！错误信息：{e}")
            print_warning("正在尝试继续处理下一对...")
            
    print_info("=" * 50)
    print_success("所有拼合任务执行完毕！请查看当前目录下的 output/ 文件夹。")
    print_info("=" * 50)

if __name__ == "__main__":
    main()
