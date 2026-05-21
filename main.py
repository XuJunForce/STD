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

# 检测本地 OpenCV 与 Numpy 环境以支持三维透视校正与抠图本地兜底
HAS_OPENCV = False
try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    pass

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

def local_opencv_crop_and_resize(src_path, dest_path):
    """使用本地 OpenCV 对身份证进行边缘智能检测并做 3D 透视扶正裁剪，保存为标准的 300 DPI 1063x710 图片"""
    if not HAS_OPENCV:
        raise RuntimeError("未检测到本地 opencv-python / numpy 运行库。")
        
    image = cv2.imread(src_path)
    if image is None:
        raise ValueError("图片读取失败")

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

    # 5. 形态学边缘线缝合与膨胀
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
    edges = cv2.dilate(edges, kernel, iterations=1)

    # 6. 提取最大轮廓
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates = []

    for cnt in contours:
        area = cv2.contourArea(cnt)

        # 降低面积阈值，适配不同焦距与背景占比下的身份证照片
        if area < img_area * 0.03:
            continue

        # 多精度折线拟合，防止反光造成轮廓多边化
        peri = cv2.arcLength(cnt, True)
        for epsilon_factor in [0.02, 0.03, 0.04, 0.05]:
            approx = cv2.approxPolyDP(cnt, epsilon_factor * peri, True)
            
            # 接受四边形至六边形做顶点逼近
            if 4 <= len(approx) <= 6:
                if len(approx) > 4:
                    # 5或6边形取其最小外接矩形框的四个顶点
                    rect = cv2.minAreaRect(cnt)
                    box = cv2.boxPoints(rect)
                    pts = np.intp(box)
                else:
                    pts = approx.reshape(-1, 2)

                x, y, w, h = cv2.boundingRect(pts)
                if w == 0 or h == 0:
                    continue
                    
                ratio = max(w, h) / min(w, h)

                # 宽容比例范围限制
                if 1.3 <= ratio <= 2.0:
                    # 分值模型：面积大且宽高比越贴近身份证国标黄金比例 1.586 分数越高
                    score = area * (1.0 - abs(ratio - 1.586) / 1.586)
                    candidates.append((score, pts))
                    break

    if not candidates:
        raise ValueError("未检测到高置信度的身份证边缘轮廓。")

    # 取分值最高的第一候选框
    candidates = sorted(candidates, key=lambda x: x[0], reverse=True)
    card_pts = candidates[0][1]

    # 7. 射影几何 3D 逆变换拉平与裁剪
    cropped = four_point_transform(original, card_pts)

    # 8. 智能横放（若裁剪出的是竖向长图则顺时针转90度扶正）
    h, w = cropped.shape[:2]
    if h > w:
        cropped = cv2.rotate(cropped, cv2.ROTATE_90_CLOCKWISE)

    # 9. 强行缩放到 1:1 标准高精尺寸 1063 x 710，采用 Lanczos4 获最高品质
    cropped_resized = cv2.resize(cropped, (1063, 710), interpolation=cv2.INTER_LANCZOS4)
    cv2.imwrite(dest_path, cropped_resized)
    
    # 用 Pillow 开启重写 300 DPI 元数据物理融合
    with Image.open(dest_path) as img_pil:
        img_pil.save(dest_path, dpi=(300, 300))

def local_crop_and_resize(src_path, dest_path):
    """本地居中等比裁剪并缩放到 1063 x 710，保存为 300 DPI (Pillow 终极保底防线)"""
    with Image.open(src_path) as img:
        img_w, img_h = img.size
        target_ratio = 1063 / 710
        current_ratio = img_w / img_h
        
        if current_ratio > target_ratio:
            new_w = int(img_h * target_ratio)
            left = (img_w - new_w) // 2
            right = left + new_w
            img_cropped = img.crop((left, 0, right, img_h))
        else:
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
        print_warning(f"正面云端识别裁剪失败 ({e})")
        # 智能切换本地 OpenCV (第二防线)
        try:
            print_info("正在启动本地 OpenCV 引擎进行智能边缘捕捉与透视校正...")
            local_opencv_crop_and_resize(imgPath1, "tmp/Front.jpg")
            print_success("正面本地 OpenCV 智能抠图与透视拉平成功！")
        except Exception as ocv_err:
            print_warning(f"正面本地 OpenCV 抠图失败 ({ocv_err})，正在启动 Pillow 进行居中等比裁剪保底 (第三防线)...")
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
        print_warning(f"反面云端识别裁剪失败 ({e})")
        # 智能切换本地 OpenCV (第二防线)
        try:
            print_info("正在启动本地 OpenCV 引擎进行智能边缘捕捉与透视校正...")
            local_opencv_crop_and_resize(imgPath2, "tmp/Back.jpg")
            print_success("反面本地 OpenCV 智能抠图与透视拉平成功！")
        except Exception as ocv_err:
            print_warning(f"反面本地 OpenCV 抠图失败 ({ocv_err})，正在启动 Pillow 进行居中等比裁剪保底 (第三防线)...")
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
