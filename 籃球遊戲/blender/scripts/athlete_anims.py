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
from mathutils import Matrix, Quaternion, Vector

FPS = 24
R_BALL = 0.12
SHOOT_RELEASE_FRAME = 18
SHOOT_END = 36           # Shoot 最後一格（回到運球站姿）
CONTACT_GAP = -0.003     # 球貼在手上時，手指微微壓進球皮的深度（匯出縮放後的公尺）
PALM_T = 0.016           # 掌心到手骨中線的厚度（縮放前），用來從球的位置推回手腕
PALM_A = 0.075           # 掌心中央離手腕的距離（縮放前）
TWIST_SHARE = 0.5        # 手的扭轉有多少比例改由前臂承擔（見 Poser.distribute_twist）
WRIST_MAX_BEND = 75      # 手腕最多彎幾度（見 Poser.limit_wrist）
LEFT_RELAX = 5           # 投籃出手後，扶球的左手幾格內放鬆回直
HINGE_ROLL_L = (120, 87)  # 投籃動作的左手臂：上臂、前臂 X 軸和手肘彎曲軸的角度（量自 Idle），見 Poser.two_bone
HINGE_ROLL_R = (-120, -87)  # 右手臂（左手鏡像）
# 三威脅的握法：(右手掌在球心的哪個方向, 右手指方向, 左手掌方向, 左手指方向)。
# 左手指朝前（順著前臂），不朝上，手腕才不會折成 90 度。
GRIP_TT = (Vector((-0.25, 0.55, 0.75)), Vector((0.1, -1.0, 0.2)), Vector((0.75, -0.55, 0.05)), Vector((-0.35, -1.0, 0.15)))


def slerp_short(a, b, t):
    """四元數球面內插，走最短的那一邊。"""
    b = b.copy()
    if a.dot(b) < 0:
        b.negate()
    return a.slerp(b, t)
SPRINT_SPEED = None   # 由 make_sprint() 依步幅計算後填入（縮放前 3.0 m/s；匯出縮放後約 2.84 m/s，見 build_athlete.py）
MOVE_SPEEDS = {}      # 原地移動動作的推動速度（縮放前，m/s），各 make_* 填入

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
        self._prevtw = {}                # 上一格手的扭轉角（distribute_twist 用來保持連續）
        self.hinge_roll = {}             # 手臂扭轉跟著手肘彎曲軸的一側 → (上臂, 前臂) 角度，見 two_bone
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

    def palm_inward(self, sfx, w=1.0):
        """沒持球的手：手指順著前臂、掌心朝身體（拇指朝上）。不轉的話會維持靜止姿勢的掌心朝下。"""
        inward = V((1, 0, 0)) if sfx == ".R" else V((-1, 0, 0))
        self.palm("hand" + sfx, self.pb["forearm" + sfx].matrix.col[1].to_3d(), inward, w)

    def palm(self, name, direction, toward, w=1.0):
        """把手轉成手指朝 direction、掌心（手骨 -Z 軸）朝 toward；w 是和目前方向的混合比例。"""
        y = direction.normalized()
        z = -(toward - y * toward.dot(y)).normalized()
        target = Matrix((y.cross(z), y, z)).transposed().to_quaternion()
        cur = self.pb[name].matrix.to_3x3().to_quaternion()
        if cur.dot(target) < 0:
            target.negate()
        self.place(name, self.pb[name].head.copy(), cur.slerp(target, w).to_matrix())
        self.limit_wrist(name)

    def limit_wrist(self, name, max_deg=WRIST_MAX_BEND):
        """手腕彎曲（手指偏離前臂方向）超過 max_deg 就往前臂方向收回，扭轉保持不變。
        真人手腕往掌心或手背彎大約 70～80 度就到底，再多看起來像折斷。"""
        y = V((0, 1, 0))
        q = self.wrist_local(name)
        swing = y.rotation_difference(q @ y)
        if swing.angle <= math.radians(max_deg):
            return
        twist = swing.inverted() @ q
        self.set_wrist_local(name, Quaternion(swing.axis, math.radians(max_deg)) @ twist)

    def hold_two(self, B, sR, dR, sL, dL, pose_fn):
        """雙手持球：掌心貼在球面上 sR、sL 方向（從球心指向手掌），手指朝 dR、dL。
        pose_fn(wristR, wristL) 擺出整個姿勢；手腕位置反覆微調到手剛好壓進球 CONTACT_GAP。"""
        sR, sL = sR.normalized(), sL.normalized()
        dR = (dR - sR * dR.dot(sR)).normalized()
        dL = (dL - sL * dL.dot(sL)).normalized()
        reach = R_BALL / self.s + PALM_T
        w = {".R": B + sR * reach - dR * PALM_A, ".L": B + sL * reach - dL * PALM_A}
        side = {".R": sR, ".L": sL}
        for _ in range(10):
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
        # aim 是「從靜止姿勢轉最少」，骨頭繞自己的扭轉和手肘實際的彎曲軸無關：手臂舉過頭時會漂掉一百多度，
        # 手腕得扭很大才能讓掌心朝對的方向。hinge_roll 有設定的一側，每根骨頭對準後立刻繞自己的軸
        # 轉到和彎曲軸保持固定角度（Idle 的關係）；上臂要在前臂對準前轉，否則會把前臂帶歪。
        ref = self.hinge_roll.get(b1[-2:])
        self.aim(b1, S, E - S)
        if ref is not None:
            self._roll_to_hinge(b1, p.cross(u), ref[0])
        self.aim(b2, self.pb[b2].head.copy(), (S + u * L) - self.pb[b2].head)
        if ref is not None:
            self._roll_to_hinge(b2, p.cross(u), ref[1])

    def _roll_to_hinge(self, name, h, deg):
        """骨頭繞自己的軸轉，讓 X 軸到彎曲軸 h 的角度等於 deg。"""
        m = self.pb[name].matrix.to_3x3()
        ax, x = m.col[1].normalized(), m.col[0].normalized()
        ang = math.atan2(x.cross(h).dot(ax), x.dot(h))
        self.place(name, self.pb[name].head.copy(), Matrix.Rotation(ang - math.radians(deg), 3, ax) @ m)

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
        self._prevtw.clear()
        self.hinge_roll = {}

    def wrist_local(self, name):
        """手相對前臂的轉動（四元數）。"""
        fore = self.pb[name.replace("hand", "forearm")].matrix.to_3x3()
        return (fore.inverted() @ self.pb[name].matrix.to_3x3()).to_quaternion()

    def set_wrist_local(self, name, q):
        """設定手相對前臂的轉動（前臂不動）。"""
        fore = self.pb[name.replace("hand", "forearm")].matrix.to_3x3()
        self.place(name, self.pb[name].head.copy(), fore @ q.to_matrix())

    def distribute_twist(self, share=TWIST_SHARE):
        """骨架沒有前臂扭轉骨，手繞前臂軸的扭轉全落在手腕會像糖果紙一樣扭；
        把其中 share 比例改由前臂繞自己的軸轉（手肘、手腕位置不變），手的方向維持原樣。"""
        y = V((0, 1, 0))
        for sfx in (".R", ".L"):
            hand, fore = "hand" + sfx, "forearm" + sfx
            q = self.wrist_local(hand)
            swing = y.rotation_difference(q @ y)
            tw = swing.inverted() @ q                    # 繞骨頭軸的扭轉
            angle = 2 * math.atan2(tw.y, tw.w)
            # 取最接近上一格的角度（差 360 度是同一個方向）：扭轉接近 180 度時才不會跳到另一邊，
            # 否則前臂分到的扭轉會在一格內翻轉將近 180 度（看起來像手腕翻一下）
            prev = self._prevtw.get(sfx, 0.0)
            angle += 2 * math.pi * round((prev - angle) / (2 * math.pi))
            self._prevtw[sfx] = angle
            if abs(angle) < 1e-4:
                continue
            m_hand = self.pb[hand].matrix.to_3x3()
            self.pb[fore].rotation_quaternion = self.pb[fore].rotation_quaternion @ Quaternion(y, angle * share)
            self._upd()
            self.place(hand, self.pb[hand].head.copy(), m_hand)

    def key(self, frame, ball_loc, ball_scale=1.0):
        self.distribute_twist()
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


def hermite(y0, y1, m0, m1, s):
    """三次 Hermite 曲線：s 從 0 到 1，兩端位置 y0、y1，兩端斜率 m0、m1（以 s 為單位）。"""
    return ((2 * s ** 3 - 3 * s * s + 1) * y0 + (s ** 3 - 2 * s * s + s) * m0
            + (3 * s * s - 2 * s ** 3) * y1 + (s ** 3 - s * s) * m1)


def hermite_fit(y0, y1, n, d0, d1):
    """找 Hermite 斜率 (m0, m1)，讓 n 格的曲線第 1 格位移 d0、最後一格位移 d1（d0 為 None 時 m0 = 0）。
    關鍵影格之間是直線內插，所以要對齊的是「一格的位移」而不是曲線端點的斜率。"""
    a = 1 / n
    h10 = lambda s: s ** 3 - 2 * s * s + s
    h11 = lambda s: s ** 3 - s * s
    base = lambda s: (2 * s ** 3 - 3 * s * s + 1) * y0 + (3 * s * s - 2 * s ** 3) * y1
    e1 = (y1 - d1) - base(1 - a)                         # 倒數第 1 格的位置
    if d0 is None:
        return 0.0, e1 / h11(1 - a)
    e0 = (y0 + d0) - base(a)                             # 第 1 格的位置
    # [h10(a) h11(a); h10(1-a) h11(1-a)] [m0 m1] = [e0 e1]
    A, B, C, D = h10(a), h11(a), h10(1 - a), h11(1 - a)
    det = A * D - B * C
    return (e0 * D - B * e1) / det, (A * e1 - C * e0) / det


def smooth_pts(t, pts):
    """每段各自緩入緩出：每個關鍵點都會停一下。適合「到位後停住」的動作。"""
    for (t0, v0), (t1, v1) in zip(pts, pts[1:]):
        if t0 <= t <= t1:
            return v0 + (v1 - v0) * ease((t - t0) / (t1 - t0))
    return pts[-1][1]


def spline_pts(t, pts):
    """經過各關鍵點的平滑曲線：中間的點不停頓，只有頭尾速度為 0。適合一口氣做完的動作（例如放下手臂）。"""
    if t <= pts[0][0]:
        return pts[0][1]
    if t >= pts[-1][0]:
        return pts[-1][1]
    i = max(k for k in range(len(pts) - 1) if pts[k][0] <= t)
    (t0, v0), (t1, v1) = pts[i], pts[i + 1]
    h = t1 - t0

    def slope(k):                                        # 前後兩點的斜率；頭尾為 0
        if k == 0 or k == len(pts) - 1:
            return v0 * 0
        return (pts[k + 1][1] - pts[k - 1][1]) / (pts[k + 1][0] - pts[k - 1][0])

    return hermite(v0, v1, slope(i) * h, slope(i + 1) * h, (t - t0) / h)


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
    P.hinge_roll[".L"] = HINGE_ROLL_L
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
         (18, V((0, 0.00, 0.14)), (-0.02, 0.0, 0.0), -0.12, V((-0.07, -0.21, 2.06)), V((-0.07, -0.14, 1.92)), V((0.06, -0.21, 2.03)), V((0, -0.3, 1)), 0.14, V((-0.12, -1.0, 0.0)), V((0.7, -0.2, -0.4))),
         # 出手後左手由 drop_left 直接放下，這裡的左手欄位為 None
         (21, V((0, 0.00, 0.10)), (0.00, 0.0, 0.0), -0.08, V((-0.07, -0.21, 2.06)), V((-0.08, -0.30, 1.88)), None, V((0, -1, -0.6)), 0.10, V((-0.12, -1.0, 0.0)), None),
         # 落地屈膝，右手仍伸在前上方（收尾停留）
         (24, V((0, -0.01, -0.10)), (0.03, 0.02, 0.01), -0.02, V((-0.07, -0.21, 2.06)), V((-0.09, -0.36, 1.64)), None, V((0, -1, -0.6)), 0.0, V((-0.12, -1.0, 0.0)), None),
         (28, V((0, -0.02, -0.12)), (0.04, 0.03, 0.01), 0.02, V((-0.07, -0.21, 2.06)), V((-0.11, -0.38, 1.56)), None, V((0, -1, -0.5)), 0.0, V((-0.15, -0.8, -0.3)), None),
         # 放下右手：手腕沿身體前方往下劃弧（手臂接近伸直），手肘經過朝下再轉回朝後
         (31, V((0, -0.01, -0.07)), (0.02, 0.01, 0.0), 0.04, V((-0.07, -0.21, 2.06)), V((-0.21, -0.36, 1.10)), None, V((0, -0.5, -1)), 0.0, V((-0.3, -0.3, -1.0)), None),
         # 結束：和 Idle 一樣站直、雙手垂在大腿外側
         (SHOOT_END, V((0, 0, -0.012)), (0.0, 0.0, 0.0), 0.02, V((-0.07, -0.21, 2.06)), V((-0.215, -0.03, 0.85)), V((0.215, -0.03, 0.85)), V((0, 0, -1)), 0.0, V((-0.35, 1.0, -0.25)), V((0.35, 1.0, -0.25)))]

    def interp(f):
        """出手前每段緩入緩出（各姿勢到位）；出手後用平滑曲線一口氣收回，中途不停頓。"""
        if f > SHOOT_RELEASE_FRAME:
            ks = [k for k in K if k[0] >= SHOOT_RELEASE_FRAME]
            sp = lambda i: spline_pts(f, [(k[0], k[i]) for k in ks if k[i] is not None])
            lean = spline_pts(f, [(k[0], V(k[2])) for k in ks])
            return (sp(1), tuple(lean), sp(3), sp(4), sp(5), sp(6), sp(7), smooth_pts(f, [(k[0], k[8]) for k in ks]),
                    sp(9), sp(10))
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
    B_release = release_axes = end_axes = release_L = palm_off = end_R = hold_R = rel_dL = None
    restR, restL = P.ankle_rest(".R"), P.ankle_rest(".L")

    def stance(f):                                       # 運球站姿 → 投籃站姿；空中換成 Idle 站姿，落地後腳不再移動
        w1, w2 = min(1.0, f / 6.0), ease(min(1.0, max(0.0, (f - 14) / 8)))
        return aR0.lerp(aRs, w1).lerp(restR, w2), aL0.lerp(aLs, w1).lerp(restL, w2)

    # 先擺出結束姿勢（Idle），記下雙手方向，收尾時轉回這裡
    hd, ln, ht, bl, wR, wL, hR, lift, pR, pL = interp(SHOOT_END)
    P.pose("S_end", hd, ln, ht, wR + Z, wL + Z, restR, restL, poleR=pR, poleL=pL)
    end_dL, end_pL = wL + Z - P.pb["upper_arm.L"].head, pL
    rel_pL = K[[k[0] for k in K].index(SHOOT_RELEASE_FRAME)][10]
    end_axes = hand_axes()
    end_R, palm_off = P.wrist_local("hand.R"), -P.pb["hand.L"].matrix.to_3x3().col[2] - natural_palm(P)   # 結束時剛好等於 Idle
    for f in range(SHOOT_END + 1):
        hd, ln, ht, bl, wR, wL, hR, lift, pR, pL = interp(f)
        aR, aL = stance(f)
        aR, aL = aR + V((0, 0, lift)), aL + V((0, 0, lift))
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
        if f > SHOOT_RELEASE_FRAME:                      # 身體擺好後，左手以肩膀為圓心直接放下
            wristL, pL = drop_left(P, f, SHOOT_RELEASE_FRAME, SHOOT_END, rel_dL, end_dL, rel_pL, end_pL)
            do_pose(wristL)
            g = f - SHOOT_RELEASE_FRAME
            if g <= 10:                                  # 壓腕並停留（世界方向）
                d, n = flick(f, release_axes, end_axes)
                P.palm("hand.R", d, n)
                hold_R = P.wrist_local("hand.R")
            else:                                        # 手臂收回時，手腕相對前臂慢慢回到結束姿勢
                P.set_wrist_local("hand.R", slerp_short(hold_R, end_R, ease((g - 10) / (SHOOT_END - SHOOT_RELEASE_FRAME - 10))))
            relax_left(P, g, release_L, palm_off)
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
            release_L = P.wrist_local("hand.L")
            rel_dL = P.pb["hand.L"].head - P.pb["upper_arm.L"].head
        else:
            B = B_release                                # 出手後球停在出手位置，縮小消失時才不會掃過手
        P.key(f + 1, B, 1.0 if f <= SHOOT_RELEASE_FRAME else 0.0)


def gait(N, S, YF, YB, lift, toe):
    """原地步態的單腳循環。N：一個循環的影格數；S：著地佔的比例；YF、YB：腳最前、最後的位置；
    lift：擺動時腳抬多高；toe：擺動時腳尖下壓的最大弧度。回傳 (foot_cycle, 推動速度 m/s)。
    著地時腳以固定速度往後移，遊戲以同樣速度推動角色，腳才不會打滑。
    擺動腳的前後位置用 Hermite 曲線：離地時接著著地的往後速度，落地前一格也已經用著地速度往後收，
    這樣最後一格落地時腳相對地面不動（推動角色時不會往前滑）。M 由「落地前一格」的位置反推。"""
    K_ST = -(1 - S) / S                                  # 著地時的速度（以擺動進度為單位）
    DS = (1 / N) / (1 - S)                               # 一格對應的擺動進度
    s_last = 1 - DS
    M = (1 - K_ST * DS - (3 * s_last ** 2 - 2 * s_last ** 3)) / (2 * s_last ** 3 - 3 * s_last ** 2 + s_last)

    def foot_cycle(ph, base):
        if ph < S:
            return base + V((0, YF + (YB - YF) * (ph / S), 0)), 0.0
        s = (ph - S) / (1 - S)
        h = 3 * s * s - 2 * s ** 3 + M * (2 * s ** 3 - 3 * s * s + s)
        return base + V((0, YB + (YF - YB) * h, lift * math.sin(math.pi * s) ** 0.8)), toe * math.sin(math.pi * s)

    return foot_cycle, (YB - YF) / (S * N / FPS)


def make_sprint(P):
    """運球衝刺：12 格跑兩步、運球一次。原地循環，地面上的腳以固定速度往後移。"""
    global SPRINT_SPEED
    P.new_action("Sprint")
    Z = P.Z
    N, S, YF, YB = 12, 0.40, -0.30, 0.30                 # 影格數、著地比例、腳最前與最後的位置

    foot_cycle, speed = gait(N, S, YF, YB, lift=0.20, toe=0.45)

    HZs = [(0.0, 0.97), (0.2, 0.86), (0.55, 1.00), (0.85, 1.00), (1.0, 0.97)]
    T_PUSH, T_FLOOR = 0.2, 7 / 12                        # 落地放在整數影格（第 7 格）

    def pose_at(t):
        aR, rR = foot_cycle(t % 1.0, P.ankle_rest(".R") + V((0.02, 0, 0)))
        aL, rL = foot_cycle((t + 0.5) % 1.0, P.ankle_rest(".L") + V((-0.02, 0, 0)))
        swing = math.cos(2 * math.pi * t)
        P.pose(f"R{t:.3f}", V((0, -0.04, -0.10 + 0.02 * math.sin(4 * math.pi * t))), (0.16, 0.08, 0.03), -0.12,
               V((-0.28, -0.40, smooth_pts(t, HZs))) + Z, V((0.26, -0.20 * swing, 1.00 - 0.05 * swing)) + Z,
               aR, aL, handR_dir=V((0, -1.0, -0.3)), poleL=V((0.3, 1.0, -0.3)), footR=rR, footL=rL, twist=0.06 * swing)
        P.palm_inward(".L")                              # 沒持球的手掌心朝身體

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
    SPRINT_SPEED = MOVE_SPEEDS["Sprint"] = speed


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

        P.hold_two(B, *GRIP_TT, pose_fn)
        P.key(f + 1, B)


def make_dribble_walk(P):
    """運球走：24 格（1 秒）走兩步、右手運球一次。原地循環，遊戲以 MOVE_SPEEDS["DribbleWalk"] 推動。
    走路有雙腳著地期（著地佔 60%），身體在雙腳著地時最低。"""
    P.new_action("DribbleWalk")
    Z = P.Z
    N = 24
    foot_cycle, speed = gait(N, 0.60, -0.31, 0.31, lift=0.07, toe=0.25)
    MOVE_SPEEDS["DribbleWalk"] = speed
    HZ = [(0.0, 0.98), (0.25, 0.86), (0.60, 1.00), (0.85, 1.00), (1.0, 0.98)]   # 右手腕高度（同 Dribble）
    BX, BY = -0.30, -0.40
    T_PUSH, T_FLOOR = 0.25, 13 / 24

    def pose_at(t):
        aR, rR = foot_cycle(t % 1.0, P.ankle_rest(".R") + V((0.01, 0, 0)))
        aL, rL = foot_cycle((t + 0.5) % 1.0, P.ankle_rest(".L") + V((-0.01, 0, 0)))
        c = math.cos(2 * math.pi * t)
        P.pose(f"W{t:.3f}", V((0.008 * math.sin(2 * math.pi * t), -0.03, -0.09 - 0.012 * math.cos(4 * math.pi * t))),
               (0.10, 0.07, 0.03), 0.04,
               V((BX, -0.34, smooth_pts(t, HZ))) + Z, V((0.26, -0.06 - 0.12 * c, 0.93 + 0.03 * c)) + Z,
               aR, aL, handR_dir=V((0, -1.0, -0.25)), poleL=V((0.3, 1.0, -0.3)), footR=rR, footL=rL, twist=0.05 * c)
        P.palm_inward(".L")                              # 沒持球的手掌心朝身體

    def held():
        return P.seat(V((BX, BY, 0.8)) + Z, V((0, 0, -1))).z - Z.z

    pose_at(0.0)
    z0 = held()
    pose_at(T_PUSH)
    z1 = held()
    for f in range(N + 1):
        t = f / N
        pose_at(t)
        if t <= T_PUSH:
            zb = held()
        elif t <= T_FLOOR:
            s = (t - T_PUSH) / (T_FLOOR - T_PUSH)
            zb = z1 - (z1 - P.floor) * s * s
        else:
            u = (t - T_FLOOR) / (1 - T_FLOOR)
            zb = P.floor + (z0 - P.floor) * (1 - (1 - u) ** 2)
        P.key(f + 1, V((BX, BY, zb)) + Z)


def make_run(P, name, N, S, Y, lift, toe, hips_z, bob, lean, head, arm_y, arm_z):
    """無球跑步（原地循環）：N 格跑兩步；S 著地比例；Y 腳前後最遠距離；bob 身體上下起伏；
    arm_y、arm_z 手臂前後擺動幅度與擺到前方時抬高多少。球縮放為 0。"""
    P.new_action(name)
    Z = P.Z
    foot_cycle, speed = gait(N, S, -Y, Y, lift=lift, toe=toe)
    MOVE_SPEEDS[name] = speed
    for f in range(N + 1):
        t = f / N
        aR, rR = foot_cycle(t % 1.0, P.ankle_rest(".R") + V((0.02, 0, 0)))
        aL, rL = foot_cycle((t + 0.5) % 1.0, P.ankle_rest(".L") + V((-0.02, 0, 0)))
        c = math.cos(2 * math.pi * t)                     # 右腳在前（t=0）時右手在後
        mid = math.cos(4 * math.pi * (t - S / 2))         # 著地中段身體最低
        P.pose(f"{name}{f}", V((0, -0.03, hips_z - bob * mid)), lean, head,
               V((-0.24, -0.06 + arm_y * c, 1.00 + arm_z * min(0.0, c))) + Z,
               V((0.24, -0.06 - arm_y * c, 1.00 + arm_z * min(0.0, -c))) + Z,
               aR, aL, poleR=V((-0.3, 1.0, -0.4)), poleL=V((0.3, 1.0, -0.4)), footR=rR, footL=rL, twist=0.05 * c)
        P.palm_inward(".R")                              # 跑步時掌心朝身體
        P.palm_inward(".L")
        P.key(f + 1, V((-0.30, -0.40, 0.80)) + Z, 0.0)


STOP_LAND, STOP_BRAKE, STOP_END = 8, 12, 18             # 急停：雙腳落地、煞停、結束（三威脅）的影格


def make_stop_jump(P):
    """急停（單次 18 格）：從 Sprint 第 0 格開始，右手用力把球往下拍（第 4 格落地），右腳蹬地小跳，
    第 8 格雙腳同時落地、第 9 格雙手接球，第 8～12 格腳踩住地面煞停，第 18 格接到 TripleThreat 第 0 格。
    原地動作：遊戲推動速度第 8 格前維持 Sprint 速度，第 8～12 格線性降到 0（見 STOP_* 與 MOVE_SPEEDS）。"""
    P.new_action("StopJump")
    Z = P.Z
    v0 = SPRINT_SPEED                                    # 縮放前 3.0 m/s
    brake = v0 * (STOP_BRAKE - STOP_LAND) / FPS / 2      # 煞停期間身體前進（腳往後移）的距離
    sprint_cycle, _ = gait(12, 0.40, -0.30, 0.30, lift=0.20, toe=0.45)
    baseR = P.ankle_rest(".R") + V((0.02, 0, 0))
    baseL = P.ankle_rest(".L") + V((-0.02, 0, 0))
    aR0, rR0 = sprint_cycle(0.0, baseR)
    aL0, rL0 = sprint_cycle(0.5, baseL)
    aR_tt = P.ankle_rest(".R") + V((-0.10, 0.07, 0))     # 三威脅站姿（同 make_triple_threat）
    aL_tt = P.ankle_rest(".L") + V((0.10, -0.07, 0))
    PUSH = 3                                             # 右腳蹬地離開的影格
    aR_push = aR0 + V((0, v0 * PUSH / FPS, 0))

    def feet(f):
        """回傳 (右踝, 左踝, 右腳尖下壓, 左腳尖下壓)。"""
        land = lambda a: a - V((0, brake, 0))           # 落地點比最後站姿前面 brake
        if f >= STOP_LAND:
            u = min(1.0, (f - STOP_LAND) / (STOP_BRAKE - STOP_LAND))
            k = brake * (1 - (1 - u) ** 2)               # 速度線性降到 0
            return land(aR_tt) + V((0, k, 0)), land(aL_tt) + V((0, k, 0)), 0.0, 0.0
        # 空中的腳前後用 Hermite 曲線：蹬地與落地時都以身體速度往後移（相對地面不動），才不會滑
        def air(a0, a1, s, m0, m1, lift):
            y = hermite(a0.y, a1.y, m0, m1, s)
            p = a0.lerp(a1, ease(s))
            return V((p.x, y, p.z + lift * math.sin(math.pi * s)))
        if f <= PUSH:
            aR, rR = aR0 + V((0, v0 * f / FPS, 0)), 0.0
        else:
            s = (f - PUSH) / (STOP_LAND - PUSH)
            m0, m1 = hermite_fit(aR_push.y, land(aR_tt).y, STOP_LAND - PUSH, v0 / FPS, v0 / FPS)
            aR, rR = air(aR_push, land(aR_tt), s, m0, m1, 0.10), 0.30 * math.sin(math.pi * s)
        s = f / STOP_LAND
        m0, m1 = hermite_fit(aL0.y, land(aL_tt).y, STOP_LAND, None, v0 / FPS)
        aL = air(aL0, land(aL_tt), s, m0, m1, 0.04)
        return aR, aL, rR, rL0 * (1 - ease(s))

    # 身體：影格 → (臀部位移, 前傾, 頭, 轉身)
    hipsK = [(0, V((0, -0.04, -0.10))), (PUSH, V((0, -0.04, -0.14))), (6, V((0, -0.02, -0.05))),
             (STOP_LAND, V((0, 0.02, -0.25))), (STOP_BRAKE, V((0, 0.03, -0.23))), (STOP_END, V((0, 0.02, -0.19)))]
    leanK = [(0, V((0.16, 0.08, 0.03))), (6, V((0.10, 0.05, 0.02))), (STOP_LAND, V((0.18, 0.10, 0.05))),
             (STOP_BRAKE, V((0.16, 0.10, 0.05))), (STOP_END, V((0.14, 0.10, 0.05)))]
    headK = [(0, -0.12), (6, -0.10), (STOP_LAND, -0.26), (STOP_END, -0.22)]
    twistK = [(0, 0.06), (6, 0.0), (STOP_END, 0.0)]

    def body(f):
        return smooth_pts(f, hipsK), tuple(smooth_pts(f, leanK)), smooth_pts(f, headK), smooth_pts(f, twistK)

    # 球：第 0～2 格右手往下拍、第 4 格落地、第 9 格雙手接住、之後移到三威脅的位置
    RELEASE, BOUNCE, CATCH = 2, 4, 9
    B_tt = V((-0.22, -0.25, 0.96)) + Z
    B_catch = V((-0.12, -0.33, 0.98)) + Z
    sR_dir, dR_dir, sL_dir, dL_dir = GRIP_TT
    HZ = [(0, 0.97), (RELEASE, 0.78), (5, 0.92), (STOP_END, 0.92)]

    def pose_free(f, wR, wL):
        hd, ln, ht, tw = body(f)
        aR, aL, rR, rL = feet(f)
        k = ease(min(1.0, max(0.0, (f - 6) / (STOP_END - 6))))   # 手肘方向從 Sprint 換成三威脅
        P.pose(f"J{f}", hd, ln, ht, wR, wL, aR, aL, handR_dir=V((0, -1.0, -0.3)),
               poleR=V((-0.35, 1.0, -0.25)).lerp(V((-0.6, 0.8, -0.3)), k),
               poleL=V((0.3, 1.0, -0.3)).lerp(V((0.6, 0.6, -0.6)), k), footR=rR, footL=rL, twist=tw)
        P.palm_inward(".L")                              # 同 Sprint：左手掌心朝身體，接球前再轉向球

    def catch_wrists(B, margin):                         # 雙手張開在球兩側，離球面 margin
        reach = R_BALL / P.s + PALM_T + margin
        sR, sL = sR_dir.normalized(), sL_dir.normalized()
        dR = (dR_dir - sR * dR_dir.dot(sR)).normalized()
        dL = (dL_dir - sL * dL_dir.dot(sL)).normalized()
        return B + sR * reach - dR * PALM_A, B + sL * reach - dL * PALM_A, (sR, dR, sL, dL)

    wR0 = V((-0.28, -0.40, 0.97)) + Z
    wL0 = V((0.26, -0.20, 0.95)) + Z
    zr = None
    for f in range(STOP_END + 1):
        if f <= RELEASE:                                 # 右手壓著球往下推
            wR = V((-0.28, -0.40, smooth_pts(f, HZ))) + Z
            pose_free(f, wR, wL0.lerp(catch_wrists(B_catch, 0.10)[1], ease(f / CATCH)))
            B = P.seat(V((-0.28, -0.46, 0.8)) + Z, V((0, 0, -1)))
            zr = B.z
            P.key(f + 1, B)
            continue
        if f < CATCH:                                    # 球在空中：雙手在接球點張開等球
            s = (f - RELEASE) / (CATCH - RELEASE)
            if f <= BOUNCE:
                u = (f - RELEASE) / (BOUNCE - RELEASE)
                z = zr - (zr - (P.floor + Z.z)) * u * u
            else:
                tau, te = (f - BOUNCE) / FPS, (CATCH - BOUNCE) / FPS
                vz = ((B_catch.z - P.floor - Z.z) + 4.9 * te * te) / te
                z = P.floor + Z.z + vz * tau - 4.9 * tau * tau
            B = V((-0.28, -0.46, 0)).lerp(B_catch.to_2d().to_3d(), ease(s)) + V((0, 0, z))
            cR, cL, axes = catch_wrists(B_catch, 0.10 * (CATCH - f) / (CATCH - RELEASE))   # 雙手在接球點等球彈上來
            w = ease(min(1.0, (f - RELEASE) / 3))
            pose_free(f, wR0.lerp(cR, w), wL0.lerp(cL, ease(f / CATCH)))
            sR, dR, sL, dL = axes
            P.palm("hand.R", dR, -sR, w)
            P.palm("hand.L", dL, -sL, ease(f / CATCH))
            P.key(f + 1, B)
            continue
        s = (f - CATCH) / (STOP_END - CATCH)             # 接住後移到三威脅位置
        B = B_catch.lerp(B_tt, ease(s))
        P.hold_two(B, sR_dir, dR_dir, sL_dir, dL_dir, lambda wR, wL: pose_free(f, wR, wL))
        P.key(f + 1, B)
    MOVE_SPEEDS["StopJump"] = v0                         # 第 STOP_LAND 格前的推動速度；之後見 STOP_*


SET_RELEASE, SET_END = 14, 30


def flick_axes(rel, end, g, snap_frames=3, hold_until=7, turn_frames=6, snap_deg=150):
    """出手後的壓腕：只繞手腕屈曲軸（手指往掌心那側）轉，不繞前臂扭轉。
    rel、end：出手時與結束時的（手指方向, 掌心方向）；g：出手後第幾格。
    前 snap_frames 格快速壓腕約 snap_deg 度，維持到 hold_until，之後 turn_frames 格轉到結束姿勢的角度。"""
    d0, n0 = rel
    a = d0.cross(n0).normalized()
    de = end[0] - a * end[0].dot(a)
    th_end = math.atan2(d0.cross(de).dot(a), d0.dot(de)) % (2 * math.pi)
    th_snap = min(math.radians(snap_deg), th_end)
    th = th_snap * ease(min(1.0, g / snap_frames)) + \
        (th_end - th_snap) * ease(min(1.0, max(0.0, (g - hold_until) / turn_frames)))
    rot = Matrix.Rotation(th, 3, a)
    return rot @ d0, rot @ n0


def natural_palm(P, sfx=".L"):
    """手放鬆時的掌心方向：垂直於手臂彎曲的平面、朝身體那側（手垂下時朝大腿，前臂水平時拇指朝上）。
    IK 的骨頭扭轉是「從靜止姿勢轉最少」，和手臂的實際彎曲無關，不能拿來決定掌心。"""
    S, E, W = (P.pb[n + sfx].head for n in ("upper_arm", "forearm", "hand"))
    u = (W - S).normalized()
    p = (E - S) - u * (E - S).dot(u)                     # 手肘偏離肩到手腕連線的方向
    n = p.normalized().cross(u)
    return n if sfx == ".L" else -n                      # 右手是鏡像


def turn_hand(P, sfx, rel_q, direction, toward, k):
    """手轉向「手指朝 direction、掌心朝 toward」：從 rel_q（相對前臂的轉動）轉過去 k（0～1）。"""
    P.palm("hand" + sfx, direction, toward)
    P.set_wrist_local("hand" + sfx, slerp_short(rel_q, P.wrist_local("hand" + sfx), k))


def relax_left(P, g, rel_L, palm_off):
    """出手後第 g 格的左手：手指順著前臂、掌心朝 natural_palm（加上 palm_off 讓結束時剛好等於 Idle），
    從出手時相對前臂的轉動在 LEFT_RELAX 格內轉過去（太慢會一直維持扶球的方向，手臂放下時像手掌外翻）。
    不能只把手腕轉回和 Idle 相同的相對轉動：手臂放下途中前臂會被 IK 帶著轉，掌心會朝外。"""
    turn_hand(P, ".L", rel_L, P.pb["forearm.L"].matrix.col[1].to_3d(), natural_palm(P) + palm_off,
              ease(min(1.0, g / LEFT_RELAX)))


def follow_through(P, g, total, hold, rel_axes, end_axes, end_R, rel_L, palm_off, state, snap_deg=150):
    """出手後第 g 格（共 total 格）：右手先壓腕（世界方向）停留到 hold，之後手腕相對前臂轉回結束姿勢；
    左手見 relax_left。state 用來記住停留結束時的手腕轉動。"""
    if g <= hold:
        d, n = flick_axes(rel_axes, end_axes, g, hold_until=total, snap_deg=snap_deg)
        P.palm("hand.R", d, n)
        state["hold_R"] = P.wrist_local("hand.R")
    else:
        P.set_wrist_local("hand.R", slerp_short(state["hold_R"], end_R, ease((g - hold) / (total - hold))))
    relax_left(P, g, rel_L, palm_off)


DROP_MID = V((0.40, -0.50, -0.77)).normalized()   # 左手放下途中，手腕相對肩膀的方向：身體前側偏外、斜下方


def drop_left(P, f, f0, f1, d0, d1, pole0, pole1):
    """出手後扶球的左手直接放下（第 f0 格出手、第 f1 格到結束姿勢），中途不停留、不往旁邊甩。
    以肩膀為圓心：手腕相對肩膀的方向從出手時（d0）經身體前側（DROP_MID）轉到結束時（d1），
    不會貼著臉直直掉下來；手肘從朝外經過朝下再轉回朝後。
    d0、d1 是手腕相對 upper_arm.L 起點的位置。呼叫前要先擺好第 f 格的身體（肩膀位置），回傳 (手腕位置, 手肘方向)。"""
    dirs = [(0, d0.normalized()), (0.5, DROP_MID), (1, d1.normalized())]
    lens = [(0, d0.length), (0.5, d1.length), (1, d1.length)]   # 途中手臂和 Idle 一樣微彎（彎太多像端盤子、打直太僵）
    # 曲線依轉過的角度重新取參數，整段以緩入緩出的速度轉完（直接用關鍵點時間，中途會忽快忽慢）
    n = 64
    us = [spline_pts(i / n, dirs).normalized() for i in range(n + 1)]
    cum = [0.0]
    for a, b in zip(us, us[1:]):
        cum.append(cum[-1] + a.angle(b))
    target = ease((f - f0) / (f1 - f0)) * cum[-1]
    i = min(n - 1, max(k for k in range(n) if cum[k] <= target))
    s = (i + (target - cum[i]) / max(1e-9, cum[i + 1] - cum[i])) / n
    u = spline_pts(s, dirs).normalized()
    fm = (f0 + f1) / 2
    return (P.pb["upper_arm.L"].head + u * spline_pts(s, lens),
            spline_pts(f, [(f0, pole0), (fm, V((0.3, -0.3, -1.0))), (f1, pole1)]))


def make_set_shot(P):
    """定點投籃（單次 30 格）：從 TripleThreat 第 0 格開始，屈膝收球 → 球舉到額頭前上方 → 伸膝伸手，
    第 14 格出手（雙腳不離地）→ 壓腕停留 → 雙手放下、站直。出手後球縮放為 0。"""
    P.new_action("SetShot")
    P.hinge_roll[".L"] = HINGE_ROLL_L
    Z = P.Z
    aR = P.ankle_rest(".R") + V((-0.10, 0.07, 0))       # 三威脅站姿，整段腳不動
    aL = P.ankle_rest(".L") + V((0.10, -0.07, 0))
    grip_tt = GRIP_TT
    grip_shot = (V((0.05, 0.45, -0.89)), V((0, 0.9, 0.45)), V((1.0, -0.1, 0.05)), V((0, -0.1, 1.0)))
    # 影格, 臀部位移, 前傾, 頭, 球心, 右手腕, 左手腕（出手後才用手腕；出手前由 hold_two 依球決定）
    K = [(0, V((0, 0.02, -0.19)), V((0.14, 0.10, 0.05)), -0.22, V((-0.22, -0.25, 0.96)), None, None),
         (5, V((0, 0.02, -0.25)), V((0.10, 0.06, 0.03)), -0.14, V((-0.10, -0.27, 1.06)), None, None),
         (10, V((0, 0.00, -0.13)), V((0.02, 0.00, 0.00)), -0.10, V((-0.07, -0.20, 1.70)), None, None),
         (SET_RELEASE, V((0, 0.00, -0.03)), V((-0.02, 0.0, 0.0)), -0.12, V((-0.07, -0.22, 1.93)), None, None),
         (17, V((0, 0.00, -0.04)), V((0.0, 0.0, 0.0)), -0.10, None, V((-0.09, -0.32, 1.74)), None),
         (21, V((0, 0.00, -0.05)), V((0.0, 0.0, 0.0)), -0.08, None, V((-0.10, -0.34, 1.70)), None),
         # 放下右手：手腕沿身體前方往下劃弧（手臂接近伸直），不從胸前直線收回（左手由 drop_left 直接放下）
         (26, V((0, 0.00, -0.04)), V((0.01, 0.0, 0.0)), -0.03, None, V((-0.20, -0.38, 1.08)), None),
         (SET_END, V((0, 0, -0.012)), V((0.0, 0.0, 0.0)), 0.02, None, V((-0.215, -0.03, 0.85)), V((0.215, -0.03, 0.85)))]
    pick = lambda i: [(k[0], k[i]) for k in K if k[i] is not None]
    hipsK, leanK, headK, ballK, wRK, wLK = pick(1), pick(2), pick(3), pick(4), pick(5), pick(6)

    poleLK = [(0, V((0.6, 0.6, -0.6))), (10, V((0.7, -0.2, -0.4))), (SET_RELEASE, V((0.7, -0.2, -0.4)))]

    def pose_body(f, wR, wL, pL=None):
        pts = spline_pts if f > SET_RELEASE else smooth_pts   # 出手後一口氣收回，關鍵影格不停頓
        P.pose(f"P{f}", pts(f, hipsK), tuple(pts(f, leanK)), pts(f, headK), wR, wL, aR, aL,
               # 右手肘從朝後轉到朝前下方，中途經過朝外下方（直接內插會在中途接近 0 而突然翻轉）
               # 出手後放下手臂時手肘經過朝下再轉回朝後，手臂直直垂下（停在朝前或朝外會變成手叉腰）
               poleR=pts(f, [(0, V((-0.6, 0.8, -0.3))), (5, V((-0.9, 0.0, -0.5))), (10, V((-0.12, -1.0, -0.1))),
                                    (21, V((-0.12, -1.0, -0.1))), (26, V((-0.3, -0.3, -1.0))), (SET_END, V((-0.35, 1.0, -0.25)))]),
               poleL=pL if pL is not None else smooth_pts(f, poleLK))

    def hand_axes(name):
        m = P.pb[name].matrix.to_3x3()
        return m.col[1].copy(), -m.col[2].copy()

    end_pL = V((0.35, 1.0, -0.25))                         # 結束時左手肘和 Idle 一樣朝後
    pose_body(SET_END, wRK[-1][1] + Z, wLK[-1][1] + Z, end_pL)   # 先擺出結束姿勢，記下雙手方向
    end_dL = wLK[-1][1] + Z - P.pb["upper_arm.L"].head
    end_axes = hand_axes("hand.R")
    end_R, palm_off = P.wrist_local("hand.R"), -P.pb["hand.L"].matrix.to_3x3().col[2] - natural_palm(P)   # 結束時剛好等於 Idle
    state = {}
    B_rel = rel_R = rel_L = rel_wR = rel_wL = rel_dL = None
    for f in range(SET_END + 1):
        if f <= SET_RELEASE:
            B = smooth_pts(f, ballK) + Z
            w = ease(min(1.0, f / 6))                       # 握法從三威脅換成投籃（右手托在球後下方）
            g = [a.lerp(b, w) for a, b in zip(grip_tt, grip_shot)]
            P.hold_two(B, g[0], g[1], g[2], g[3], lambda wR, wL: pose_body(f, wR, wL))
            B_rel, rel_R = B, hand_axes("hand.R")
            rel_L = P.wrist_local("hand.L")
            rel_wR, rel_wL = P.pb["hand.R"].head.copy(), P.pb["hand.L"].head.copy()
            rel_dL = rel_wL - P.pb["upper_arm.L"].head
            P.key(f + 1, B)
            continue
        gf = f - SET_RELEASE
        # 出手後手腕從出手時的位置接到收尾的關鍵影格
        wR = spline_pts(f, [(SET_RELEASE, rel_wR)] + [(k, v + Z) for k, v in wRK])
        n = len(P.unreachable)                            # 先擺好身體（肩膀位置），左手再以肩膀為圓心放下；
        pose_body(f, wR, P.pb["hand.L"].head.copy())      # 這次預擺的左手只是暫放，搆不到不記錄
        del P.unreachable[n:]
        wL, pL = drop_left(P, f, SET_RELEASE, SET_END, rel_dL, end_dL, poleLK[-1][1], end_pL)
        pose_body(f, wR, wL, pL)
        follow_through(P, gf, SET_END - SET_RELEASE, 8, rel_R, end_axes, end_R, rel_L, palm_off, state)
        P.key(f + 1, B_rel + V((0, -4.5, 5.4)) * (gf / FPS), 0.0)   # 球沿出手方向飛走（隱藏），縮小時不會掃過手


LAY = dict(PUSH_R=5, PLANT_L=6, TAKEOFF=11, RELEASE=17, LAND=22, BRAKE=26, END=30)
LAY_AIR_SPEED = 2.0      # 縮放前；空中的水平速度


def make_layup(P):
    """上籃（單次 30 格）：從 Sprint 第 0 格接起。右腳那步雙手收球到右腰，左腳踩下、第 11 格左腳起跳，
    右膝上抬，右手托球往上，第 17 格（最高點）出手，第 22 格雙腳落地煞停，第 30 格站直。
    原地動作：起跳前以 Sprint 速度推動，空中 LAY_AIR_SPEED，落地後 4 格線性降到 0。"""
    L = LAY
    P.new_action("Layup")
    P.hinge_roll[".L"] = HINGE_ROLL_L
    Z = P.Z
    v0, va = SPRINT_SPEED, LAY_AIR_SPEED
    brake = va * (L["BRAKE"] - L["LAND"]) / FPS / 2
    cyc, _ = gait(12, 0.40, -0.30, 0.30, lift=0.20, toe=0.45)
    baseR = P.ankle_rest(".R") + V((0.02, 0, 0))
    baseL = P.ankle_rest(".L") + V((-0.02, 0, 0))
    aR0, _ = cyc(0.0, baseR)
    aL0, rL0 = cyc(0.5, baseL)
    endR, endL = P.ankle_rest(".R"), P.ankle_rest(".L")   # 落地後和 Idle 同樣站姿
    landR, landL = endR - V((0, brake, 0)), endL - V((0, brake, 0))
    aR_push = aR0 + V((0, v0 * L["PUSH_R"] / FPS, 0))
    aL_plant = baseL + V((0, -0.30, 0))
    aL_take = aL_plant + V((0, v0 * (L["TAKEOFF"] - L["PLANT_L"]) / FPS, 0))

    def jump(f):                                         # 起跳後身體與雙腳一起上升的高度（拋物線）
        if not L["TAKEOFF"] <= f <= L["LAND"]:
            return 0.0
        s = (f - L["TAKEOFF"]) / (L["LAND"] - L["TAKEOFF"])
        return 4 * 0.26 * s * (1 - s)

    def air(a0, a1, f0, f1, d0, d1, f, bump):           # 空中的腳：蹬地、落地那一格都對齊身體速度
        n = f1 - f0
        s = (f - f0) / n
        m0, m1 = hermite_fit(a0.y, a1.y, n, d0, d1)
        p = a0.lerp(a1, ease(s))
        return V((p.x, hermite(a0.y, a1.y, m0, m1, s), p.z + bump * math.sin(math.pi * s)))

    def feet(f):
        J = V((0, 0, jump(f)))
        if f >= L["LAND"]:
            u = min(1.0, (f - L["LAND"]) / (L["BRAKE"] - L["LAND"]))
            k = V((0, brake * (1 - (1 - u) ** 2), 0))
            return landR + k, landL + k, 0.0, 0.0
        if f <= L["PUSH_R"]:                             # 右腳：著地往後 → 離地抬膝 → 落地
            aR, rR = aR0 + V((0, v0 * f / FPS, 0)), 0.0
        else:
            aR = air(aR_push, landR, L["PUSH_R"], L["LAND"], v0 / FPS, va / FPS, f, 0.30) + J
            rR = 0.40 * math.sin(math.pi * (f - L["PUSH_R"]) / (L["LAND"] - L["PUSH_R"]))
        if f <= L["PLANT_L"]:                            # 左腳：擺到前面踩下 → 著地往後 → 起跳 → 落地
            aL = air(aL0, aL_plant, 0, L["PLANT_L"], None, v0 / FPS, f, 0.03)
            rL = rL0 * (1 - ease(f / L["PLANT_L"]))
        elif f <= L["TAKEOFF"]:
            aL, rL = aL_plant + V((0, v0 * (f - L["PLANT_L"]) / FPS, 0)), 0.0
        else:
            aL = air(aL_take, landL, L["TAKEOFF"], L["LAND"], v0 / FPS, va / FPS, f, 0.10) + J
            rL = 0.35 * math.sin(math.pi * (f - L["TAKEOFF"]) / (L["LAND"] - L["TAKEOFF"]))
        return aR, aL, rR, rL

    hipsK = [(0, V((0, -0.04, -0.10))), (L["PUSH_R"], V((0, -0.03, -0.15))), (9, V((0, -0.02, -0.21))),
             (L["TAKEOFF"], V((0, -0.03, -0.12))), (L["RELEASE"], V((0, -0.02, -0.02))), (L["LAND"], V((0, 0.0, -0.20))),
             (L["BRAKE"], V((0, 0.01, -0.15))), (L["END"], V((0, 0.0, -0.012)))]
    leanK = [(0, V((0.16, 0.08, 0.03))), (L["PUSH_R"], V((0.14, 0.08, 0.04))), (L["TAKEOFF"], V((0.10, 0.05, 0.02))),
             (L["RELEASE"], V((-0.02, 0.0, 0.0))), (L["LAND"], V((0.14, 0.06, 0.03))), (L["END"], V((0.0, 0.0, 0.0)))]
    headK = [(0, -0.12), (L["TAKEOFF"], -0.10), (L["RELEASE"], -0.20), (L["LAND"], -0.05), (L["END"], 0.02)]
    twistK = [(0, 0.06), (L["PUSH_R"], 0.0), (L["END"], 0.0)]
    # 右手肘：運球朝後 → 收球朝外下 → 托球朝前下 → 落地後放鬆朝後（中途不經過 0，免得翻轉）
    poleRK = [(0, V((-0.35, 1.0, -0.25))), (6, V((-0.6, 0.8, -0.3))), (11, V((-0.9, 0.0, -0.5))),
              (L["RELEASE"], V((-0.12, -1.0, -0.1))), (L["LAND"], V((-0.3, -0.3, -1.0))), (L["END"], V((-0.35, 1.0, -0.25)))]
    poleLK = [(0, V((0.3, 1.0, -0.3))), (8, V((0.6, 0.4, -0.6))), (13, V((0.7, -0.2, -0.4))),
              (L["RELEASE"], V((0.7, -0.2, -0.4)))]       # 出手後由 drop_left 決定
    end_pL = V((0.35, 1.0, -0.25))                       # 結束和 Idle 一樣朝後

    def pose_body(f, wR, wL, pL=None):
        aR, aL, rR, rL = feet(f)
        pts = spline_pts if f > L["RELEASE"] else smooth_pts   # 出手後一口氣收回，關鍵影格不停頓
        P.pose(f"Y{f}", pts(f, hipsK) + V((0, 0, jump(f))), tuple(pts(f, leanK)), pts(f, headK),
               wR, wL, aR, aL, handR_dir=V((0, -1.0, -0.3)) if f <= 2 else None, poleR=pts(f, poleRK),
               poleL=pL if pL is not None else smooth_pts(f, poleLK),
               footR=rR, footL=rL, twist=smooth_pts(f, twistK))

    grip_tt = GRIP_TT
    grip_lay = (V((0.05, 0.40, -0.92)), V((0, 0.92, 0.40)), V((1.0, -0.1, 0.1)), V((0, -0.1, 1.0)))
    # 球心（不含跳躍高度）：第 3 格起雙手持球（右手托在球下、左手扶在球左側）到出手；第 3 格的位置在第 2 格算出後補上
    ballK = [(3, None), (L["PUSH_R"], V((-0.18, -0.26, 1.00))), (9, V((-0.16, -0.27, 1.08))),
             (L["TAKEOFF"], V((-0.14, -0.28, 1.25))), (13, V((-0.13, -0.31, 1.55))),
             (15, V((-0.13, -0.34, 1.84))), (L["RELEASE"], V((-0.12, -0.37, 1.97)))]
    wRK = [(L["LAND"], V((-0.21, -0.36, 1.15))), (L["END"], V((-0.215, -0.03, 0.85)))]   # 沿身體前方劃弧放下，結束同 Idle
    wLK = [(L["END"], V((0.215, -0.03, 0.85)))]

    def hand_axes(name):
        m = P.pb[name].matrix.to_3x3()
        return m.col[1].copy(), -m.col[2].copy()

    pose_body(L["END"], wRK[-1][1] + Z, wLK[-1][1] + Z, end_pL)  # 先擺出結束姿勢，記下雙手方向
    end_dL = wLK[-1][1] + Z - P.pb["upper_arm.L"].head
    end_axes = hand_axes("hand.R")
    end_R, palm_off = P.wrist_local("hand.R"), -P.pb["hand.L"].matrix.to_3x3().col[2] - natural_palm(P)   # 結束時剛好等於 Idle
    state = {}
    wL0 = V((0.26, -0.20, 0.95)) + Z
    rel = None
    for f in range(L["END"] + 1):
        J = V((0, 0, jump(f)))
        if f <= 2:                                        # 右手最後一次壓著球，左手過來準備接
            sL = grip_tt[2].normalized()
            wL = wL0.lerp(V((-0.28, -0.46, 0.83)) + Z + sL * 0.25, ease(f / 3))
            pose_body(f, V((-0.28, -0.40, 0.97 - 0.02 * f)) + Z, wL)
            P.palm_inward(".L")                          # 同 Sprint 第 0 格，再慢慢轉成持球的方向
            P.palm("hand.L", grip_tt[3], -sL, ease(f / 3))
            B = P.seat(V((-0.28, -0.46, 0.8)) + Z, V((0, 0, -1)))
            ballK[0] = (3, (B - Z).lerp(V((-0.18, -0.30, 0.98)), 0.6))   # 收球：球往身體中線拉，左手才搆得到
            P.key(f + 1, B)
            continue
        if f <= L["RELEASE"]:
            B = smooth_pts(f, ballK) + Z + J
            w = ease(min(1.0, (f - 3) / 8))
            g = [a.lerp(b, w) for a, b in zip(grip_tt, grip_lay)]
            P.hold_two(B, g[0], g[1], g[2], g[3], lambda wR, wL: pose_body(f, wR, wL))
            rel = (B, hand_axes("hand.R"), P.wrist_local("hand.L"),
                   P.pb["hand.R"].head.copy(), P.pb["hand.L"].head - P.pb["upper_arm.L"].head)
            P.key(f + 1, B)
            continue
        B_r, rel_R, rel_L, rel_wR, rel_dL = rel          # 出手後
        gf = f - L["RELEASE"]
        wR = spline_pts(f, [(L["RELEASE"], rel_wR)] + [(k, v + Z) for k, v in wRK])
        n = len(P.unreachable)                            # 先擺好身體（肩膀位置），左手再以肩膀為圓心放下；
        pose_body(f, wR, P.pb["hand.L"].head.copy())      # 這次預擺的左手只是暫放，搆不到不記錄
        del P.unreachable[n:]
        wL, pL = drop_left(P, f, L["RELEASE"], L["END"], rel_dL, end_dL, poleLK[-1][1], end_pL)
        pose_body(f, wR, wL, pL)
        follow_through(P, gf, L["END"] - L["RELEASE"], 4, rel_R, end_axes, end_R, rel_L, palm_off, state, snap_deg=80)
        P.key(f + 1, B_r + V((0, -1.5, 4.0)) * (gf / FPS), 0.0)   # 球往籃框方向飛走（隱藏）
    MOVE_SPEEDS["Layup"] = v0


PASS_RELEASE, PASS_HOLD, PASS_END = 9, 14, 24
# 胸前傳球的握法：雙手在球的後外側、手指朝上（手肘往外張），格式同 GRIP_TT
GRIP_PASS = (V((-0.70, 0.65, -0.15)), V((-0.25, -0.30, 1.0)), V((0.70, 0.65, -0.15)), V((0.25, -0.30, 1.0)))


def make_pass(P):
    """胸前傳球（單次 24 格）：從 TripleThreat 第 0 格開始，球收到胸前、左腳往前跨，雙手往前推，
    第 9 格（0.375 s）出手，之後球縮放為 0（由遊戲接手飛行）。出手後手掌往外翻、拇指朝下停到第 14 格，
    再放下雙手、收腳，結束姿勢和 Idle 相同。原地動作，不推動。"""
    P.new_action("Pass")
    P.hinge_roll[".L"], P.hinge_roll[".R"] = HINGE_ROLL_L, HINGE_ROLL_R
    Z = P.Z
    R0, L0 = P.ankle_rest(".R"), P.ankle_rest(".L")
    aR_tt, aL_tt = R0 + V((-0.10, 0.07, 0)), L0 + V((0.10, -0.07, 0))   # 三威脅站姿
    aL_step = L0 + V((0.06, -0.24, 0))                   # 左腳往前跨一步

    def move(a, b, f, f0, f1, h):                        # 腳從 a 抬起移到 b（f0～f1），中途抬高 h
        u = min(1.0, max(0.0, (f - f0) / (f1 - f0)))
        return a.lerp(b, ease(u)) + V((0, 0, h * math.sin(math.pi * u)))

    def feet(f):                                         # 左腳 3～8 格跨出；收尾右腳 13～18、左腳 17～22 收回 Idle 站姿
        aL = move(aL_tt, aL_step, f, 3, 8, 0.05) if f < 17 else move(aL_step, L0, f, 17, 22, 0.04)
        return move(aR_tt, R0, f, 13, 18, 0.04), aL

    hipsK = [(0, V((0, 0.02, -0.19))), (5, V((0, 0.0, -0.20))), (PASS_RELEASE, V((0, -0.07, -0.16))),
             (PASS_HOLD, V((0, -0.06, -0.15))), (PASS_END, V((0, 0, -0.012)))]
    leanK = [(0, V((0.14, 0.10, 0.05))), (5, V((0.10, 0.06, 0.03))), (PASS_RELEASE, V((0.12, 0.08, 0.04))),
             (PASS_HOLD, V((0.12, 0.08, 0.04))), (PASS_END, V((0, 0, 0)))]
    headK = [(0, -0.22), (5, -0.15), (PASS_RELEASE, -0.15), (PASS_HOLD, -0.12), (PASS_END, 0.02)]
    # 手肘：三威脅 → 往外張（推球）→ 放下時經過朝下 → 和 Idle 一樣朝後
    poleRK = [(0, V((-0.6, 0.8, -0.3))), (5, V((-0.9, 0.2, -0.4))), (PASS_RELEASE, V((-0.8, 0.0, -0.6))),
              (PASS_HOLD, V((-0.8, 0.0, -0.6))), (19, V((-0.3, -0.3, -1.0))), (PASS_END, V((-0.35, 1.0, -0.25)))]
    poleLK = [(0, V((0.6, 0.6, -0.6))), (5, V((0.9, 0.2, -0.4))), (PASS_RELEASE, V((0.8, 0.0, -0.6))),
              (PASS_HOLD, V((0.8, 0.0, -0.6))), (19, V((0.3, -0.3, -1.0))), (PASS_END, V((0.35, 1.0, -0.25)))]
    B0, B_chest, B_rel = V((-0.22, -0.25, 0.96)), V((-0.02, -0.30, 1.12)), V((-0.01, -0.68, 1.15))
    endR, endL = V((-0.215, -0.03, 0.85)), V((0.215, -0.03, 0.85))   # 和 Idle 相同
    out = {".R": V((-0.45, 0.0, -0.89)), ".L": V((0.45, 0.0, -0.89))}   # 出手後掌心朝外下方（拇指朝下）

    def pose_body(f, wR, wL):
        pts = spline_pts if f > PASS_HOLD else smooth_pts
        aR, aL = feet(f)
        P.pose(f"PA{f}", pts(f, hipsK), tuple(pts(f, leanK)), pts(f, headK), wR, wL, aR, aL,
               poleR=pts(f, poleRK), poleL=pts(f, poleLK))

    pose_body(PASS_END, endR + Z, endL + Z)               # 結束姿勢：記下和 Idle 的掌心差
    off = {sfx: -P.pb["hand" + sfx].matrix.to_3x3().col[2] - natural_palm(P, sfx) for sfx in (".R", ".L")}
    rel_q, rel_w, hold_q = {}, {}, {}
    for f in range(PASS_END + 1):
        if f <= PASS_RELEASE:
            if f <= 5:                                   # 球收到胸前
                B = B0.lerp(B_chest, ease(f / 5))
            else:                                        # 往前推：越推越快，出手時速度最快
                u = (f - 5) / (PASS_RELEASE - 5)
                B = B_chest.lerp(B_rel, u * u)
            B = B + Z
            w = ease(min(1.0, f / 5))
            g = [a.lerp(b, w) for a, b in zip(GRIP_TT, GRIP_PASS)]
            P.hold_two(B, g[0], g[1], g[2], g[3], lambda wR, wL: pose_body(f, wR, wL))
            for sfx in (".R", ".L"):
                rel_q[sfx], rel_w[sfx] = P.wrist_local("hand" + sfx), P.pb["hand" + sfx].head.copy()
            B_out = B
            P.key(f + 1, B)
            continue
        gf = f - PASS_RELEASE
        follow = {sfx: rel_w[sfx] + V((0.04 if sfx == ".L" else -0.04, -0.04, -0.03)) for sfx in (".R", ".L")}
        if f <= PASS_HOLD:                               # 手再往前送一點、停住
            wR = smooth_pts(f, [(PASS_RELEASE, rel_w[".R"]), (12, follow[".R"]), (PASS_HOLD, follow[".R"])])
            wL = smooth_pts(f, [(PASS_RELEASE, rel_w[".L"]), (12, follow[".L"]), (PASS_HOLD, follow[".L"])])
        else:                                            # 沿身體前方劃弧放下
            wR = spline_pts(f, [(PASS_HOLD, follow[".R"]), (19, V((-0.24, -0.36, 1.00)) + Z), (PASS_END, endR + Z)])
            wL = spline_pts(f, [(PASS_HOLD, follow[".L"]), (19, V((0.24, -0.36, 1.00)) + Z), (PASS_END, endL + Z)])
        pose_body(f, wR, wL)
        for sfx in (".R", ".L"):
            fore = P.pb["forearm" + sfx].matrix.col[1].to_3d()
            if f <= PASS_HOLD:                           # 3 格內翻成拇指朝下並停住
                turn_hand(P, sfx, rel_q[sfx], fore, out[sfx], ease(min(1.0, gf / 3)))
                hold_q[sfx] = P.wrist_local("hand" + sfx)
            else:                                        # 放下時轉回放鬆的掌心（朝身體）
                turn_hand(P, sfx, hold_q[sfx], fore, natural_palm(P, sfx) + off[sfx],
                          ease(min(1.0, (f - PASS_HOLD) / 5)))
        P.key(f + 1, B_out + V((0, -7.0, 0.3)) * (gf / FPS), 0.0)   # 球往前飛走（隱藏）


CATCH_SEEN, CATCH_AT, CATCH_GIVE, CATCH_END = 3, 8, 12, 20
# 接球的手型：雙手在球的後外側、掌心朝前迎球、手指朝上（兩手拇指相對），格式同 GRIP_TT
GRIP_CATCH = (V((-0.60, 0.78, 0.0)), V((-0.2, -0.2, 1.0)), V((0.60, 0.78, 0.0)), V((0.2, -0.2, 1.0)))


def make_catch(P):
    """接球（單次 20 格）：從 Idle 第 0 格開始，雙腳換成三威脅站姿、屈膝，雙手舉到胸前張開迎球；
    球從前方飛來（第 3 格出現），第 8 格（0.33 s）雙手接住，往胸前收（緩衝）到第 12 格，
    第 20 格移到三威脅位置，結束姿勢與 TripleThreat 第 0 格相同。原地動作，不推動。"""
    P.new_action("Catch")
    P.hinge_roll[".L"], P.hinge_roll[".R"] = HINGE_ROLL_L, HINGE_ROLL_R
    Z = P.Z
    R0, L0 = P.ankle_rest(".R"), P.ankle_rest(".L")
    aR_tt, aL_tt = R0 + V((-0.10, 0.07, 0)), L0 + V((0.10, -0.07, 0))   # 三威脅站姿（同 make_triple_threat）

    def move(a, b, f, f0, f1, h):                        # 腳從 a 抬起移到 b（f0～f1），中途抬高 h
        u = min(1.0, max(0.0, (f - f0) / (f1 - f0)))
        return a.lerp(b, ease(u)) + V((0, 0, h * math.sin(math.pi * u)))

    hipsK = [(0, V((0, 0, -0.012))), (CATCH_AT, V((0, 0.0, -0.14))), (CATCH_GIVE, V((0, 0.03, -0.21))),
             (CATCH_END, V((0, 0.02, -0.19)))]
    leanK = [(0, V((0, 0, 0))), (CATCH_AT, V((0.08, 0.05, 0.02))), (CATCH_GIVE, V((0.14, 0.09, 0.04))),
             (CATCH_END, V((0.14, 0.10, 0.05)))]
    headK = [(0, 0.02), (CATCH_AT, -0.12), (CATCH_END, -0.22)]
    # 手肘：Idle 朝後 → 迎球時朝外下方 → 三威脅
    poleRK = [(0, V((-0.35, 1.0, -0.25))), (6, V((-0.6, 0.2, -0.8))), (CATCH_GIVE, V((-0.7, 0.4, -0.6))),
              (CATCH_END, V((-0.6, 0.8, -0.3)))]
    poleLK = [(0, V((0.35, 1.0, -0.25))), (6, V((0.6, 0.2, -0.8))), (CATCH_GIVE, V((0.7, 0.4, -0.6))),
              (CATCH_END, V((0.6, 0.6, -0.6)))]
    B_catch, B_chest, B_tt = V((-0.02, -0.46, 1.14)), V((-0.04, -0.31, 1.08)), V((-0.22, -0.25, 0.96))
    idleR, idleL = V((-0.215, -0.03, 0.85)), V((0.215, -0.03, 0.85))   # Idle 第 0 格的手腕

    def pose_body(f, wR, wL):
        P.pose(f"C{f}", smooth_pts(f, hipsK), tuple(smooth_pts(f, leanK)), smooth_pts(f, headK), wR, wL,
               move(R0, aR_tt, f, 1, 6, 0.04), move(L0, aL_tt, f, 3, 8, 0.04),
               poleR=smooth_pts(f, poleRK), poleL=smooth_pts(f, poleLK))

    sR, sL = GRIP_CATCH[0].normalized(), GRIP_CATCH[2].normalized()
    dR = (GRIP_CATCH[1] - sR * GRIP_CATCH[1].dot(sR)).normalized()
    dL = (GRIP_CATCH[3] - sL * GRIP_CATCH[3].dot(sL)).normalized()
    reach = R_BALL / P.s + PALM_T
    for f in range(CATCH_END + 1):
        if f < CATCH_AT:                                 # 雙手舉到接球點、張開等球（離球面的空隙到第 8 格收到 0）
            k = ease(min(1.0, f / 6))
            margin = 0.06 * (CATCH_AT - f) / CATCH_AT
            tR = B_catch + Z + sR * (reach + margin) - dR * PALM_A
            tL = B_catch + Z + sL * (reach + margin) - dL * PALM_A
            pose_body(f, (idleR + Z).lerp(tR, k), (idleL + Z).lerp(tL, k))
            P.palm("hand.R", dR, -sR, k)
            P.palm("hand.L", dL, -sL, k)
            if f < CATCH_SEEN:                           # 球還沒進畫面
                P.key(f + 1, B_catch + Z + V((0, -1.6, 0.15)), 0.0)
            else:                                        # 球從前方飛來（約 7 m/s，略帶弧度）
                tau = (CATCH_AT - f) / FPS
                P.key(f + 1, B_catch + Z + V((0, -7.0 * tau, 0.9 * tau - 4.9 * tau * tau * 0.3)))
            continue
        if f <= CATCH_GIVE:                              # 接住後往胸前收
            B = B_catch.lerp(B_chest, ease((f - CATCH_AT) / (CATCH_GIVE - CATCH_AT)))
        else:                                            # 移到三威脅位置
            B = B_chest.lerp(B_tt, ease((f - CATCH_GIVE) / (CATCH_END - CATCH_GIVE)))
        w = ease((f - CATCH_AT) / (CATCH_END - CATCH_AT))   # 手型從接球換成三威脅
        g = [a.lerp(b, w) for a, b in zip(GRIP_CATCH, GRIP_TT)]
        P.hold_two(B + Z, g[0], g[1], g[2], g[3], lambda wR, wL: pose_body(f, wR, wL))
        P.key(f + 1, B + Z)


CLIPS = ("Idle", "Dribble", "Shoot", "Sprint", "TripleThreat", "DribbleWalk", "Jog", "Run", "StopJump", "SetShot",
         "Layup", "Pass", "Catch")


def build_all(rig, ball, off, scale):
    """scale：匯出前角色要縮的倍數（球不縮），放球時要算進去。"""
    bpy.context.scene.render.fps = FPS
    P = Poser(rig, ball, off, scale)
    make_dribble(P)
    make_idle(P)
    make_shoot(P)
    make_sprint(P)
    make_triple_threat(P)
    make_dribble_walk(P)
    make_run(P, "Jog", N=16, S=0.40, Y=0.28, lift=0.12, toe=0.30, hips_z=-0.10, bob=0.02,
             lean=(0.08, 0.04, 0.02), head=-0.07, arm_y=0.16, arm_z=-0.06)
    make_run(P, "Run", N=12, S=0.34, Y=0.30, lift=0.24, toe=0.50, hips_z=-0.12, bob=0.025,
             lean=(0.16, 0.07, 0.03), head=-0.15, arm_y=0.24, arm_z=-0.12)
    make_stop_jump(P)
    make_set_shot(P)
    make_layup(P)
    make_pass(P)
    make_catch(P)
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
    return {"unreachable_over_1cm": P.unreachable, "sprint_speed": SPRINT_SPEED, "move_speeds": dict(MOVE_SPEEDS)}
