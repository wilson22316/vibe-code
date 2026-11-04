"""手繪動畫風運動員：模型、骨架、權重、球鞋、籃球。

座標：Blender Z 軸朝上、角色面向 -Y、原點在腳底。單位公尺。
用法：由 build_athlete.py 呼叫 build_model()，回傳 (body, rig, ball)。
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


def _srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def make_materials():
    mats = {}
    for name, hexc in PALETTE.items():
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*[_srgb_to_lin(int(hexc[i:i + 2], 16) / 255) for i in (1, 3, 5)], 1)
        b.inputs["Roughness"].default_value = 0.6 if name in ("Athlete_Shoes", "Athlete_Eyes") else 0.75
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


# ---------------------------------------------------------------- 身體
def _build_body(col, M):
    """以 Skin 修改器沿骨架點長出一體成形的身體（含原本的腳，稍後刪除換成球鞋）。"""
    P = [((0, 0, 0.94), 0.150), ((0, 0, 1.10), 0.138), ((0, 0, 1.33), 0.175), ((0, 0, 1.50), 0.054), ((0, 0, 1.57), 0.050)]
    RY = {0: 0.105, 1: 0.098, 2: 0.112}
    E = [(0, 1), (1, 2), (2, 3), (3, 4)]
    for s in (1, -1):
        b = len(P)
        P += [((0.19 * s, 0, 1.42), 0.072), ((0.33 * s, 0, 1.42), 0.060), ((0.46 * s, 0, 1.42), 0.051),
              ((0.69 * s, 0, 1.42), 0.036), ((0.745 * s, 0, 1.42), 0.034),
              ((0.785 * s, -0.021, 1.42), 0.0105), ((0.845 * s, -0.023, 1.42), 0.0090),
              ((0.788 * s, -0.007, 1.42), 0.0105), ((0.857 * s, -0.007, 1.42), 0.0090),
              ((0.786 * s, 0.007, 1.42), 0.0100), ((0.850 * s, 0.008, 1.42), 0.0086),
              ((0.780 * s, 0.020, 1.42), 0.0095), ((0.832 * s, 0.022, 1.42), 0.0080),
              ((0.735 * s, -0.030, 1.416), 0.0130), ((0.785 * s, -0.058, 1.412), 0.0100),
              ((0.10 * s, 0, 0.88), 0.101), ((0.105 * s, 0, 0.62), 0.083), ((0.11 * s, 0, 0.47), 0.066),
              ((0.11 * s, 0, 0.22), 0.050), ((0.11 * s, 0.008, 0.10), 0.052),
              ((0.11 * s, 0.050, 0.050), 0.044), ((0.11 * s, -0.060, 0.048), 0.050), ((0.11 * s, -0.150, 0.042), 0.044)]
        sh, sl, el, wr, pa, i0, i1, m0, m1, r0, r1, p0, p1, t0, t1, hp, hm, kn, so, an, he, mi, to = range(b, b + 23)
        E += [(2, sh), (sh, sl), (sl, el), (el, wr), (wr, pa), (pa, i0), (i0, i1), (pa, m0), (m0, m1), (pa, r0), (r0, r1),
              (pa, p0), (p0, p1), (pa, t0), (t0, t1), (0, hp), (hp, hm), (hm, kn), (kn, so), (so, an), (an, he), (an, mi), (mi, to)]
    me = bpy.data.meshes.new("Athlete")
    me.from_pydata([Vector(p[0]) for p in P], E, [])
    body = bpy.data.objects.new("Athlete", me)
    col.objects.link(body)
    _select_only([body], body)
    sk = body.modifiers.new("Skin", 'SKIN')
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.6
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
        if abs(v.co.x) > 0.70:                                   # 手掌壓扁
            v.co.z = 1.42 + (v.co.z - 1.42) * 0.62
        if v.co.z < minz + 0.012 and abs(v.co.x) < 0.3:
            v.co.z = minz
        if v.co.z < 0.13 and v.co.y > 0.0 and abs(v.co.x) < 0.3:
            v.co.y = min(v.co.y, 0.085)
    order = ["Athlete_Skin", "Athlete_Shirt", "Athlete_Shorts", "Athlete_Socks", "Athlete_Shoes", "Athlete_Sole"]
    for k in order:
        me.materials.append(M[k])
    idx = {k: i for i, k in enumerate(order)}
    for p in me.polygons:
        c = p.center
        ax = abs(c.x)
        if ax < 0.3 and c.z < minz + 0.026:
            k = "Athlete_Sole"
        elif ax < 0.3 and c.z < 0.092:
            k = "Athlete_Shoes"
        elif ax < 0.25 and c.z < 0.22:
            k = "Athlete_Socks"
        elif ax > 0.33 or c.z > 1.49:
            k = "Athlete_Skin"
        elif c.z > 1.00:
            k = "Athlete_Shirt"
        elif c.z > 0.62:
            k = "Athlete_Shorts"
        else:
            k = "Athlete_Skin"
        p.material_index = idx[k]
        p.use_smooth = True
    off = -minz                                                  # 讓腳底貼齊地面
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
        ("upper_arm" + _x, (0.19 * _s, 0, 1.42), (0.46 * _s, 0.012, 1.42), "shoulder" + _x, True),
        ("forearm" + _x, (0.46 * _s, 0.012, 1.42), (0.69 * _s, 0, 1.42), "upper_arm" + _x, True),
        ("hand" + _x, (0.69 * _s, 0, 1.42), (0.745 * _s, 0, 1.42), "forearm" + _x, True),
        ("fingers" + _x, (0.745 * _s, 0, 1.42), (0.855 * _s, -0.005, 1.42), "hand" + _x, True),
        ("thumb" + _x, (0.735 * _s, -0.030, 1.416), (0.785 * _s, -0.058, 1.412), "hand" + _x, False),
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


# ---------------------------------------------------------------- 頭部
def _build_head(col, M, off):
    """頭、五官、頭髮：全部完全綁在 head 骨頭上。回傳物件清單。"""
    HC = Vector((0, 0.0, 1.665 + off))
    SX, SY, SZ = 0.098, 0.112, 0.122
    parts = []

    def new_obj(name, bm, material):
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
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=18, radius=1.0)
    for v in bm.verts:
        x, y, z = v.co
        if z < 0:
            x *= 1 - 0.30 * (-z) ** 1.3
            if y < 0:
                y *= 1 - 0.10 * (-z)
        if y > 0:
            y *= 1.06
        if y < -0.55:
            y = -0.55 + (y + 0.55) * 0.55
        v.co = Vector((x * SX, y * SY, z * SZ)) + HC
    head = new_obj("Head", bm, M["Athlete_Skin"])
    hv = [v.co.copy() for v in head.data.vertices]

    def front_y_at(z, x=0.0, tol=0.03):
        return min(c.y for c in hv if abs(c.z - z) < tol and abs(c.x - x) < 0.035)

    nz = HC.z - 0.020
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * 0.011, v.co.y * 0.010, v.co.z * 0.013)) + Vector((0, front_y_at(nz) + 0.001, nz))
    new_obj("Nose", bm, M["Athlete_Skin"])
    for s in (1, -1):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * 0.010, v.co.y * 0.018, v.co.z * 0.028)) + Vector((s * SX * 0.97, 0.012, HC.z - 0.008))
        new_obj(f"Ear{s}", bm, M["Athlete_Skin"])
    ez = HC.z + 0.008
    for s in (1, -1):
        ex = 0.036 * s
        fy = front_y_at(ez, ex)
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * 0.017, v.co.y * 0.006, v.co.z * 0.011)) + Vector((ex, fy + 0.002, ez))
        new_obj(f"EyeW{s}", bm, M["Athlete_EyeWhite"])
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
        for v in bm.verts:
            v.co = Vector((v.co.x * 0.0095, v.co.y * 0.005, v.co.z * 0.011)) + Vector((ex, fy - 0.003, ez))
        new_obj(f"Pupil{s}", bm, M["Athlete_Eyes"])
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.0028)
        bmesh.ops.translate(bm, vec=Vector((ex + 0.003, fy - 0.0075, ez + 0.004)), verts=bm.verts)
        new_obj(f"Glint{s}", bm, M["Athlete_EyeWhite"])
        bz = ez + 0.026
        bm = bmesh.new()
        bmesh.ops.create_cube(bm, size=1.0)
        bmesh.ops.scale(bm, vec=Vector((0.030, 0.008, 0.0065)), verts=bm.verts)
        bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector(), matrix=Matrix.Rotation(math.radians(-8 * s), 4, 'Y'))
        bmesh.ops.translate(bm, vec=Vector((ex + 0.002 * s, front_y_at(bz, ex) + 0.001, bz)), verts=bm.verts)
        new_obj(f"Brow{s}", bm, M["Athlete_Hair"])
    mz = HC.z - 0.058
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((0.026, 0.006, 0.0045)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((0, front_y_at(mz) + 0.0015, mz)), verts=bm.verts)
    new_obj("Mouth", bm, M["Athlete_Mouth"])

    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)
    for v in bm.verts:
        d = v.co.normalized()
        bump = 1.0 + 0.04 * max(0.0, d.z + 0.2) * (1 + math.sin(d.x * 9) * math.cos(d.y * 7))
        v.co = Vector((d.x * SX * 1.12 * bump, d.y * SY * 1.10 * bump + 0.006, d.z * SZ * 1.08 * bump + 0.012)) + HC
    kill = []
    for f in bm.faces:
        c = f.calc_center_median() - HC
        n = Vector((c.x / SX, c.y / SY, c.z / SZ))
        if n.z < -0.15 or (n.y < -0.25 and n.z < 0.50 + 0.25 * abs(n.x)) or (abs(n.x) > 0.75 and n.z < 0.05 and n.y < 0.2):
            kill.append(f)
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    new_obj("Hair", bm, M["Athlete_Hair"])
    for o in parts:
        g = o.vertex_groups.new(name="head")
        g.add(list(range(len(o.data.vertices))), 1.0, 'REPLACE')
    return parts


# ---------------------------------------------------------------- 球鞋
_HALF_W = [(0.0, 0.040), (0.08, 0.055), (0.35, 0.056), (0.70, 0.060), (0.90, 0.050), (1.0, 0.022)]
_TOP = [(0.0, 0.090), (0.06, 0.118), (0.30, 0.112), (0.42, 0.092), (0.70, 0.072), (0.88, 0.058), (1.0, 0.030)]
_BOT = [(0.0, 0.010), (0.06, 0.0), (0.80, 0.0), (0.93, 0.008), (1.0, 0.022)]
Y_HEEL, Y_TOE = 0.100, -0.205


def _curve(u, pts):
    u = min(max(u, 0.0), 1.0)
    for (u0, v0), (u1, v1) in zip(pts, pts[1:]):
        if u0 <= u <= u1:
            s = (u - u0) / (u1 - u0)
            s = s * s * (3 - 2 * s)
            return v0 + (v1 - v0) * s
    return pts[-1][1]


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
    """原創低筒球鞋：鞋面（含鞋跟護片）、4 條鞋帶、獨立的白色鞋底。"""
    parts = []
    NU, NT = 26, 28
    for s, sfx in ((1, ".L"), (-1, ".R")):
        cx0 = 0.11 * s
        # 鞋面：沿鞋長取剖面，剖面為底部較平的圓角矩形
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
                ring.append(bm.verts.new((cx + px * wx, y, zc + pz * h + off)))
            rings.append(ring)
        for i in range(NU):
            for j in range(NT):
                f = bm.faces.new((rings[i][j], rings[i][(j + 1) % NT], rings[i + 1][(j + 1) % NT], rings[i + 1][j]))
                heel_tab = i < 4 and math.sin(2 * math.pi * (j + 0.5) / NT) > -0.25
                f.material_index = 1 if heel_tab else 0
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
        # 鞋帶
        for k, u in enumerate((0.46, 0.54, 0.62, 0.70)):
            y = Y_HEEL + (Y_TOE - Y_HEEL) * u
            bm = bmesh.new()
            bmesh.ops.create_cube(bm, size=1.0)
            bmesh.ops.scale(bm, vec=Vector((0.050, 0.008, 0.006)), verts=bm.verts)
            bmesh.ops.translate(bm, vec=Vector((cx0 - s * 0.010 * max(0.0, u - 0.5), y, _curve(u, _TOP) + off + 0.001)), verts=bm.verts)
            lm = bpy.data.meshes.new(f"Lace{sfx}{k}")
            bm.to_mesh(lm)
            bm.free()
            lm.materials.append(M["Athlete_Laces"])
            lo = bpy.data.objects.new(f"Lace{sfx}{k}", lm)
            col.objects.link(lo)
            parts.append((lo, sfx))
        # 鞋底：比鞋面稍寬、3 公分厚，沿鞋底弧度
        pad, outline = 0.006, []
        us = [i / 30 for i in range(31)]
        for u in us:
            outline.append((cx0 - s * 0.010 * max(0.0, u - 0.5) + _curve(u, _HALF_W) * 1.06 + pad, u))
        for k in range(1, 6):
            a = math.pi * k / 6
            outline.append((cx0 - s * 0.005 + (_curve(1.0, _HALF_W) * 1.06 + pad) * math.cos(a), 1.0 + 0.06 * math.sin(a)))
        for u in reversed(us):
            outline.append((cx0 - s * 0.010 * max(0.0, u - 0.5) - _curve(u, _HALF_W) * 1.06 - pad, u))
        for k in range(1, 6):
            a = math.pi + math.pi * k / 6
            outline.append((cx0 + (_curve(0.0, _HALF_W) * 1.06 + pad) * math.cos(a), -0.08 * abs(math.sin(a))))
        bm = bmesh.new()
        bottom, top = [], []
        for x, u in outline:
            y = Y_HEEL + (Y_TOE - Y_HEEL) * u
            zb = _curve(u, _BOT) - 0.001
            bottom.append(bm.verts.new((x, y, zb + off)))
            top.append(bm.verts.new((x, y, zb + 0.030 + off)))
        n = len(outline)
        for i in range(n):
            bm.faces.new((bottom[i], bottom[(i + 1) % n], top[(i + 1) % n], top[i]))
        bm.faces.new(list(reversed(bottom)))
        bm.faces.new(top)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
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


# ---------------------------------------------------------------- 籃球
def _build_ball(col, M):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=BALL_R, location=(0, 0, 0))
    ball = bpy.context.view_layer.objects.active
    for c in list(ball.users_collection):
        c.objects.unlink(ball)
    col.objects.link(ball)
    bpy.ops.object.shade_smooth()
    ball.data.materials.append(M["Ball_Leather"])
    rings = []

    def ring(major, rot, loc):
        bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=0.0035, major_segments=48, minor_segments=6)
        t = bpy.context.view_layer.objects.active
        for c in list(t.users_collection):
            c.objects.unlink(t)
        col.objects.link(t)
        t.matrix_world = Matrix.Translation(loc) @ rot.to_4x4()
        bpy.ops.object.shade_smooth()
        t.data.materials.append(M["Ball_Seam"])
        rings.append(t)

    ring(BALL_R, Matrix.Identity(3), Vector())
    ring(BALL_R, Matrix.Rotation(math.pi / 2, 3, 'X'), Vector())
    d = 0.07
    for s in (1, -1):
        ring(math.sqrt(BALL_R ** 2 - d ** 2), Matrix.Rotation(math.pi / 2, 3, 'Y'), Vector((s * d, 0, 0)))
    _select_only(rings + [ball], ball)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    ball = _join(rings, ball)
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
