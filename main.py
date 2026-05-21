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


def crop_id_card(image_path, output_path="id_card_crop.jpg", debug=False):
    image = cv2.imread(image_path)
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

    # 4. 多种边缘检测方法
    edges1 = cv2.Canny(blur, 30, 100)
    edges2 = cv2.Canny(blur, 50, 150)
    edges3 = cv2.Canny(blur, 75, 200)
    
    # 合并不同阈值的边缘
    edges = cv2.bitwise_or(edges1, cv2.bitwise_or(edges2, edges3))

    # 5. 形态学操作
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    edges = cv2.morphologyEx(edges, cv2.MORPH_CLOSE, kernel)
    edges = cv2.dilate(edges, kernel, iterations=1)

    if debug:
        cv2.imwrite("debug_edges.jpg", edges)

    # 6. 找轮廓
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates = []

    for cnt in contours:
        area = cv2.contourArea(cnt)

        # 降低面积阈值，从5%降到3%
        if area < img_area * 0.03:
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
                
                if w == 0 or h == 0:
                    continue
                    
                ratio = max(w, h) / min(w, h)

                # 放宽比例限制，从1.45-1.75扩大到1.3-2.0
                if 1.3 <= ratio <= 2.0:
                    # 计算轮廓占图像的比例
                    area_ratio = area / img_area
                    
                    # 优先选择面积较大且比例接近1.586的
                    score = area * (1.0 - abs(ratio - 1.586) / 1.586)
                    candidates.append((score, area, ratio, pts))
                    break

    if not candidates:
        raise ValueError("未检测到身份证边框")

    # 按评分排序
    candidates = sorted(candidates, key=lambda x: x[0], reverse=True)
    
    if debug:
        print(f"找到 {len(candidates)} 个候选框:")
        for i, (score, area, ratio, pts) in enumerate(candidates[:3]):
            print(f"  候选 {i+1}: 面积={area:.0f}, 比例={ratio:.2f}, 评分={score:.0f}")

    card_pts = candidates[0][3]

    # 7. 透视矫正并裁剪
    cropped = four_point_transform(original, card_pts)

    # 如果裁剪后是竖着的，可以自动转正
    h, w = cropped.shape[:2]
    if h > w:
        cropped = cv2.rotate(cropped, cv2.ROTATE_90_CLOCKWISE)

    cv2.imwrite(output_path, cropped)

    return output_path


if __name__ == "__main__":
    crop_id_card("input.jpg", "id_card_crop.jpg", debug=True)
