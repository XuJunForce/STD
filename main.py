import cv2
import numpy as np
from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
import os


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


def add_white_border(image, thickness=16):
    """给图像边缘绘制一圈纯白色边框，遮盖任何残存的细微毛边"""
    h, w = image.shape[:2]
    # 绘制纯白色矩形边框覆盖边缘 (thickness * 2 像素线宽)
    cv2.rectangle(image, (0, 0), (w, h), (255, 255, 255), thickness * 2)
    return image


def crop_id_card(image_path, output_path="id_card_crop.jpg", debug=False):
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError("图片读取失败")

    try:
        pts = detect_card_by_hough(image)
        # 采用 Hough 变换精确定位边缘并进行 3D 透视变换与内缩边缘裁剪
        corrected = perspective_correct(image, pts, output_width=1063)
        corrected = crop_inner_margin(corrected, margin_ratio=0.004)
        corrected = add_white_border(corrected, thickness=16)

        cv2.imwrite(output_path, corrected)
        return output_path
    except Exception as e:
        raise ValueError(f"未检测到身份证边框: {e}")


def enhance_image_quality(image):
    """增强图像质量：锐化、降噪、对比度优化"""
    # 转换为LAB色彩空间进行处理
    lab = cv2.cvtColor(image, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    
    # 对L通道应用CLAHE增强对比度
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l = clahe.apply(l)
    
    # 合并通道
    enhanced_lab = cv2.merge([l, a, b])
    enhanced = cv2.cvtColor(enhanced_lab, cv2.COLOR_LAB2BGR)
    
    # 轻微锐化
    kernel = np.array([[-1,-1,-1],
                       [-1, 9,-1],
                       [-1,-1,-1]]) * 0.5
    sharpened = cv2.filter2D(enhanced, -1, kernel)
    
    # 双边滤波降噪但保留边缘
    result = cv2.bilateralFilter(sharpened, 5, 50, 50)
    
    return result


def create_id_card_pdf(front_image_path, back_image_path, output_pdf="身份证复印件.pdf"):
    """
    将身份证正反面图片生成为A4 PDF文件
    
    参数:
        front_image_path: 正面图片路径
        back_image_path: 反面图片路径
        output_pdf: 输出PDF文件名
    """
    # A4纸张尺寸 (210mm x 297mm)
    page_width, page_height = A4
    
    # 创建PDF
    c = canvas.Canvas(output_pdf, pagesize=A4)
    
    # 身份证标准尺寸 85.6mm x 54mm，放大到合适的打印尺寸
    card_width = 160 * mm  # 放大到160mm宽
    card_height = card_width / 1.586  # 保持标准比例
    
    # 计算居中位置
    x_center = (page_width - card_width) / 2
    
    # 正面放在上半部分
    y_front = page_height - 80 * mm - card_height
    
    # 反面放在下半部分
    y_back = 80 * mm
    
    # 添加正面图片
    if os.path.exists(front_image_path):
        c.drawImage(front_image_path, x_center, y_front, 
                   width=card_width, height=card_height, 
                   preserveAspectRatio=True)
        # 添加标注
        c.setFont("Helvetica", 10)
        c.drawString(x_center, y_front + card_height + 5 * mm, "身份证正面")
    
    # 添加反面图片
    if os.path.exists(back_image_path):
        c.drawImage(back_image_path, x_center, y_back, 
                   width=card_width, height=card_height, 
                   preserveAspectRatio=True)
        # 添加标注
        c.setFont("Helvetica", 10)
        c.drawString(x_center, y_back + card_height + 5 * mm, "身份证反面")
    
    # 保存PDF
    c.save()
    print(f"PDF已生成: {output_pdf}")
    return output_pdf


def process_and_generate_pdf(front_path, back_path, output_pdf="身份证复印件.pdf", 
                             enhance=True, debug=False):
    """
    完整流程：裁剪身份证 -> 增强图像 -> 生成PDF
    
    参数:
        front_path: 正面原始图片路径
        back_path: 反面原始图片路径
        output_pdf: 输出PDF文件名
        enhance: 是否进行图像增强
        debug: 是否输出调试信息
    """
    print("=" * 50)
    print("开始处理身份证图片并生成PDF")
    print("=" * 50)
    
    # 创建输出目录
    os.makedirs("output", exist_ok=True)
    
    # 处理正面
    print("\n[1/4] 处理身份证正面...")
    front_cropped = "output/front_cropped.jpg"
    try:
        crop_id_card(front_path, front_cropped, debug=debug)
        print("✓ 正面裁剪完成")
    except Exception as e:
        print(f"✗ 正面处理失败: {e}")
        return None
    
    # 处理反面
    print("\n[2/4] 处理身份证反面...")
    back_cropped = "output/back_cropped.jpg"
    try:
        crop_id_card(back_path, back_cropped, debug=debug)
        print("✓ 反面裁剪完成")
    except Exception as e:
        print(f"✗ 反面处理失败: {e}")
        return None
    
    # 图像增强
    if enhance:
        print("\n[3/4] 增强图像质量...")
        try:
            # 增强正面
            front_img = cv2.imread(front_cropped)
            front_enhanced = enhance_image_quality(front_img)
            front_final = "output/front_enhanced.jpg"
            cv2.imwrite(front_final, front_enhanced, [cv2.IMWRITE_JPEG_QUALITY, 95])
            
            # 增强反面
            back_img = cv2.imread(back_cropped)
            back_enhanced = enhance_image_quality(back_img)
            back_final = "output/back_enhanced.jpg"
            cv2.imwrite(back_final, back_enhanced, [cv2.IMWRITE_JPEG_QUALITY, 95])
            
            print("✓ 图像增强完成")
        except Exception as e:
            print(f"✗ 图像增强失败: {e}")
            front_final = front_cropped
            back_final = back_cropped
    else:
        front_final = front_cropped
        back_final = back_cropped
    
    # 生成PDF
    print("\n[4/4] 生成PDF文件...")
    try:
        pdf_path = os.path.join("output", output_pdf)
        create_id_card_pdf(front_final, back_final, pdf_path)
        print("✓ PDF生成完成")
        print(f"\n{'=' * 50}")
        print(f"成功！文件保存在: {pdf_path}")
        print(f"{'=' * 50}")
        return pdf_path
    except Exception as e:
        print(f"✗ PDF生成失败: {e}")
        return None


if __name__ == "__main__":
    # 完整流程示例
    process_and_generate_pdf(
        front_path="testdata/身份证正面.jpg",
        back_path="testdata/身份证反面.jpg",
        output_pdf="身份证复印件.pdf",
        enhance=True,
        debug=False
    )
