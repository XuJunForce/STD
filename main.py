import cv2
import numpy as np


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


def expand_to_id_card_rect(x, y, w, h, img_w, img_h):
    """Expand a foreground box to the standard ID-card ratio."""
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


def crop_by_grabcut(image):
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
    
    # 向内收缩 1.5% 以去除 GrabCut 边界可能带有的背景毛边与虚影
    inset_px_w = int(w * 0.015)
    inset_px_h = int(h * 0.015)
    x += inset_px_w
    y += inset_px_h
    w -= inset_px_w * 2
    h -= inset_px_h * 2

    x, y, w, h = expand_to_id_card_rect(x, y, w, h, img_w, img_h)
    if w <= 0 or h <= 0:
        return None

    return image[y:y + h, x:x + w]


def crop_id_card(image_path, output_path="id_card_crop.jpg", debug=False):
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError("图片读取失败")

    grabcut_crop = crop_by_grabcut(image)
    if grabcut_crop is not None:
        if debug:
            print("成功使用 GrabCut 前景分割定位身份证主体")
        # 统一缩放到高清晰度尺寸并增加白边
        cleaned_resized = cv2.resize(grabcut_crop, (1063, 710), interpolation=cv2.INTER_LANCZOS4)
        cleaned_resized = add_white_border(cleaned_resized, thickness=8)
        cv2.imwrite(output_path, cleaned_resized)
        return output_path

    original = image.copy()
    img_area = image.shape[0] * image.shape[1]

    # 1. 灰度化
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)

    # 2. 自适应直方图均衡化，增强对比度
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    gray = clahe.apply(gray)

    # 3. 去噪
    blur = cv2.GaussianBlur(gray, (5, 5), 0)

    # 4. 多种边缘检测方法并合并，获得极高的召回率
    edges1 = cv2.Canny(blur, 30, 100)
    edges2 = cv2.Canny(blur, 50, 150)
    edges3 = cv2.Canny(blur, 75, 200)
    edges_base = cv2.bitwise_or(edges1, cv2.bitwise_or(edges2, edges3))

    # 自适应形态学参数组合，防止床单等高噪声背景下边缘和主体粘连导致定位失败
    parameter_combos = [
        # (morph_size, dilate_size, dilate_iter)
        (3, 2, 1),
        (3, 3, 0),
        (5, 5, 0),
        (3, 3, 1),
    ]

    best_candidate = None
    winning_combo = None

    for morph_size, dilate_size, dilate_iter in parameter_combos:
        edges = edges_base.copy()
        if morph_size > 0:
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (morph_size, morph_size))
            edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
        if dilate_iter > 0:
            kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (dilate_size, dilate_size))
            edges = cv2.dilate(edges, kernel, iterations=dilate_iter)

        if debug:
            cv2.imwrite(f"debug_edges_m{morph_size}_d{dilate_iter}.jpg", edges)

        # 6. 使用 RETR_LIST 查找轮廓，确保能够检索到被包裹在闭合图片边界内的身份证轮廓
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

        candidates = []
        for cnt in contours:
            area = cv2.contourArea(cnt)

            # 限制轮廓面积并拒绝贴边整图外框，避免把照片边界误判为身份证
            if area < img_area * 0.03 or area > img_area * 0.80:
                continue

            # 多边形拟合
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
                    touches_frame = x <= 2 or y <= 2 or x + w >= image.shape[1] - 2 or y + h >= image.shape[0] - 2
                    if touches_frame:
                        continue
                    if w == 0 or h == 0:
                        continue
                        
                    ratio = max(w, h) / min(w, h)

                    # 放宽比例限制到 1.3 - 2.0 提升抗形变能力
                    if 1.3 <= ratio <= 2.0:
                        score = area * (1.0 - abs(ratio - 1.586) / 1.586)
                        candidates.append((score, area, ratio, pts))
                        break

        if candidates:
            candidates = sorted(candidates, key=lambda x: x[0], reverse=True)
            # 只有当最好候选者的面积占图像面积 10% 以上时才采纳，排除细碎噪声
            if candidates[0][1] >= img_area * 0.10:
                best_candidate = candidates[0]
                winning_combo = (morph_size, dilate_size, dilate_iter)
                break

    if not best_candidate:
        raise ValueError("未检测到身份证边框")

    if debug:
        print(f"成功使用形态学参数组合 {winning_combo}: 面积={best_candidate[1]:.0f}, 比例={best_candidate[2]:.2f}, 评分={best_candidate[0]:.0f}")

    card_pts = best_candidate[3]

    # 7. 透视矫正并裁剪
    shrunk_pts = shrink_quad(card_pts, factor=0.985)
    cropped = four_point_transform(original, shrunk_pts)

    # 如果裁剪后是竖着的，可以自动转正
    h, w = cropped.shape[:2]
    if h > w:
        cropped = cv2.rotate(cropped, cv2.ROTATE_90_CLOCKWISE)

    # 强行缩放到 1:1 标准高精尺寸 1063 x 710，采用 Lanczos4 获最高品质
    cropped_resized = cv2.resize(cropped, (1063, 710), interpolation=cv2.INTER_LANCZOS4)

    # 绘制纯物理白边以遮盖边缘毛刺
    cropped_resized = add_white_border(cropped_resized, thickness=8)

    cv2.imwrite(output_path, cropped_resized)

    return output_path


if __name__ == "__main__":
    try:
        print("Testing front ID card...")
        crop_id_card("testdata/身份证正面.jpg", "front_crop.jpg", debug=True)
        print("Front card cropped successfully!")
    except Exception as e:
        print(f"Front card cropping failed: {e}")

    try:
        print("\nTesting back ID card...")
        crop_id_card("testdata/身份证反面.jpg", "back_crop.jpg", debug=True)
        print("Back card cropped successfully!")
    except Exception as e:
        print(f"Back card cropping failed: {e}")
