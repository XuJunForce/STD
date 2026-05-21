# 编码笔记：集成腾讯云 OCR 身份证智能裁剪与双轨高可用系统

## 1. 功能说明
为了向用户提供金融级、高精度、免受倾斜反光和梯形失真干扰的身份证裁剪与 A4 拼接复印体验，本次开发将**腾讯云身份证识别接口 (IDCardOCR)** 无缝接入系统，打造了 Web 应用与本地批处理脚本的“双轨双通道”高可用系统：
1. **云端 AI 智能扶正与纠偏**:
   - 后端集成腾讯云 SDK。当开启云端 AI 功能时，上传的高分辨率身份证原图会自动发送至腾讯云 `IDCardOCR`。
   - 利用其强大的云端计算机视觉算法，智能去掉证件外多余的边缘、自动矫正拍摄角度（实现 360 度扶正），并返回完美的正交直立裁剪身份证图像 Base64。
2. **Web 端高可用退避降级防线**:
   - 在 API 路由与 `id_card_service` 中集成了极其稳固的 try-except 降级链。
   - 若用户的 `.env` 中未配置腾讯 API 密钥、网络请求超时或腾讯云接口限频报错，系统不会崩溃，而是会自动无缝地退避到本地的 **OpenCV.js WebAssembly / Pillow 算法防线**，确保 100% 成功生成 A4 副本。
3. **极简极美前端 UI 开关与呼吸灯**:
   - 在前端配置面板中增加磨砂玻璃高质感的“云端 AI 辅助 (智能裁剪与纠偏)”开关，配备微动效与专属的状态呼吸指示灯。
   - 当启用云端 AI 裁剪时，前端自动选择原始高清像素流上传，规避本地预裁剪对云端识别率的影响。
4. **根目录批量处理命令行工具开发 (`main.py`)**:
   - 在项目根目录下独立开发了高健壮性的批处理拼版工具 `main.py`。
   - 支持从 `.env` 安全读取密钥，自动对输入目录下的所有图片按照其**纯数字编号数值大小进行升序排序**（偶数自动归入正面，奇数自动归入反面）。
   - 双重调用腾讯云 OCR API 剪裁，最后在内存中以 300 DPI (2481 × 3510) 物理 A4 尺寸拼合排版导出，且在云端异常时自动启用 `local_crop_and_resize` 本地居中等比裁剪兜底，保证拼版绝对不中断。

---

## 2. 关键代码

### 后端核心集成与高可用兜底 (`backend/services/id_card_service.py`)
在 `process_and_generate_pdf` 主生成逻辑中，对 `use_tencent_ocr` 参数进行动态拦截，并在云端裁剪失败时友好输出日志、自动回退到本地：

```python
def crop_image_via_tencent_ocr(img_bytes: bytes, side: str) -> bytes:
    """调用腾讯云 OCR API 裁剪身份证并做自动倾斜校正，返回裁剪后的图片 bytes。
    如果密钥未配置、接口报错或任何异常，则抛出异常，由上层捕获并平滑降级。
    """
    secret_id = os.getenv("TENCENTCLOUD_SECRET_ID", "").strip()
    secret_key = os.getenv("TENCENTCLOUD_SECRET_KEY", "").strip()
    
    if not secret_id or not secret_key:
        raise ValueError("Tencent Cloud SecretId/SecretKey not configured in .env file.")
        
    img_b64 = base64.b64encode(img_bytes).decode('utf-8')
    
    cred = credential.Credential(secret_id, secret_key)
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
        raise ValueError("AdvancedInfo not returned from Tencent Cloud OCR API.")
        
    advanced_info = json.loads(advanced_info_str)
    cropped_b64 = advanced_info.get("IdCard")
    if not cropped_b64:
        raise ValueError("IdCard cropped image base64 not found in AdvancedInfo.")
        
    return base64.b64decode(cropped_b64)

# process_and_generate_pdf 内部降级流：
if use_tencent_ocr:
    try:
        front_cropped = crop_image_via_tencent_ocr(front_bytes, "FRONT")
        front_bytes = front_cropped
        print("🔥 [Tencent OCR] Front image cropped and deskewed successfully.")
    except Exception as e:
        print(f"⚠️ [Tencent OCR] Front crop failed: {e}. Falling back to original/local crop.")
    
    try:
        back_cropped = crop_image_via_tencent_ocr(back_bytes, "BACK")
        back_bytes = back_cropped
        print("🔥 [Tencent OCR] Back image cropped and deskewed successfully.")
    except Exception as e:
        print(f"⚠️ [Tencent OCR] Back crop failed: {e}. Falling back to original/local crop.")
```

### 批处理脚本中的数值排序与本地居中裁剪降级 (`main.py`)
在命令行批处理脚本中，实现了根据数字大小自然排序，并新增了 `local_crop_and_resize` 用以防止无密钥或云端宕机时的报错崩溃：

```python
def get_sorted_numeric_images(root_dir="."):
    """搜索目录下所有以数字命名的图片文件，并按数值升序排序"""
    img_list = []
    valid_exts = ('.bmp', '.dib', '.png', '.jpg', '.jpeg', '.pbm', '.pgm', '.ppm', '.tif', '.tiff', '.webp')
    
    for entry in os.scandir(root_dir):
        if entry.is_file() and entry.name.lower().endswith(valid_exts):
            base_name = os.path.splitext(entry.name)[0]
            if re.match(r'^\d+$', base_name):
                num_val = int(base_name)
                img_list.append((num_val, entry.path))
                
    img_list.sort(key=lambda x: x[0])
    return [item[1] for item in img_list]

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
```

---

## 3. 注意事项
1. **依赖升级提醒**: 批处理脚本依赖 Pillow 和 tencentcloud-sdk-python。如果在纯净环境运行，建议使用 `uv run --project backend python main.py`，因为后端依赖环境已集成并加锁，也可以直接使用提示进行手动 `pip install`。
2. **安全隔离策略**: 必须统一将腾讯云 `SecretId` 和 `SecretKey` 放置于根目录的 `.env` 变量配置文件中，绝不应为了贪图简便而将其硬编码写入 python 代码里，防范敏感密钥泄露。
3. **QPS 保护限流**: 腾讯云免费/基础级别的 OCR 识别通常有 QPS 限制，在 `main.py` 批量调用及 Web 端的处理链路中均设置了 `time.sleep(0.5)` 的适度延时保护，避免突发高频调用触发频控拦截。
4. **数字配对要求**: 批处理工具在处理数字图片时，图片总数必须为 2 的倍数（两两正反配对），且偶数编号代表正面，奇数编号代表反面，从 0 开始。
