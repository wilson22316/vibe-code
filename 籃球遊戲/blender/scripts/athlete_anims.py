"""運動員的動作：用「兩段式 IK 解算」逐格算出骨頭角度，再記錄成關鍵影格。

每段動作 = 骨架一個 Action（<名稱>_Rig）+ 球一個 Action（<名稱>_Ball），
兩者放在同名的 NLA 軌道上；glTF 匯出時（NLA_TRACKS 模式）會合併成同名的一段動畫。

目前的動作（24 fps）：
  Idle     48 格循環  無球待機，球放在右腳前方地上
  Dribble  24 格循環  原地運球
  Shoot    36 格單次  跳投，第 18 格（0.75 秒）出手，之後球縮放為 0、交給遊戲接手；出手後手臂停在前上方再收回
  Sprint   12 格循環  原地運球衝刺，遊戲端以 SPRINT_SPEED 公尺/秒推動角色
"""
import math

import bpy
from mathutils import Matrix, Vector

FPS = 24
R_BALL = 0.12
SHOOT_RELEASE_FRAME = 18
SHOOT_END = 36           # Shoot 最後一格（回到運球站姿）
CONTACT_GAP = -0.003     # 球貼在手上時，手指微微壓進球皮的深度（匯出縮放後的公尺）
PALM_T = 0.016           # 掌心到手骨中線的厚度（縮放前），用來從球的位置推回手腕
PALM_A = 0.075           # 掌心中央離手腕的距離（縮放前）
SPRINT_SPEED = None   # 由 make_sprint() 依步幅計算後填入（縮放前 3.0 m/s；匯出縮放後約 2.84 m/s，見 build_athlete.py）

V = Vector


class Poser:
    """把「手腕、腳踝要放在哪裡」轉換成骨頭旋轉的工具。座標一律是 Blender 世界座標。"""

    def __init__(self, rig, ball, off, scale):
        self.rig, self.ball, self.off = rig, ball, off
        self.Z = V((0, 0, off))
        self.floor = R_BALL - off           # 球放在地上時的球心高度（之後會再加上 Z）
        self.pb = rig.pose.bones
        for p in self.pb:
            p.rotation_mode = 'QUATERNION'
        self.rest = {b.name: b.matrix_local.copy() for b in rig.data.bones}
        self.blen = {b.name: b.length for b in rig.data.bones}
        self.unreachable = []
        self._prevq = {}
        # 匯出前角色縮 scale 倍、球不縮，球心高度改成 scale * z + (1 - scale) * R_BALL。
        # 換回縮放前的座標，球等於往上移 lift、半徑變成 R_BALL / scale。
        self.s = scale
        self.ball_lift = V((0, 0, (1 - scale) * R_BALL / scale))
        self.body = next(c for c in rig.children if c.type == 'MESH')
        self.hand_idx = {sfx: self._verts_of({"hand" + sfx, "fingers" + sfx, "thumb" + sfx}) for sfx in (".R", ".L")}

    def _verts_of(self, groups):
        """主要權重落在 groups 裡的頂點。"""
        names = {g.index: g.name for g in self.body.vertex_groups}
        idx = []
        for v in self.body.data.vertices:
            if v.groups and names[max(v.groups, key=lambda g: g.weight).group] in groups:
                idx.append(v.index)
        return idx

    def hand_points(self, sides):
        """目前姿勢下，手（含手指）頂點的世界座標。"""
        dg = bpy.context.evaluated_depsgraph_get()
        ev = self.body.evaluated_get(dg)
        me = ev.to_mesh()
        mw = self.body.matrix_world
        pts = [mw @ me.vertices[i].co for sfx in sides for i in self.hand_idx[sfx]]
        ev.to_mesh_clear()
        return pts

    def seat(self, B, d, sides=(".R",)):
        """沿 d 方向移動球心，讓球剛好貼在手上（壓進 CONTACT_GAP）。原本有空隙會拉近、陷進去會推開。"""
        d = d.normalized()
        rho = (R_BALL + CONTACT_GAP) / self.s
        Bp = B + self.ball_lift
        best = None
        for p in self.hand_points(sides):
            w = p - Bp
            t = w.dot(d)
            perp2 = w.length_squared - t * t
            if perp2 < rho * rho:
                x = t + math.sqrt(rho * rho - perp2)
                best = x if best is None else max(best, x)
        return B if best is None else B + d * best

    def gap(self, B, sides):
        """手與球表面最近的距離（匯出縮放後的公尺；負數是陷進球裡）。"""
        Bp = B + self.ball_lift
        return min((p - Bp).length for p in self.hand_points(sides)) * self.s - R_BALL

    def palm(self, name, direction, toward, w=1.0):
        """把手轉成手指朝 direction、掌心（手骨 -Z 軸）朝 toward；w 是和目前方向的混合比例。"""
        y = direction.normalized()
        z = -(toward - y * toward.dot(y)).normalized()
        target = Matrix((y.cross(z), y, z)).transposed().to_quaternion()
        cur = self.pb[name].matrix.to_3x3().to_quaternion()
        if cur.dot(target) < 0:
            target.negate()
        self.place(name, self.pb[name].head.copy(), cur.slerp(target, w).to_matrix())

    def hold_two(self, B, sR, dR, sL, dL, pose_fn):
        """雙手持球：掌心貼在球面上 sR、sL 方向（從球心指向手掌），手指朝 dR、dL。
        pose_fn(wristR, wristL) 擺出整個姿勢；手腕位置反覆微調到手剛好壓進球 CONTACT_GAP。"""
        sR, sL = sR.normalized(), sL.normalized()
        dR = (dR - sR * dR.dot(sR)).normalized()
        dL = (dL - sL * dL.dot(sL)).normalized()
        reach = R_BALL / self.s + PALM_T
        w = {".R": B + sR * reach - dR * PALM_A, ".L": B + sL * reach - dL * PALM_A}
        side = {".R": sR, ".L": sL}
        for _ in range(6):
            pose_fn(w[".R"], w[".L"])
            self.palm("hand.R", dR, -sR)
            self.palm("hand.L", dL, -sL)
            err = {k: self.gap(B, (k,)) - CONTACT_GAP for k in w}
            if all(abs(e) < 0.0015 for e in err.values()):
                break
            for k, e in err.items():
                w[k] = w[k] - side[k] * (e / self.s)       # 陷進去（e<0）往外推，有空隙往內收

    # ---- 基本操作
    def _upd(self):
        bpy.context.view_layer.update()

    def reset(self):
        for p in self.pb:
            p.location = (0, 0, 0)
            p.rotation_quaternion = (1, 0, 0, 0)
            p.scale = (1, 1, 1)
        self._upd()

    def place(self, name, head, R3):
        m = R3.to_4x4()
        m.translation = head
        self.pb[name].matrix = m
        self._upd()

    def aim(self, name, head, direction):
        """讓骨頭從 head 指向 direction，旋轉量最小。"""
        R = self.rest[name].to_3x3()
        q = R.col[1].normalized().rotation_difference(direction.normalized())
        self.place(name, head, q.to_matrix() @ R)

    def two_bone(self, b1, b2, target, pole, tag):
        """兩段式 IK：給定末端位置與關節彎曲方向（pole），算出兩根骨頭的方向。"""
        S = self.pb[b1].head.copy()
        a, b = self.blen[b1], self.blen[b2]
        d = target - S
        L = d.length
        if L > a + b - 1e-4:
            if L - (a + b) > 0.01:
                self.unreachable.append((tag, round(L - (a + b), 3)))
            L = a + b - 1e-4
        L = max(L, abs(a - b) + 1e-4)
        u = d.normalized()
        cosA = (a * a + L * L - b * b) / (2 * a * L)
        sinA = math.sqrt(max(0.0, 1 - cosA * cosA))
        p = pole - u * pole.dot(u)
        p.normalize()
        E = S + u * (a * cosA) + p * (a * sinA)
        self.aim(b1, S, E - S)
        self.aim(b2, self.pb[b2].head.copy(), (S + u * L) - self.pb[b2].head)

    def ankle_rest(self, sfx):
        return self.rest["foot" + sfx].translation.copy()

    # ---- 整個姿勢
    def pose(self, tag, hips_d, lean, head_tilt, wristR, wristL, ankleR, ankleL, handR_dir=None,
             poleR=V((-0.35, 1.0, -0.25)), poleL=V((0.35, 1.0, -0.25)), footR=0.0, footL=0.0, breath=0.0, twist=0.0):
        """hips_d：臀部位移；lean：(臀, 脊椎, 胸) 前傾弧度；wrist/ankle：手腕、腳踝的世界座標；
        pole：手肘彎的方向；foot：腳尖下壓弧度；twist：上半身左右扭轉。"""
        Rx = lambda a: Matrix.Rotation(a, 3, 'X')
        Rz = Matrix.Rotation(twist, 3, 'Z')
        rest, pb = self.rest, self.pb
        self.reset()
        lh, ls, lc = lean
        self.place("hips", rest["hips"].translation + hips_d, Rx(lh) @ rest["hips"].to_3x3())
        self.place("spine", pb["spine"].head.copy(), Rz @ Rx(lh + ls) @ rest["spine"].to_3x3())
        self.place("chest", pb["chest"].head.copy(), Rz @ Rx(lh + ls + lc + breath) @ rest["chest"].to_3x3())
        self.place("neck", pb["neck"].head.copy(), Rx(lh + ls + lc) @ rest["neck"].to_3x3())
        self.place("head", pb["head"].head.copy(), Rx(lh + ls + lc + head_tilt) @ rest["head"].to_3x3())
        self.two_bone("upper_arm.R", "forearm.R", wristR, poleR, "R" + tag)
        self.two_bone("upper_arm.L", "forearm.L", wristL, poleL, "L" + tag)
        if handR_dir is not None:
            self.aim("hand.R", pb["hand.R"].head.copy(), handR_dir)
        for sfx, ank, fr in ((".R", ankleR, footR), (".L", ankleL, footL)):
            side = -1 if sfx == ".R" else 1
            self.two_bone("thigh" + sfx, "shin" + sfx, ank, V((0.15 * side, -1.0, 0.0)), "leg" + sfx + tag)
            self.place("foot" + sfx, pb["foot" + sfx].head.copy(), Rx(fr) @ rest["foot" + sfx].to_3x3())

    # ---- 記錄關鍵影格
    def new_action(self, name):
        for obj in (self.rig, self.ball):
            if obj.animation_data is None:
                obj.animation_data_create()
        self.rig.animation_data.action = bpy.data.actions.new(name + "_Rig")
        self.ball.animation_data.action = bpy.data.actions.new(name + "_Ball")
        self._prevq.clear()

    def key(self, frame, ball_loc, ball_scale=1.0):
        for p in self.pb:
            q = p.rotation_quaternion.copy()
            if p.name in self._prevq and q.dot(self._prevq[p.name]) < 0:   # 避免四元數翻面造成內插亂轉
                q.negate()
                p.rotation_quaternion = q
            self._prevq[p.name] = q.copy()
            p.keyframe_insert("rotation_quaternion", frame=frame)
            p.keyframe_insert("location", frame=frame)
        self.ball.location = ball_loc
        self.ball.scale = (ball_scale,) * 3
        self.ball.keyframe_insert("location", frame=frame)
        self.ball.keyframe_insert("scale", frame=frame)


def ease(s):
    return 0.5 - 0.5 * math.cos(math.pi * s)


def smooth_pts(t, pts):
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t0 <= t <= t1:
            return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0))
    return pts[-1][1]


# ---------------------------------------------------------------- 各段動作
def make_dribble(P):
    P.new_action("Dribble")
    Z = P.Z
    aR0 = P.ankle_rest(".R") + V((-0.06, 0.07, 0))
    aL0 = P.ankle_rest(".L") + V((0.06, -0.08, 0))
    HZ = [(0.0, 0.98), (0.25, 0.86), (0.60, 1.00), (0.85, 1.00), (1.0, 0.98)]   # 右手腕高度
    BX, BY = -0.30, -0.355
    T_PUSH, T_FLOOR = 0.25, 13 / 24          # 手推到 0.25 放球；落地放在整數影格（第 13 格），關鍵影格才取得到

    def pose_at(t):
        P.pose(f"D{t:.3f}", V((0, -0.03, -0.150 - 0.012 * math.sin(2 * math.pi * t))), (0.10, 0.10, 0.06), 0.18,
               V((BX, -0.30, smooth_pts(t, HZ))) + Z, V((0.33, -0.16, 1.08 + 0.01 * math.sin(2 * math.pi * t))) + Z,
               aR0, aL0, handR_dir=V((0, -1.0, -0.25)))

    def held():                                          # 球從正下方貼住目前姿勢的右手
        return P.seat(V((BX, BY, 0.8)) + Z, V((0, 0, -1))).z - Z.z

    pose_at(0.0)
    z0 = held()
    pose_at(T_PUSH)
    z1 = held()
    for f in range(25):
        t = f / 24.0
        pose_at(t)
        if t <= T_PUSH:                                  # 手壓著球往下推
            zb = held()
        elif t <= T_FLOOR:                               # 球加速落地
            s = (t - T_PUSH) / (T_FLOOR - T_PUSH)
            zb = z1 - (z1 - P.floor) * s * s
        else:                                            # 反彈減速回到手上
            u = (t - T_FLOOR) / (1 - T_FLOOR)
            zb = P.floor + (z0 - P.floor) * (1 - (1 - u) ** 2)
        P.key(f + 1, V((BX, BY, zb)) + Z)


def make_idle(P):
    P.new_action("Idle")
    Z = P.Z
    for f in range(49):
        t = f / 48.0
        sw = math.sin(2 * math.pi * t)
        P.pose(f"I{f}", V((0.006 * sw, 0, -0.012 - 0.006 * sw)), (0, 0, 0), 0.02,
               # 手自然垂在大腿外側、稍微在大腿中線前面（參考一般人放鬆站姿）
               V((-0.215, -0.03, 0.85 + 0.006 * sw)) + Z, V((0.215, -0.03, 0.85 + 0.006 * sw)) + Z,
               P.ankle_rest(".R"), P.ankle_rest(".L"), breath=-0.02 * sw)
        P.key(f + 1, V((-0.34, -0.22, P.floor)) + Z)


def make_shoot(P):
    """跳投：收球 → 屈膝 → 起跳舉球（手肘在球正下方、朝前）→ 最高點出手 → 壓腕 → 落地時手臂仍伸在前上方 → 收回。"""
    P.new_action("Shoot")
    Z = P.Z
    aR0 = P.ankle_rest(".R") + V((-0.06, 0.07, 0))      # 運球站姿
    aL0 = P.ankle_rest(".L") + V((0.06, -0.08, 0))
    aRs = P.ankle_rest(".R") + V((-0.03, -0.05, 0))     # 投籃站姿：與肩同寬、右腳略前
    aLs = P.ankle_rest(".L") + V((0.04, 0.03, 0))
    # 影格, 臀部位移, 前傾, 頭, 球, 右手腕, 左手腕, 右手方向, 離地高度, 右手肘方向, 左手肘方向
    K = [(0, V((0, -0.03, -0.15)), (0.10, 0.10, 0.06), 0.18, V((-0.30, -0.355, 0.835)), V((-0.30, -0.30, 0.98)), V((0.33, -0.16, 1.08)), V((0, -1, -0.25)), 0.0, V((-0.35, 1.0, -0.25)), V((0.35, 1.0, -0.25))),
         (6, V((0, -0.02, -0.16)), (0.06, 0.05, 0.03), 0.05, V((-0.04, -0.28, 1.12)), V((-0.10, -0.22, 1.04)), V((0.09, -0.27, 1.10)), V((0.15, -0.6, 1)), 0.0, V((-0.2, 0.3, -1.0)), V((0.6, 0.2, -0.6))),
         (10, V((0, -0.02, -0.22)), (0.08, 0.04, 0.02), 0.00, V((-0.04, -0.25, 1.08)), V((-0.10, -0.19, 1.00)), V((0.09, -0.24, 1.06)), V((0.15, -0.6, 1)), 0.0, V((-0.2, 0.3, -1.0)), V((0.6, 0.2, -0.6))),
         (15, V((0, 0.00, 0.04)), (0.00, 0.00, 0.00), -0.05, V((-0.07, -0.20, 1.80)), V((-0.08, -0.13, 1.67)), V((0.05, -0.18, 1.77)), V((0, -0.35, 1)), 0.04, V((-0.12, -1.0, -0.2)), V((0.7, -0.2, -0.4))),
         (18, V((0, 0.00, 0.14)), (-0.02, 0.0, 0.0), -0.12, V((-0.07, -0.21, 2.06)), V((-0.07, -0.14, 1.92)), V((0.04, -0.17, 1.95)), V((0, -0.3, 1)), 0.14, V((-0.12, -1.0, 0.0)), V((0.7, -0.2, -0.4))),
         (21, V((0, 0.00, 0.10)), (0.00, 0.0, 0.0), -0.08, V((-0.07, -0.21, 2.06)), V((-0.08, -0.30, 1.88)), V((0.26, -0.15, 1.52)), V((0, -1, -0.6)), 0.10, V((-0.12, -1.0, 0.0)), V((0.5, 0.6, -0.4))),
         # 落地屈膝，右手仍伸在前上方（收尾停留）
         (24, V((0, -0.01, -0.10)), (0.03, 0.02, 0.01), -0.02, V((-0.07, -0.21, 2.06)), V((-0.09, -0.36, 1.64)), V((0.28, -0.12, 1.36)), V((0, -1, -0.6)), 0.0, V((-0.12, -1.0, 0.0)), V((0.5, 0.6, -0.4))),
         (28, V((0, -0.02, -0.14)), (0.05, 0.04, 0.02), 0.02, V((-0.07, -0.21, 2.06)), V((-0.11, -0.38, 1.56)), V((0.30, -0.14, 1.22)), V((0, -1, -0.5)), 0.0, V((-0.15, -0.8, -0.3)), V((0.35, 1.0, -0.25))),
         (31, V((0, -0.02, -0.17)), (0.07, 0.06, 0.03), 0.08, V((-0.07, -0.21, 2.06)), V((-0.22, -0.32, 1.30)), V((0.31, -0.15, 1.14)), V((0, -1, -0.4)), 0.0, V((-0.3, 0.6, -0.6)), V((0.35, 1.0, -0.25))),
         (SHOOT_END, V((0, -0.03, -0.15)), (0.10, 0.10, 0.06), 0.18, V((-0.30, -0.355, 0.835)), V((-0.30, -0.30, 0.98)), V((0.33, -0.16, 1.08)), V((0, -1, -0.25)), 0.0, V((-0.35, 1.0, -0.25)), V((0.35, 1.0, -0.25)))]

    def interp(f):
        for a, b in zip(K, K[1:]):
            if a[0] <= f <= b[0]:
                s = ease((f - a[0]) / (b[0] - a[0]))
                L = lambda x, y: x + (y - x) * s
                return (L(a[1], b[1]), tuple(L(x, y) for x, y in zip(a[2], b[2])), L(a[3], b[3]), L(a[4], b[4]),
                        L(a[5], b[5]), L(a[6], b[6]), a[7].lerp(b[7], s), L(a[8], b[8]), a[9].lerp(b[9], s), a[10].lerp(b[10], s))

    def ramp(f, a, b, c, d):                             # a→b 從 0 升到 1，c→d 降回 0
        return max(0.0, min(1.0, (f - a) / (b - a), (d - f) / (d - c)))

    def hand_axes():                                     # 右手目前的手指方向、掌心方向
        m = P.pb["hand.R"].matrix.to_3x3()
        return m.col[1].copy(), -m.col[2].copy()

    def flick(f, rel, end):
        """出手後手腕自然往前壓：只繞手腕的屈曲軸（手指往掌心那側）轉，不繞前臂扭轉。
        前 3 格快速壓腕約 150°（手指從朝後上方轉到朝前、約水平），維持到手臂開始收回（第 28 格），
        再慢慢轉到結束姿勢的角度。"""
        d0, n0 = rel
        a = d0.cross(n0).normalized()
        de = end[0] - a * end[0].dot(a)
        th_end = math.atan2(d0.cross(de).dot(a), d0.dot(de)) % (2 * math.pi)
        th_snap = min(math.radians(150), th_end)
        g = f - SHOOT_RELEASE_FRAME
        th = th_snap * ease(min(1.0, g / 3)) + (th_end - th_snap) * ease(min(1.0, max(0.0, (g - 10) / 6)))
        rot = Matrix.Rotation(th, 3, a)
        return rot @ d0, rot @ n0

    up = V((0, 0, 1))
    B_release = release_axes = end_axes = release_L = end_L = None
    for f in range(SHOOT_END + 1):
        hd, ln, ht, bl, wR, wL, hR, lift, pR, pL = interp(f)
        w = min(1.0, f / 6.0) if f <= 10 else (1.0 if f <= SHOOT_END - 5 else 1.0 - (f - (SHOOT_END - 5)) / 5.0)
        aR = aR0.lerp(aRs, w) + V((0, 0, lift))
        aL = aL0.lerp(aLs, w) + V((0, 0, lift))
        toe = 0.55 * (lift / 0.14)                       # 離地時腳尖朝下
        B, wristR, wristL = bl + Z, wR + Z, wL + Z
        # 右手托球：掌心朝球、手指沿著球面，手腕從球的位置推回去。第 0 格和 Dribble 一樣（手壓在球上）。
        kR = ramp(f, 0, 4, SHOOT_RELEASE_FRAME, SHOOT_RELEASE_FRAME + 3)
        nR = (B - wristR).normalized()
        dR = (hR - nR * hR.dot(nR)).normalized()
        wristR = wristR.lerp(B - nR * (R_BALL / P.s + PALM_T) - dR * PALM_A, kR)
        # 左手扶在球側：掌心朝球，手指朝上
        kL = ramp(f, 3, 6, SHOOT_RELEASE_FRAME, SHOOT_RELEASE_FRAME + 3)
        sL = (wristL - B).normalized()
        dL = (up - sL * up.dot(sL)).normalized()

        def do_pose(wl):
            P.pose(f"S{f}", hd, ln, ht, wristR, wl, aR, aL, handR_dir=hR, poleR=pR, poleL=pL, footR=toe, footL=toe)
            P.palm("hand.R", dR, nR, kR)
            P.palm("hand.L", dL, -sL, kL)

        do_pose(wristL)
        if f == 0:
            end_axes = hand_axes()                       # 最後一格回到和第 0 格相同的姿勢
            end_L = P.pb["hand.L"].matrix.to_3x3().to_quaternion()
        if f > SHOOT_RELEASE_FRAME:
            d, n = flick(f, release_axes, end_axes)
            P.palm("hand.R", d, n, 1 - min(1.0, max(0.0, (f - (SHOOT_END - 3)) / 3)))
            # 左手放開球後，用剩下的影格慢慢轉回結束姿勢（只用 3 格轉會甩手）
            e = ease((f - SHOOT_RELEASE_FRAME) / (SHOOT_END - SHOOT_RELEASE_FRAME))
            qL = end_L.copy()
            if release_L.dot(qL) < 0:
                qL.negate()
            P.place("hand.L", P.pb["hand.L"].head.copy(), release_L.slerp(qL, e).to_matrix())
        if f <= SHOOT_RELEASE_FRAME:
            B = P.seat(B, V((0, 0, -1)).lerp(nR, kR))   # 球貼在右手掌上
            if kL > 0:
                wristL = wristL.lerp(B + sL * (R_BALL / P.s + PALM_T) - dL * PALM_A, kL)
                do_pose(wristL)
                for _ in range(4):                       # 左手還陷在球裡就沿 sL 往外移
                    g = P.gap(B, (".L",))
                    if g >= CONTACT_GAP - 0.002:
                        break
                    wristL = wristL + sL * ((CONTACT_GAP - g) / P.s)
                    do_pose(wristL)
            B_release, release_axes = B, hand_axes()
            release_L = P.pb["hand.L"].matrix.to_3x3().to_quaternion()
        else:
            B = B_release                                # 出手後球停在出手位置，縮小消失時才不會掃過手
        P.key(f + 1, B, 1.0 if f <= SHOOT_RELEASE_FRAME else 0.0)


def make_sprint(P):
    """運球衝刺：12 格跑兩步、運球一次。原地循環，地面上的腳以固定速度往後移。"""
    global SPRINT_SPEED
    P.new_action("Sprint")
    Z = P.Z
    N, S, YF, YB = 12, 0.40, -0.30, 0.30                 # 影格數、著地比例、腳最前與最後的位置

    # 擺動腳的前後位置用 Hermite 曲線：離地時接著著地的往後速度，落地前一格也已經用著地速度往後收，
    # 這樣最後一格落地時腳相對地面不動（推動角色時不會往前滑）。M 由「落地前一格」的位置反推。
    K_ST = -(1 - S) / S                                  # 著地時的速度（以擺動進度為單位）
    DS = (1 / N) / (1 - S)                               # 一格對應的擺動進度
    s_last = 1 - DS
    M = (1 - K_ST * DS - (3 * s_last ** 2 - 2 * s_last ** 3)) / (2 * s_last ** 3 - 3 * s_last ** 2 + s_last)

    def foot_cycle(ph, base):
        if ph < S:
            return base + V((0, YF + (YB - YF) * (ph / S), 0)), 0.0
        s = (ph - S) / (1 - S)
        h = 3 * s * s - 2 * s ** 3 + M * (2 * s ** 3 - 3 * s * s + s)
        return base + V((0, YB + (YF - YB) * h, 0.20 * math.sin(math.pi * s) ** 0.8)), 0.45 * math.sin(math.pi * s)

    HZs = [(0.0, 0.97), (0.2, 0.86), (0.55, 1.00), (0.85, 1.00), (1.0, 0.97)]
    T_PUSH, T_FLOOR = 0.2, 7 / 12                        # 落地放在整數影格（第 7 格）

    def pose_at(t):
        aR, rR = foot_cycle(t % 1.0, P.ankle_rest(".R") + V((0.02, 0, 0)))
        aL, rL = foot_cycle((t + 0.5) % 1.0, P.ankle_rest(".L") + V((-0.02, 0, 0)))
        swing = math.cos(2 * math.pi * t)
        P.pose(f"R{t:.3f}", V((0, -0.04, -0.10 + 0.02 * math.sin(4 * math.pi * t))), (0.16, 0.08, 0.03), -0.12,
               V((-0.28, -0.40, smooth_pts(t, HZs))) + Z, V((0.26, -0.20 * swing, 1.00 - 0.05 * swing)) + Z,
               aR, aL, handR_dir=V((0, -1.0, -0.3)), poleL=V((0.3, 1.0, -0.3)), footR=rR, footL=rL, twist=0.06 * swing)

    def held():
        return P.seat(V((-0.28, -0.46, 0.8)) + Z, V((0, 0, -1))).z - Z.z

    pose_at(0.0)
    zs0 = held()
    pose_at(T_PUSH)
    zs1 = held()
    for f in range(N + 1):
        t = f / N
        pose_at(t)
        if t <= T_PUSH:
            zb, yb = held(), -0.46
        elif t <= T_FLOOR:
            s = (t - T_PUSH) / (T_FLOOR - T_PUSH)
            zb, yb = zs1 - (zs1 - P.floor) * s * s, -0.46 - 0.16 * s
        else:
            u = (t - T_FLOOR) / (1 - T_FLOOR)
            zb, yb = P.floor + (zs0 - P.floor) * (1 - (1 - u) ** 2), -0.62 + 0.16 * u
        P.key(f + 1, V((-0.28, yb, zb)) + Z)
    SPRINT_SPEED = (YB - YF) / (S * N / FPS)


def make_triple_threat(P):
    """持球待機（三威脅）：屈膝、上身前傾、抬頭看前方，雙手持球在右腰前（右手在球後上方、左手扶球前側）。
    48 格循環，只有輕微的呼吸起伏。"""
    P.new_action("TripleThreat")
    Z = P.Z
    aR = P.ankle_rest(".R") + V((-0.10, 0.07, 0))      # 雙腳比肩寬、右腳略後
    aL = P.ankle_rest(".L") + V((0.10, -0.07, 0))
    for f in range(49):
        t = f / 48.0
        sw = math.sin(2 * math.pi * t)
        hips = V((0, 0.02, -0.19 - 0.006 * sw))
        B = V((-0.22, -0.25, 0.96 - 0.006 * sw)) + Z    # 球在右腰前、貼近身體

        def pose_fn(wR, wL):
            P.pose(f"T{f}", hips, (0.14, 0.10, 0.05), -0.22, wR, wL, aR, aL,
                   poleR=V((-0.6, 0.8, -0.3)), poleL=V((0.6, 0.6, -0.6)), breath=-0.015 * sw)

        P.hold_two(B, V((-0.25, 0.55, 0.75)), V((0.1, -1.0, 0.2)), V((0.75, -0.55, 0.05)), V((0, -0.2, 1.0)), pose_fn)
        P.key(f + 1, B)


CLIPS = ("Idle", "Dribble", "Shoot", "Sprint", "TripleThreat")


def build_all(rig, ball, off, scale):
    """scale：匯出前角色要縮的倍數（球不縮），放球時要算進去。"""
    bpy.context.scene.render.fps = FPS
    P = Poser(rig, ball, off, scale)
    make_dribble(P)
    make_idle(P)
    make_shoot(P)
    make_sprint(P)
    make_triple_threat(P)
    for obj in (rig, ball):
        ad = obj.animation_data
        for tr in list(ad.nla_tracks):
            ad.nla_tracks.remove(tr)
        for nm in CLIPS:
            act = bpy.data.actions[nm + ("_Rig" if obj is rig else "_Ball")]
            tr = ad.nla_tracks.new()
            tr.name = nm
            st = tr.strips.new(nm, 1, act)
            if getattr(act, "slots", None):
                st.action_slot = act.slots[0]
        ad.action = None
    P.reset()
    return {"unreachable_over_1cm": P.unreachable, "sprint_speed": SPRINT_SPEED}
