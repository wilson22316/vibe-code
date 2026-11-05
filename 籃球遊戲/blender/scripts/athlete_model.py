"""手繪動畫風運動員：模型、骨架、權重、球鞋、籃球。

座標：Blender Z 軸朝上、角色面向 -Y、原點在腳底。單位公尺。
用法：由 build_athlete.py 呼叫 build_model()，回傳 (body, rig, ball, off)。
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# 手繪動畫風配色（sRGB 色碼）。網頁端也用同一組名稱對應顏色。
PALETTE = {
    "Athlete_Skin": "#F3C9A6", "Athlete_Shirt": "#6AA79C", "Athlete_Shorts": "#47607A",
    "Athlete_Socks": "#F4EFE4", "Athlete_Shoes": "#D97B5C", "Athlete_Sole": "#F4EFE4",
    "Athlete_Hair": "#3D2B22", "Athlete_Eyes": "#2B201B", "Athlete_EyeWhite": "#FCF9F2",
    "Athlete_Mouth": "#C47D67", "Athlete_ShoeAccent": "#2F5D62", "Athlete_Laces": "#F7F3EA",
    "Ball_Leather": "#D9803F", "Ball_Seam": "#3A2A22",
}
BALL_R = 0.12
# 模型先以約 1.80 m 建好，匯出前由 build_athlete.py 整體縮到 TARGET_HEIGHT（籃球不縮）。
# 頭與脖子在縮放前調整，縮放後頭長約 24 cm、脖子正面露出約 5 cm。
TARGET_HEIGHT = 1.70
HEAD_SCALE = 1.030       # 頭放大倍數（以下巴為中心）
HEAD_DROP = 0.0112       # 頭往下移（公尺），縮短脖子


def _srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def make_materials():
    mats = {}
    for name, hexc in PALETTE.items():
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*[_srgb_to_lin(int(hexc[i:i + 2], 16) / 255) for i in (1, 3, 5)], 1)
        b.inputs["Roughness"].default_value = 0.55 if name in ("Athlete_Shoes", "Athlete_Eyes") else 0.75
        mats[name] = m
    return mats


def _select_only(objs, active):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def _join(parts, into):
    _select_only(list(parts) + [into], into)
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def _smooth(e0, e1, v):
    s = min(max((v - e0) / (e1 - e0), 0.0), 1.0)
    return s * s * (3 - 2 * s)


def _curve(u, pts):
    u = min(max(u, 0.0), 1.0)
    for (u0, v0), (u1, v1) in zip(pts, pts[1:]):
        if u0 <= u <= u1:
            s = (u - u0) / (u1 - u0)
            s = s * s * (3 - 2 * s)
            return v0 + (v1 - v0) * s
    return pts[-1][1]


def _table(z, tbl):
    if z <= tbl[0][0]:
        return tbl[0][1]
    for (z0, v0), (z1, v1) in zip(tbl, tbl[1:]):
        if z <= z1:
            return v0 + (v1 - v0) * (z - z0) / (z1 - z0)
    return tbl[-1][1]


def _tube_along_curve(bm, pts, radii, closed=False, n_sides=8, scale_yz=(1.0, 1.0)):
    """沿著 3D 點列 pts 建立平滑無扭轉的管狀網格。
    - 封閉球面曲線 (closed=True) 以球面外法線 p.normalized() 定向，徹底消除極點翻轉與首尾接縫凹陷。
    - 開放曲線 (closed=False) 使用平行傳輸 (Parallel Transport) 保持截面平滑連續不翻轉。
    """
    n = len(pts)
    if isinstance(radii, (int, float)):
        radii = [radii] * n
    sy, sz = scale_yz
    rings = []
    prev_b1 = None
    for i in range(n):
        p = pts[i]
        if closed:
            t = (pts[(i + 1) % n] - pts[(i - 1) % n]).normalized()
        elif i == 0:
            t = (pts[1] - pts[0]).normalized()
        elif i == n - 1:
            t = (pts[-1] - pts[-2]).normalized()
        else:
            t = (pts[i + 1] - pts[i - 1]).normalized()

        if closed and p.length > 1e-4:
            n_rad = p.normalized()
            b1 = t.cross(n_rad).normalized()
            b2 = t.cross(b1).normalized()
        else:
            if prev_b1 is None:
                up = Vector((0, 1, 0)) if abs(t.y) < 0.85 else Vector((0, 0, 1))
                b1 = t.cross(up).normalized()
            else:
                b1 = (prev_b1 - t * prev_b1.dot(t)).normalized()
            b2 = t.cross(b1).normalized()
            prev_b1 = b1

        r = radii[i]
        ring = []
        for j in range(n_sides):
            a = 2 * math.pi * j / n_sides
            off = b1 * (math.cos(a) * r * sy) + b2 * (math.sin(a) * r * sz)
            ring.append(bm.verts.new(p + off))
        rings.append(ring)
    seg_count = n if closed else n - 1
    for i in range(seg_count):
        r0, r1 = rings[i], rings[(i + 1) % n]
        for j in range(n_sides):
            bm.faces.new((r0[j], r0[(j + 1) % n_sides], r1[(j + 1) % n_sides], r1[j]))
    if not closed:
        bm.faces.new(list(reversed(rings[0])))
        bm.faces.new(rings[-1])


# ---------------------------------------------------------------- 身體
WRIST_X = 0.775
HAND_SCALE = 1.12

_TORSO_FRONT = [
    (0.80, 0.092), (0.90, 0.094), (1.00, 0.093), (1.10, 0.092),
    (1.20, 0.112), (1.31, 0.126), (1.40, 0.106), (1.48, 0.075),
]
_TORSO_BACK = [
    (0.80, 0.105), (0.88, 0.130), (0.96, 0.114), (1.06, 0.088),
    (1.16, 0.092), (1.30, 0.106), (1.40, 0.096), (1.48, 0.070),
]


def _shape_torso(me):
    """量出軀幹目前每個高度的前後厚度，再縮放到 _TORSO_FRONT／_TORSO_BACK 的輪廓。"""
    step, z0, nb = 0.02, 0.78, 37
    front, back = [0.0] * nb, [0.0] * nb
    for v in me.vertices:
        b = int((v.co.z - z0) / step)
        if 0 <= b < nb and abs(v.co.x) < 0.12:
            front[b] = max(front[b], -v.co.y)
            back[b] = max(back[b], v.co.y)

    def smooth3(a):
        a = list(a)
        for i in range(nb):
            if a[i] <= 0.02:
                a[i] = next((a[j] for d in range(1, nb) for j in (i - d, i + d) if 0 <= j < nb and a[j] > 0.02), 0.1)
        return [(a[max(i - 1, 0)] + a[i] + a[min(i + 1, nb - 1)]) / 3 for i in range(nb)]

    cur_front = [(z0 + (i + 0.5) * step, f) for i, f in enumerate(smooth3(front))]
    cur_back = [(z0 + (i + 0.5) * step, b) for i, b in enumerate(smooth3(back))]
    for v in me.vertices:
        z, ax = v.co.z, abs(v.co.x)
        w = _smooth(0.22, 0.11, ax) * _smooth(0.78, 0.84, z) * _smooth(1.50, 1.44, z)
        if w <= 0:
            continue
        cur, tbl = (_table(z, cur_front), _TORSO_FRONT) if v.co.y < 0 else (_table(z, cur_back), _TORSO_BACK)
        k = min(max(_table(z, tbl) / cur, 0.78), 1.5)
        v.co.y *= 1 + (k - 1) * w
        if v.co.y < -0.04 and 1.21 < z < 1.38 and 0.015 < ax < 0.135:
            pec = _smooth(1.21, 1.27, z) * _smooth(1.38, 1.31, z) * _smooth(0.015, 0.055, ax) * _smooth(0.135, 0.095, ax)
            v.co.y -= 0.0055 * pec


def _hand(x, y, z, s=1):
    """把左手、真人尺寸的手部座標放大 HAND_SCALE 倍，s = -1 時鏡像成右手。"""
    return ((WRIST_X + (x - WRIST_X) * HAND_SCALE) * s, y * HAND_SCALE, 1.42 + (z - 1.42) * HAND_SCALE)


_HAND_FLAT = [
    (0.0, 1.0), (0.70, 1.0), (WRIST_X, 0.78),
    (_hand(0.84, 0, 0)[0], 0.68), (_hand(0.885, 0, 0)[0], 1.0), (1.2, 1.0),
]

_FINGERS = [
    ((0.873, -0.025, 1.420), (1, 0, 0), 0.071, (0.45, 0.30, 0.25), (10, 20, 8), 0.0105, 0.0085),   # 食指
    ((0.877, -0.008, 1.420), (1, 0, 0), 0.079, (0.45, 0.30, 0.25), (14, 24, 10), 0.0108, 0.0088),  # 中指
    ((0.875, 0.009, 1.420), (1, 0, 0), 0.074, (0.45, 0.30, 0.25), (18, 28, 12), 0.0102, 0.0083),   # 無名指
    ((0.868, 0.025, 1.420), (1, 0, 0), 0.057, (0.45, 0.30, 0.25), (22, 32, 14), 0.0092, 0.0075),   # 小指
    ((0.810, -0.030, 1.414), (0.072, -0.020, -0.006), 0.075, (0.55, 0.45), (5, 15), 0.0135, 0.0095),  # 拇指
]


def _finger_points(root, direction, length, parts, bends, r0, r1, s):
    """沿手指方向逐節往掌心（-Z）彎，回傳 [(座標, 半徑), ...]，第一點是指根。s = 1 左手、-1 右手。"""
    pos = Vector(root)
    d = Vector(direction).normalized()
    pts = [(pos.copy(), r0)]
    done = 0.0
    for part, bend in zip(parts, bends):
        axis = d.cross(Vector((0, 0, -1))).normalized()
        d = Matrix.Rotation(math.radians(bend), 3, axis) @ d
        pos += d * (length * part)
        done += part
        pts.append((pos.copy(), r0 + (r1 - r0) * done))
    return [(_hand(*p, s), r * HAND_SCALE) for p, r in pts]


def _build_body(col, M):
    """以 Skin 修改器沿骨架點長出一體成形的身體，並雕塑肌肉線條與立體球衣／球褲／球襪版型。"""
    # 頸部使用自然平滑過渡的 Skin 節點深入頭顱（1.62），不強制夾角收縮，避免背面放大描邊在領口凹角穿出黑刺
    P = [
        ((0, 0, 0.94), 0.150),
        ((0, 0, 1.10), 0.134),
        ((0, 0, 1.33), 0.178),
        ((0, 0, 1.49), 0.052),
        ((0, 0, 1.62), 0.048),
    ]
    RY = {0: 0.130, 1: 0.116, 2: 0.150}
    E = [(0, 1), (1, 2), (2, 3), (3, 4)]
    for s in (1, -1):
        b = len(P)
        P += [
            ((0.19 * s, 0, 1.42), 0.075),
            ((0.35 * s, 0, 1.42), 0.060),
            ((0.52 * s, 0, 1.42), 0.046),
            ((0.60 * s, 0, 1.42), 0.048),
            ((WRIST_X * s, 0, 1.42), 0.032),
            (_hand(0.83, 0, 1.42, s), 0.040 * HAND_SCALE),
        ]
        sh, sl, el, fa, wr, pa = range(b, b + 6)
        E += [(2, sh), (sh, sl), (sl, el), (el, fa), (fa, wr), (wr, pa)]
        for finger in _FINGERS:
            k = len(P)
            pts = _finger_points(*finger, s)
            P += pts
            E += [(pa, k)] + [(k + i, k + i + 1) for i in range(len(pts) - 1)]
        b = len(P)
        P += [
            ((0.10 * s, 0, 0.88), 0.104),
            ((0.105 * s, 0, 0.62), 0.084),
            ((0.11 * s, 0, 0.47), 0.064),
            ((0.11 * s, 0.008, 0.35), 0.066),
            ((0.11 * s, 0.004, 0.20), 0.047),
            ((0.11 * s, 0.008, 0.10), 0.050),
            ((0.11 * s, 0.050, 0.050), 0.044),
            ((0.11 * s, -0.060, 0.048), 0.050),
            ((0.11 * s, -0.150, 0.042), 0.044),
        ]
        hp, hm, kn, ca, so, an, he, mi, to = range(b, b + 9)
        E += [(0, hp), (hp, hm), (hm, kn), (kn, ca), (ca, so), (so, an), (an, he), (an, mi), (mi, to)]

    me = bpy.data.meshes.new("Athlete")
    me.from_pydata([Vector(p[0]) for p in P], E, [])
    body = bpy.data.objects.new("Athlete", me)
    col.objects.link(body)
    _select_only([body], body)
    sk = body.modifiers.new("Skin", 'SKIN')
    sk.use_smooth_shade = True
    sv = me.skin_vertices[0].data
    for i, (_, r) in enumerate(P):
        sv[i].radius = (r, RY.get(i, r))
    sv[0].use_root = True
    sb = body.modifiers.new("Sub", 'SUBSURF')
    sb.levels = sb.render_levels = 2
    bpy.ops.object.modifier_apply(modifier="Skin")
    bpy.ops.object.modifier_apply(modifier="Sub")
    me = body.data
    minz = min(v.co.z for v in me.vertices)

    for v in me.vertices:
        ax = abs(v.co.x)
        if ax > 0.70:
            v.co.z = 1.42 + (v.co.z - 1.42) * _curve(ax, _HAND_FLAT)
        if v.co.z < minz + 0.012 and ax < 0.3:
            v.co.z = minz
        if v.co.z < 0.13 and v.co.y > 0.0 and ax < 0.3:
            v.co.y = min(v.co.y, 0.085)

        # 二頭肌／前臂肌群微雕塑
        if 0.34 < ax < 0.72 and 1.32 < v.co.z < 1.52:
            bicep = _smooth(0.35, 0.40, ax) * _smooth(0.49, 0.42, ax)
            forearm = _smooth(0.53, 0.59, ax) * _smooth(0.71, 0.62, ax)
            if v.co.y < 0:
                v.co.y -= 0.0035 * bicep + 0.0030 * forearm
            if v.co.z > 1.42:
                v.co.z += 0.0025 * bicep

        # 小腿肚（腓腸肌）往後與往外微膨
        if 0.16 < v.co.z < 0.52 and ax < 0.25:
            calf_w = _smooth(0.22, 0.34, v.co.z) * _smooth(0.46, 0.36, v.co.z)
            if v.co.y > 0:
                v.co.y += 0.011 * calf_w * _smooth(0.0, 0.04, v.co.y)
            sx = 1 if v.co.x >= 0 else -1
            dx = v.co.x - 0.11 * sx
            v.co.x += dx * 0.09 * calf_w

    _shape_torso(me)

    # 頸部與斜方肌自然過渡：頸部上段保持筆直自然，頸根帶有柔和斜方肌圓弧銜接進球衣領口
    for v in me.vertices:
        z, x, y = v.co.z, v.co.x, v.co.y
        ax = abs(x)
        if 1.488 < z < 1.63 and ax < 0.092:
            w_neck = _smooth(1.488, 1.512, z) * _smooth(0.092, 0.066, ax)
            if w_neck > 0:
                t_z = min(max((z - 1.50) / 0.08, 0.0), 1.0)
                base_flare = 0.010 * (_smooth(1.535, 1.490, z) ** 1.6)
                target_rx = 0.0510 - 0.0025 * t_z + base_flare
                target_ry = 0.0495 - 0.0020 * t_z + base_flare * 0.45
                r_norm = math.hypot(x / target_rx, y / target_ry)
                if r_norm > 0.25:
                    v.co.x = x + (x / r_norm - x) * w_neck
                    v.co.y = y + (y / r_norm - y) * w_neck

    # 所有幾何形變（上衣、球褲、球襪外推）皆在 bisect_plane 之前完成，確保切線處頂點與法線 100% 連續不扭曲
    collar_co = Vector((0.0, 0.0, 1.500))
    collar_no = Vector((0.0, -0.14, 1.0)).normalized()
    for v in me.vertices:
        z, x, y = v.co.z, v.co.x, v.co.y
        ax = abs(x)
        sx = 1 if x >= 0 else -1

        # 1. 上衣與袖子外推
        c_dist = (v.co - collar_co).dot(collar_no)
        if z >= 0.97 and c_dist <= 0.005 and ax <= 0.37:
            w_top = _smooth(0.005, -0.035, c_dist)
            w_bot = _smooth(0.97, 1.00, z)
            w_slv = _smooth(0.37, 0.34, ax)
            w_shirt = w_top * w_bot * w_slv
            if w_shirt > 0:
                if ax > 0.20 and z > 1.30:
                    dy, dz = y, z - 1.42
                    r = math.hypot(dy, dz)
                    if r > 1e-5:
                        cuff_flare = 0.0045 + 0.0038 * _smooth(0.24, 0.35, ax)
                        v.co.y += (dy / r) * cuff_flare * w_shirt
                        v.co.z += (dz / r) * cuff_flare * w_shirt
                else:
                    r = math.hypot(x, y)
                    if r > 1e-5:
                        ang = math.atan2(y, x)
                        hem_flare = 0.0040 + 0.0045 * _smooth(1.08, 0.99, z)
                        hem_fold = 0.0016 * math.cos(ang * 6) * _smooth(1.12, 0.99, z)
                        push = (hem_flare + hem_fold) * w_shirt
                        v.co.x += (x / r) * push
                        v.co.y += (y / r) * push

        # 2. 寬鬆籃球褲（z in [0.53, 0.99]）
        if 0.53 <= z <= 0.995 and ax < 0.28:
            w_s_bot = _smooth(0.535, 0.56, z)
            w_s_top = _smooth(0.995, 0.975, z)
            w_shorts = w_s_bot * w_s_top
            if w_shorts > 0:
                cx = 0.106 * sx * _smooth(0.92, 0.72, z)
                dx, dy = x - cx, y
                r = math.hypot(dx, dy)
                if r > 1e-5:
                    ang = math.atan2(dy, dx)
                    baggy = 0.0040 + 0.0120 * _smooth(0.92, 0.56, z)
                    fold = 0.0020 * math.cos(ang * 4) * _smooth(0.82, 0.56, z)
                    waistband = 0.0018 * _smooth(0.92, 0.97, z)
                    push = (baggy + fold + waistband) * w_shorts
                    inner_guard = _smooth(0.015, 0.065, ax) if (sx * dx < 0) else 1.0
                    v.co.x += (dx / r) * push * inner_guard
                    v.co.y += (dy / r) * push

        # 3. 中筒運動球襪（z in [0.09, 0.255]）
        if 0.09 <= z <= 0.255 and ax < 0.25:
            w_sock = _smooth(0.255, 0.240, z) * _smooth(0.09, 0.11, z)
            if w_sock > 0:
                cx = 0.11 * sx
                dx, dy = x - cx, y - 0.004
                r = math.hypot(dx, dy)
                if r > 1e-5:
                    cuff = 0.0032 + 0.0016 * _smooth(0.21, 0.240, z)
                    v.co.x += (dx / r) * cuff * w_sock
                    v.co.y += (dy / r) * cuff * w_sock

    # 在所有頂點塑形完成後，最後才切出乾淨的材質分界線，切面完全平直且不扭曲法線
    bm = bmesh.new()
    bm.from_mesh(me)
    for co, no in (
        (collar_co, collar_no),
        ((0, 0, 0.99), (0, 0, 1)),
        ((0, 0, 0.55), (0, 0, 1)),
        ((0, 0, 0.245), (0, 0, 1)),
        ((0.355, 0, 0), (1, 0, 0)),
        ((-0.355, 0, 0), (1, 0, 0)),
    ):
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()

    order = ["Athlete_Skin", "Athlete_Shirt", "Athlete_Shorts", "Athlete_Socks", "Athlete_Shoes", "Athlete_Sole"]
    for k in order:
        me.materials.append(M[k])
    idx = {k: i for i, k in enumerate(order)}
    for p in me.polygons:
        c = p.center
        ax = abs(c.x)
        if ax < 0.3 and c.z < minz + 0.026:
            k = "Athlete_Sole"
        elif ax < 0.3 and (c.z < 0.092 or (c.z < 0.14 and c.y < -0.05)):
            k = "Athlete_Shoes"
        elif ax < 0.25 and c.z < 0.245:
            k = "Athlete_Socks"
        elif ax > 0.355 or (ax < 0.095 and (c - collar_co).dot(collar_no) > 0):
            k = "Athlete_Skin"
        elif c.z > 0.99:
            k = "Athlete_Shirt"
        elif c.z > 0.55:
            k = "Athlete_Shorts"
        else:
            k = "Athlete_Skin"
        p.material_index = idx[k]
        p.use_smooth = True

    off = -minz
    for v in me.vertices:
        v.co.z += off
    return body, off


def _remove_feet(body):
    """刪掉原本的腳掌，換成獨立的球鞋。要在算完自動權重之後才刪，襪子下緣的權重才會自然。"""
    me = body.data
    names = [m.name for m in me.materials]
    kill = {names.index("Athlete_Shoes"), names.index("Athlete_Sole")}
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in kill], context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(me)
    bm.free()


# ---------------------------------------------------------------- 骨架
BONES = [  # 名稱, 頭, 尾, 父骨, 相連
    ("root", (0, 0, 0), (0, 0.25, 0), None, False),
    ("hips", (0, 0, 0.94), (0, 0, 1.10), "root", False),
    ("spine", (0, 0, 1.10), (0, 0, 1.33), "hips", True),
    ("chest", (0, 0, 1.33), (0, 0, 1.50), "spine", True),
    ("neck", (0, 0, 1.50), (0, 0, 1.57), "chest", True),
    ("head", (0, 0, 1.57), (0, 0, 1.82), "neck", True),
]
for _s, _x in ((1, ".L"), (-1, ".R")):
    BONES += [
        ("shoulder" + _x, (0.03 * _s, 0, 1.45), (0.19 * _s, 0, 1.42), "chest", False),
        ("upper_arm" + _x, (0.19 * _s, 0, 1.42), (0.52 * _s, 0.012, 1.42), "shoulder" + _x, True),
        ("forearm" + _x, (0.52 * _s, 0.012, 1.42), (0.775 * _s, 0, 1.42), "upper_arm" + _x, True),
        ("hand" + _x, (WRIST_X * _s, 0, 1.42), _hand(0.83, 0, 1.42, _s), "forearm" + _x, True),
        ("fingers" + _x, _hand(0.83, 0, 1.42, _s), _hand(0.956, -0.005, 1.42, _s), "hand" + _x, True),
        ("thumb" + _x, _hand(0.810, -0.030, 1.414, _s), _hand(0.882, -0.050, 1.408, _s), "hand" + _x, False),
        ("thigh" + _x, (0.10 * _s, 0, 0.88), (0.11 * _s, -0.012, 0.47), "hips", False),
        ("shin" + _x, (0.11 * _s, -0.012, 0.47), (0.11 * _s, 0.008, 0.10), "thigh" + _x, True),
        ("foot" + _x, (0.11 * _s, 0.008, 0.10), (0.11 * _s, -0.06, 0.048), "shin" + _x, True),
        ("toe" + _x, (0.11 * _s, -0.06, 0.048), (0.11 * _s, -0.15, 0.042), "foot" + _x, True),
    ]


def _build_rig(col, off):
    arm = bpy.data.armatures.new("AthleteRig")
    rig = bpy.data.objects.new("AthleteRig", arm)
    col.objects.link(rig)
    _select_only([rig], rig)
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.edit_bones
    for name, h, t, parent, connect in BONES:
        b = eb.new(name)
        b.head = Vector((h[0], h[1], h[2] + off))
        b.tail = Vector((t[0], t[1], t[2] + off))
        if parent:
            b.parent = eb[parent]
            b.use_connect = connect
        b.use_deform = name != "root"
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


# ---------------------------------------------------------------- 頭部與五官
def _head_shape(p, SX, SY, SZ):
    """單位球上的點 → 頭形（相對頭中心，公尺）。-y 是臉的方向。
    同時在臉部中央直接一體成形雕塑出立體鼻樑與鼻頭，避免獨立鼻子網格產生突兀的描邊黑鉤線。"""
    x, y, z = p
    t = max(0.0, -z)
    jaw_t = max(0.0, -z - 0.04)
    x *= 1.0 - 0.35 * (jaw_t ** 1.25) - 0.05 * (t ** 2)
    if y > 0:
        y *= 1.06 * (1 - 0.45 * t ** 1.55)
    if y < -0.53:
        y = -0.53 + (y + 0.53) * 0.53
    if y < 0:
        brow_bump = 0.022 * math.exp(-((z - 0.22) / 0.11) ** 2) * _smooth(0.75, 0.2, abs(x))
        chin_proj = 0.44 * max(0.0, t - 0.28) * _smooth(0.55, 0.15, abs(x))
        y *= 1.0 + brow_bump + chin_proj
    if z < -0.45:
        z = -0.45 + (z + 0.45) * (0.56 + 0.28 * max(0.0, y))
    res = Vector((x * SX, y * SY, z * SZ))
    # 一體成形的鼻樑與鼻頭：在臉部正中央往前 (-y) 自然隆起，寬度收斂於鼻樑內，不影響眼頭曲率
    if y < -0.4:
        nose_w = math.exp(-((res.x / 0.0080) ** 2))
        bridge = 0.0060 * math.exp(-(((res.z + 0.006) / 0.014) ** 2)) * nose_w
        tip = 0.0098 * math.exp(-(((res.z + 0.017) / 0.0090) ** 2)) * math.exp(-((res.x / 0.0092) ** 2))
        res.y -= (bridge + tip)
    return res


def _bang_wave(x):
    """前額瀏海的 5 束自然分束波形（-1 ~ +1）。"""
    return 0.65 * math.sin(x * 16.0 + 0.35) + 0.35 * math.cos(x * 26.0 - 0.4)


def _hairline(n):
    """單位球方向 n 的髮際高度（n.z 低於它就沒有頭髮）。耳朵周圍留出充足空間讓外耳廓清楚露出。"""
    front = _smooth(-0.35, 0.45, -n.y)
    zh = -0.56 + (0.44 + 0.08 * abs(n.x) - (-0.56)) * front
    zh += 0.032 * _bang_wave(n.x) * _smooth(0.25, 0.72, -n.y) * _smooth(0.75, 0.35, abs(n.x))
    sideburn = _smooth(0.62, 0.82, abs(n.x)) * math.exp(-((-n.y - 0.28) / 0.09) ** 2)
    zh -= 0.13 * sideburn
    ear = ((-n.y + 0.02) / 0.32) ** 2 + ((n.z + 0.02) / 0.32) ** 2
    w = _smooth(1.85, 0.75, ear) * _smooth(0.42, 0.65, abs(n.x))
    return zh + (max(zh, 0.32) - zh) * w


def _build_head(col, M, off):
    """頭、清晰立體五官（濃密眉毛、上下眼瞼、雙高光大眼、手繪鼻線、微笑嘴型、外展耳廓與內耳線）、立體短髮。"""
    HC = Vector((0, 0.0, 1.652 + off))
    SX, SY, SZ = 0.096, 0.112, 0.124
    parts = []

    def new_obj(name, bm, material, fix_normals=True):
        if fix_normals:
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        m = bpy.data.meshes.new(name)
        bm.to_mesh(m)
        bm.free()
        for p in m.polygons:
            p.use_smooth = True
        m.materials.append(material)
        o = bpy.data.objects.new(name, m)
        col.objects.link(o)
        parts.append(o)
        return o

    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=72, v_segments=48, radius=1.0)
    for v in bm.verts:
        v.co = _head_shape(v.co, SX, SY, SZ) + HC
    head = new_obj("Head", bm, M["Athlete_Skin"])
    from mathutils.bvhtree import BVHTree
    head_verts = [v.co.copy() for v in head.data.vertices]
    head_polys = [tuple(p.vertices) for p in head.data.polygons]
    head_bvh = BVHTree.FromPolygons(head_verts, head_polys)

    def face_y_at(x, z):
        loc, _, _, _ = head_bvh.ray_cast(Vector((x, -0.5, z)), Vector((0.0, 1.0, 0.0)))
        if loc is not None:
            return loc.y
        pts = [c.y for c in head_verts if c.y < 0 and abs(c.x - x) < 0.015 and abs(c.z - z) < 0.015]
        return min(pts) if pts else -0.085

    # 1. 手繪動畫風鼻樑與鼻底勾勒線（NoseShade，使用 Athlete_Eyes 深棕墨線色，一筆連貫勾出鼻翼側線與鼻頭下緣）
    nz_tip = HC.z - 0.017
    bm = bmesh.new()
    n_pts_raw = [
        (-0.0028, nz_tip + 0.0075, 0.0005),
        (-0.0038, nz_tip + 0.0015, 0.0009),
        (-0.0042, nz_tip - 0.0028, 0.0012),
        (-0.0028, nz_tip - 0.0056, 0.0014),
        (0.0000, nz_tip - 0.0063, 0.0015),
        (0.0032, nz_tip - 0.0054, 0.0012),
        (0.0052, nz_tip - 0.0038, 0.0006),
    ]
    n_pts = [Vector((nx, face_y_at(nx, nz) - 0.0016, nz)) for nx, nz, _ in n_pts_raw]
    n_rad = [nr for _, _, nr in n_pts_raw]
    _tube_along_curve(bm, n_pts, n_rad, closed=False, n_sides=8)
    new_obj("NoseShade", bm, M["Athlete_Eyes"])

    # 2. 醒目外展的立體耳廓（Ear）＋ 清楚浮在耳窩前表面的內耳輪廓線（EarInner）
    for s in (1, -1):
        ear_base = Vector((s * (SX * 0.96 + 0.0055), -0.007, HC.z - 0.007))
        rot_ear = Matrix.Rotation(math.radians(-24 * s), 3, 'Z') @ Matrix.Rotation(math.radians(9 * s), 3, 'Y')
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
        for v in bm.verts:
            vx, vy, vz = v.co.x, v.co.y, v.co.z
            lobe = 1.05 - 0.24 * _smooth(0.3, -0.9, vz)
            helix = 1.15 if (vx * s > 0.15 and vz > -0.35) else 1.0
            # 耳朵正面（vy < 0）中央微凹成耳窩
            concha_dip = 0.0045 * max(0.0, 1.0 - ((vx / 0.72) ** 2 + (vz / 0.72) ** 2)) if vy < 0 else 0.0
            p = Vector((vx * 0.0142 * helix, vy * 0.0140 * lobe + concha_dip, vz * 0.0285))
            v.co = (rot_ear @ p) + ear_base
        new_obj(f"Ear{s}", bm, M["Athlete_Skin"])

        # 內耳輪廓線（EarInner）：深色手繪耳輪內線浮在耳窩正前方，正面與側面皆清晰可見
        bm = bmesh.new()
        e_pts, e_rad = [], []
        for k in range(13):
            u_e = k / 12
            ang = math.radians(-70 + u_e * 205)
            lp = Vector((s * (0.0014 + 0.0062 * math.sin(ang)), -0.0152, 0.0145 * math.cos(ang) + 0.002))
            e_pts.append((rot_ear @ lp) + ear_base)
            e_rad.append(0.0015 * (math.sin(math.pi * u_e) ** 0.45) + 0.0004)
        _tube_along_curve(bm, e_pts, e_rad, closed=False, n_sides=8)
        new_obj(f"EarInner{s}", bm, M["Athlete_Eyes"])

    # 3. 眼睛（每個頂點皆透過 BVHTree 精準貼合臉部表面曲率，徹底解決眼頭近鼻處凹陷被臉皮吃掉的問題）
    ez = HC.z + 0.008
    for s in (1, -1):
        ex = 0.0345 * s
        ew_rx, ew_rz = 0.0168, 0.0110

        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=18, radius=1.0)
        for v in bm.verts:
            ux, uy, uz = v.co.x, v.co.y, v.co.z
            vx = ex + ux * ew_rx
            vz = ez + uz * ew_rz
            surf_y = face_y_at(vx, vz)
            # uy < 0 為眼球正面，整顆眼白邊緣 (uy=0) 均勻浮出臉部表面 1.6mm，中央微凸 5.0mm
            vy = surf_y - 0.0016 + uy * 0.0034
            v.co = Vector((vx, vy, vz))
        new_obj(f"EyeW{s}", bm, M["Athlete_EyeWhite"])

        px0, pz0 = ex - 0.0012 * s, ez + 0.0002
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=16, radius=1.0)
        for v in bm.verts:
            ux, uy, uz = v.co.x, v.co.y, v.co.z
            vx = px0 + ux * 0.0095
            vz = pz0 + uz * 0.0100
            surf_y = face_y_at(vx, vz)
            ux_e = (vx - ex) / ew_rx
            uz_e = (vz - ez) / ew_rz
            uy_front = -math.sqrt(max(0.0, 1.0 - min(1.0, ux_e * ux_e + uz_e * uz_e)))
            ew_front_y = surf_y - 0.0016 + uy_front * 0.0034
            vy = ew_front_y - 0.0008 + uy * 0.0016
            v.co = Vector((vx, vy, vz))
        new_obj(f"Pupil{s}", bm, M["Athlete_Eyes"])

        for g_idx, (gx, gz, gr) in enumerate(((0.0032, 0.0036, 0.0025), (-0.0026, -0.0032, 0.0014))):
            bm = bmesh.new()
            bmesh.ops.create_icosphere(bm, subdivisions=2, radius=gr)
            gvx, gvz = px0 + gx, pz0 + gz
            gsurf_y = face_y_at(gvx, gvz)
            for v in bm.verts:
                v.co.y *= 0.35
            bmesh.ops.translate(bm, vec=Vector((gvx, gsurf_y - 0.0066, gvz)), verts=bm.verts)
            new_obj(f"Glint{s}_{g_idx}", bm, M["Athlete_EyeWhite"])

        bm = bmesh.new()
        lid_pts, lid_rad = [], []
        for i in range(19):
            u = i / 18
            ang_u = (u - 0.5) * math.pi * 0.92
            vx = ex + math.sin(ang_u) * 0.0178 * s
            vz = ez + math.cos(ang_u) * 0.0108 + 0.0010 - 0.0012 * u
            vy = face_y_at(vx, vz) - 0.0030
            lid_pts.append(Vector((vx, vy, vz)))
            lid_rad.append(0.0025 * (math.sin(math.pi * u) ** 0.55) * (0.85 + 0.35 * u) + 0.0006)
        _tube_along_curve(bm, lid_pts, lid_rad, closed=False, n_sides=8, scale_yz=(1.25, 1.0))
        new_obj(f"Eyelid{s}", bm, M["Athlete_Eyes"])

        bm = bmesh.new()
        ll_pts, ll_rad = [], []
        for i in range(13):
            u = i / 12
            ang_u = (-0.18 + u * 0.68) * math.pi * 0.72
            vx = ex + math.sin(ang_u) * 0.0160 * s
            vz = ez - math.cos(ang_u) * 0.0108 - 0.0003
            vy = face_y_at(vx, vz) - 0.0024
            ll_pts.append(Vector((vx, vy, vz)))
            ll_rad.append(0.0011 * math.sin(math.pi * u) + 0.0002)
        _tube_along_curve(bm, ll_pts, ll_rad, closed=False, n_sides=6)
        new_obj(f"LowerLid{s}", bm, M["Athlete_Eyes"])

        # 濃密清晰的立體眉毛（Brow，使用 Athlete_Eyes 深色且不套用粗外框，徹底消除條紋感）
        bz = ez + 0.022
        bm = bmesh.new()
        br_pts, br_rad = [], []
        for i in range(19):
            u = i / 18
            bx = (0.013 + u * 0.037) * s
            arch = 0.0034 * math.sin(math.pi * (u ** 0.80)) + 0.0014 * u
            cur_z = bz + arch
            cur_y = face_y_at(bx, cur_z) - 0.0030
            br_pts.append(Vector((bx, cur_y, cur_z)))
            taper = (math.sin(math.pi * min(max(u * 0.88 + 0.08, 0.08), 0.98)) ** 0.45) * (1.18 - 0.36 * u)
            br_rad.append(0.0038 * taper)
        _tube_along_curve(bm, br_pts, br_rad, closed=False, n_sides=10, scale_yz=(0.80, 1.25))
        new_obj(f"Brow{s}", bm, M["Athlete_Eyes"])

    # 4. 清晰陽光微笑嘴線（Mouth）
    mz = HC.z - 0.052
    bm = bmesh.new()
    m_pts, m_rad = [], []
    for i in range(19):
        u = i / 18
        s_u = (u - 0.5) * 2.0
        mx = s_u * 0.020
        mz_cur = mz + 0.0024 * (s_u ** 2)
        my_cur = face_y_at(mx, mz_cur) - 0.0026
        m_pts.append(Vector((mx, my_cur, mz_cur)))
        taper = math.sqrt(max(0.08, 1.0 - (s_u ** 2) * 0.92))
        m_rad.append(0.0024 * taper)
    _tube_along_curve(bm, m_pts, m_rad, closed=False, n_sides=8)
    new_obj("Mouth", bm, M["Athlete_Mouth"])

    # 5. 一體成形立體層次運動短髮
    U, V = 120, 32

    def unit(th, ph):
        return Vector((math.sin(th) * math.cos(ph), math.sin(th) * math.sin(ph), math.cos(th)))

    def above(th, ph):
        n = unit(th, ph)
        return n.z - _hairline(n)

    def thickness(n):
        base_t = 0.006 + 0.018 * _smooth(-0.35, 0.85, n.z) + 0.008 * _smooth(0.05, 0.75, -n.y) * _smooth(0.15, 0.70, n.z)
        whorl_ang = math.atan2(n.y - 0.25, n.x)
        crown_locks = (0.0028 * math.sin(whorl_ang * 10) + 0.0016 * math.cos(whorl_ang * 17)) * _smooth(-0.1, 0.55, n.z) * _smooth(0.02, 0.18, math.hypot(n.x, n.y - 0.25))
        fringe_loft = 0.0038 * (0.5 - 0.5 * _bang_wave(n.x)) * _smooth(0.20, 0.70, -n.y) * _smooth(0.85, 0.35, n.z)
        t = base_t + crown_locks + fringe_loft
        return 0.0018 + (t - 0.0018) * _smooth(0.0, 0.08, n.z - _hairline(n))

    bm = bmesh.new()
    rings = []
    for i in range(U):
        ph = 2 * math.pi * i / U
        th = 0.0
        while th < math.pi - 0.01 and above(th + 0.01, ph) > 0:
            th += 0.01
        lo, hi = th, th + 0.01
        for _ in range(20):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if above(mid, ph) > 0 else (lo, mid)
        col_ = []
        for k, t in enumerate([lo + 0.05] + [lo * (1 - j / V) for j in range(V)]):
            n = unit(t, ph)
            base = _head_shape(n, SX, SY, SZ)
            out = -0.005 if k == 0 else thickness(n)
            col_.append(bm.verts.new(HC + base + base.normalized() * out))
        rings.append(col_)
    pole_n = Vector((0, 0, 1))
    pole = bm.verts.new(HC + _head_shape(pole_n, SX, SY, SZ) + Vector((0, 0, thickness(pole_n))))
    for i in range(U):
        a, b = rings[i], rings[(i + 1) % U]
        for k in range(V):
            bm.faces.new((a[k], b[k], b[k + 1], a[k + 1]))
        bm.faces.new((a[V], b[V], pole))

    f0 = next(iter(bm.faces))
    if f0.normal.dot(f0.calc_center_median() - HC) < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    new_obj("Hair", bm, M["Athlete_Hair"], fix_normals=False)
    # 整顆頭（含五官、頭髮）以下巴為中心放大，再整體往下移、縮短脖子露出的長度
    pivot = Vector((0, 0, min(v.co.z for v in parts[0].data.vertices)))
    for o in parts:
        for v in o.data.vertices:
            v.co = pivot + (v.co - pivot) * HEAD_SCALE - Vector((0, 0, HEAD_DROP))
    for o in parts:
        g = o.vertex_groups.new(name="head")
        g.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    return parts


# ---------------------------------------------------------------- 球鞋
_HALF_W = [(0.0, 0.042), (0.08, 0.056), (0.35, 0.057), (0.70, 0.061), (0.90, 0.053), (1.0, 0.034)]
_TOP = [(0.0, 0.095), (0.07, 0.120), (0.28, 0.116), (0.40, 0.112), (0.55, 0.096), (0.72, 0.082), (0.88, 0.066), (1.0, 0.045)]
_BOT = [(0.0, 0.010), (0.06, 0.0), (0.80, 0.0), (0.93, 0.008), (1.0, 0.022)]
Y_HEEL, Y_TOE = 0.100, -0.205


def _foot_weights(o, sfx):
    """鞋子前段跟著 toe 骨頭彎，其餘跟著 foot。"""
    gf = o.vertex_groups.new(name="foot" + sfx)
    gt = o.vertex_groups.new(name="toe" + sfx)
    for v in o.data.vertices:
        u = (v.co.y - Y_HEEL) / (Y_TOE - Y_HEEL)
        t = min(max((u - 0.62) / 0.13, 0.0), 1.0)
        t = t * t * (3 - 2 * t)
        if t < 1:
            gf.add([v.index], 1 - t, 'REPLACE')
        if t > 0:
            gt.add([v.index], t, 'REPLACE')


def _build_shoes(col, M, off):
    """原創籃球鞋：含泡棉腳踝領圈、高聳立體鞋舌、沿網格邊界平滑切分的撞色護片、5 組弧形鞋帶與緩震鞋底。"""
    parts = []
    NU, NT = 32, 32
    for s, sfx in ((1, ".L"), (-1, ".R")):
        cx0 = 0.11 * s
        bm = bmesh.new()
        rings = []
        for i in range(NU + 1):
            u = i / NU
            y = Y_HEEL + (Y_TOE - Y_HEEL) * u
            w, zt, zb = _curve(u, _HALF_W), _curve(u, _TOP), _curve(u, _BOT)
            cx = cx0 - s * 0.010 * max(0.0, u - 0.5)
            zc, h = (zt + zb) / 2, (zt - zb) / 2
            ring = []
            for j in range(NT):
                a = 2 * math.pi * j / NT
                c, sn = math.cos(a), math.sin(a)
                px = math.copysign(abs(c) ** (2 / 3.2), c)
                pz = math.copysign(abs(sn) ** (2 / 3.2), sn)
                wx = w * (1.06 if sn < -0.5 else 1.0)
                vx = cx + px * wx
                vz = zc + pz * h
                if sn > 0.35:
                    collar_bump = 0.005 * _smooth(0.03, 0.12, u) * _smooth(0.40, 0.28, u) * _smooth(0.35, 0.75, sn)
                    tongue_lift = 0.016 * math.exp(-((u - 0.39) / 0.065) ** 2) * _smooth(0.55, 0.92, sn)
                    vz += collar_bump + tongue_lift
                    vx += c * collar_bump * 0.8
                ring.append(bm.verts.new((vx, y, vz + off)))
            rings.append(ring)
        for i in range(NU):
            for j in range(NT):
                a_mid = 2 * math.pi * (j + 0.5) / NT
                sn_m = math.sin(a_mid)
                f = bm.faces.new((rings[i][j], rings[i][(j + 1) % NT], rings[i + 1][(j + 1) % NT], rings[i + 1][j]))
                heel_tab = i < 5 and sn_m > -0.25
                collar_rim = i < 12 and sn_m > 0.65
                f.material_index = 1 if (heel_tab or collar_rim) else 0
                f.smooth = True
        f = bm.faces.new(list(reversed(rings[0])))
        f.material_index = 1
        f.smooth = True
        f = bm.faces.new(rings[-1])
        f.smooth = True
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        sm = bpy.data.meshes.new("Shoe" + sfx)
        bm.to_mesh(sm)
        bm.free()
        sm.materials.append(M["Athlete_Shoes"])
        sm.materials.append(M["Athlete_ShoeAccent"])
        so = bpy.data.objects.new("Shoe" + sfx, sm)
        col.objects.link(so)
        parts.append((so, sfx))

        for k, u in enumerate((0.44, 0.51, 0.58, 0.65, 0.72)):
            y = Y_HEEL + (Y_TOE - Y_HEEL) * u
            cx = cx0 - s * 0.010 * max(0.0, u - 0.5)
            zt = _curve(u, _TOP) + (0.016 * math.exp(-((u - 0.39) / 0.065) ** 2))
            w_lace = _curve(u, _HALF_W) * 0.62
            bm = bmesh.new()
            lu, lv = 10, 6
            l_rings = []
            for iu in range(lu + 1):
                t_l = (iu / lu - 0.5) * 2.0
                lx = cx + t_l * w_lace
                lz = zt - 0.0052 * (t_l ** 2) + 0.0016 + off
                ly = y + 0.0022 * t_l * (1 if k % 2 == 0 else -1)
                ring = []
                for iv in range(lv):
                    a = 2 * math.pi * iv / lv
                    ring.append(bm.verts.new((lx, ly + math.cos(a) * 0.0040, lz + math.sin(a) * 0.0024)))
                l_rings.append(ring)
            for iu in range(lu):
                for iv in range(lv):
                    bm.faces.new((l_rings[iu][iv], l_rings[iu][(iv + 1) % lv], l_rings[iu + 1][(iv + 1) % lv], l_rings[iu + 1][iv]))
            bm.faces.new(list(reversed(l_rings[0])))
            bm.faces.new(l_rings[-1])
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            lm = bpy.data.meshes.new(f"Lace{sfx}{k}")
            bm.to_mesh(lm)
            bm.free()
            for p in lm.polygons:
                p.use_smooth = True
            lm.materials.append(M["Athlete_Laces"])
            lo = bpy.data.objects.new(f"Lace{sfx}{k}", lm)
            col.objects.link(lo)
            parts.append((lo, sfx))

        pad, wf, outline = 0.0045, 1.06, []
        us = [i / 32 for i in range(33)]
        for u in us:
            arch_in = -0.0035 * math.exp(-((u - 0.42) / 0.14) ** 2)
            outrigger = 0.0035 * math.exp(-((u - 0.72) / 0.12) ** 2)
            outline.append((cx0 - s * 0.010 * max(0.0, u - 0.5) + _curve(u, _HALF_W) * wf + pad + (outrigger if s > 0 else arch_in), u))
        for k in range(1, 6):
            a = math.pi * k / 6
            outline.append((cx0 - s * 0.005 + (_curve(1.0, _HALF_W) * wf + pad) * math.cos(a), 1.0 + 0.022 * math.sin(a)))
        for u in reversed(us):
            arch_in = -0.0035 * math.exp(-((u - 0.42) / 0.14) ** 2)
            outrigger = 0.0035 * math.exp(-((u - 0.72) / 0.12) ** 2)
            outline.append((cx0 - s * 0.010 * max(0.0, u - 0.5) - _curve(u, _HALF_W) * wf - pad - (arch_in if s > 0 else outrigger), u))
        for k in range(1, 6):
            a = math.pi + math.pi * k / 6
            outline.append((cx0 + (_curve(0.0, _HALF_W) * wf + pad) * math.cos(a), -0.028 * abs(math.sin(a))))
        bm = bmesh.new()
        bottom, top = [], []
        for x, u in outline:
            y = Y_HEEL + (Y_TOE - Y_HEEL) * u
            zb = _curve(u, _BOT) - 0.001
            sole_h = 0.034 - 0.006 * _smooth(0.15, 0.75, u) + 0.005 * _smooth(0.88, 1.02, u)
            bottom.append(bm.verts.new((x, y, zb + off)))
            top.append(bm.verts.new((x, y, zb + sole_h + off)))
        n = len(outline)
        for i in range(n):
            bm.faces.new((bottom[i], bottom[(i + 1) % n], top[(i + 1) % n], top[i]))
        bm.faces.new(list(reversed(bottom)))
        bm.faces.new(top)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        rim = [e for e in bm.edges if len(e.link_faces) == 2
               and any(len(f.verts) > 4 for f in e.link_faces) and e.verts[0].co.z < off + 0.02]
        bmesh.ops.bevel(bm, geom=rim, offset=0.008, segments=3, affect='EDGES', clamp_overlap=True)
        for f in bm.faces:
            f.smooth = True
        sol = bpy.data.meshes.new("Sole" + sfx)
        bm.to_mesh(sol)
        bm.free()
        sol.materials.append(M["Athlete_Sole"])
        sole = bpy.data.objects.new("Sole" + sfx, sol)
        col.objects.link(sole)
        parts.append((sole, sfx))
    for o, sfx in parts:
        _foot_weights(o, sfx)
    return [o for o, _ in parts]


# ---------------------------------------------------------------- 籃球（標準 8 片式真實籃球紋路）
def _build_ball(col, M):
    """建立真實 8 片式籃球：
    1. 水平赤道大圓環線 (z = 0)
    2. 垂直子午線大圓環線 (x = 0)，與赤道交於前後極點 (0, +/-R, 0)
    3. 左右兩半球 (x > 0 與 x < 0) 各一條經典馬鞍／花生形曲線，只在赤道與水平線相交，完美構成真實 8 片式籃球版型！
    """
    N_SEAM = 96
    R_SEAM = BALL_R - 0.0008                                 # 膠條中心微嵌入球面，使膠條平整貼合球皮無縫隙
    curves = [
        # 1. 水平大圓環線 (z = 0)
        [Vector((R_SEAM * math.cos(2 * math.pi * i / N_SEAM), R_SEAM * math.sin(2 * math.pi * i / N_SEAM), 0.0)) for i in range(N_SEAM)],
        # 2. 垂直大圓環線 (x = 0)
        [Vector((0.0, R_SEAM * math.cos(2 * math.pi * i / N_SEAM), R_SEAM * math.sin(2 * math.pi * i / N_SEAM))) for i in range(N_SEAM)],
    ]
    # 3. 左右兩側 (+X / -X 半球) 經典 8 片式籃球馬鞍曲線
    for s in (1, -1):
        side_pts = []
        for i in range(N_SEAM):
            t = 2 * math.pi * i / N_SEAM
            # 在赤道 (t = 0, pi) 收窄為約 33 度避免碰觸 (0, +/-R, 0) 極點；在頂底 (t = pi/2, 3pi/2) 展寬至約 65 度貼近 x=0 主縫線
            alpha = 0.86 - 0.28 * math.cos(2 * t)
            sa, ca = math.sin(alpha), math.cos(alpha)
            side_pts.append(Vector((s * R_SEAM * ca, R_SEAM * sa * math.cos(t), R_SEAM * sa * math.sin(t))))
        curves.append(side_pts)

    bm_ball = bmesh.new()
    bmesh.ops.create_uvsphere(bm_ball, u_segments=48, v_segments=24, radius=BALL_R)
    bmesh.ops.recalc_face_normals(bm_ball, faces=bm_ball.faces)
    me_ball = bpy.data.meshes.new("Ball")
    bm_ball.to_mesh(me_ball)
    bm_ball.free()
    for p in me_ball.polygons:
        p.use_smooth = True
    me_ball.materials.append(M["Ball_Leather"])
    ball = bpy.data.objects.new("Ball", me_ball)
    col.objects.link(ball)

    bm_seam = bmesh.new()
    for pts in curves:
        _tube_along_curve(bm_seam, pts, radii=0.0032, closed=True, n_sides=8)
    bmesh.ops.recalc_face_normals(bm_seam, faces=bm_seam.faces)
    me_seam = bpy.data.meshes.new("BallSeam")
    bm_seam.to_mesh(me_seam)
    bm_seam.free()
    for p in me_seam.polygons:
        p.use_smooth = True
    me_seam.materials.append(M["Ball_Seam"])
    seam_obj = bpy.data.objects.new("BallSeam", me_seam)
    col.objects.link(seam_obj)

    ball = _join([seam_obj], ball)
    ball.name = "Ball"
    return ball


# ---------------------------------------------------------------- 主流程
def build_model(collection_name="Athlete"):
    col = bpy.data.collections.new(collection_name)
    bpy.context.scene.collection.children.link(col)
    bpy.context.view_layer.active_layer_collection = bpy.context.view_layer.layer_collection.children[col.name]
    M = make_materials()
    body, off = _build_body(col, M)
    rig = _build_rig(col, off)
    _select_only([body, rig], rig)
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')        # 自動權重
    _remove_feet(body)
    head_parts = _build_head(col, M, off)
    body = _join(head_parts, body)
    shoe_parts = _build_shoes(col, M, off)
    body = _join(shoe_parts, body)
    body.name = "Athlete"
    ball = _build_ball(col, M)
    return body, rig, ball, off
