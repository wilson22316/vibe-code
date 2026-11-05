"""運動員的動作：用「兩段式 IK 解算」逐格算出骨頭角度，再記錄成關鍵影格。

每段動作 = 骨架一個 Action（<名稱>_Rig）+ 球一個 Action（<名稱>_Ball），
兩者放在同名的 NLA 軌道上；glTF 匯出時（NLA_TRACKS 模式）會合併成同名的一段動畫。

目前的動作（24 fps）：
  Idle     48 格循環  無球待機，球放在右腳前方地上
  Dribble  24 格循環  原地運球
  Shoot    30 格單次  跳投，第 18 格（0.75 秒）出手，之後球縮放為 0、交給遊戲接手
  Sprint   12 格循環  原地運球衝刺，遊戲端以 SPRINT_SPEED 公尺/秒推動角色
"""
import math

import bpy
from mathutils import Matrix, Vector

FPS = 24
R_BALL = 0.12
SHOOT_RELEASE_FRAME = 18
SPRINT_SPEED = None   # 由 make_sprint() 依步幅計算後填入（縮放前 3.0 m/s；匯出縮放後約 2.84 m/s，見 build_athlete.py）

V = Vector


class Poser:
    """把「手腕、腳踝要放在哪裡」轉換成骨頭旋轉的工具。座標一律是 Blender 世界座標。"""

    def __init__(self, rig, ball, off):
        self.rig, self.ball, self.off = rig, ball, off
        self.Z = V((0, 0, off))
        self.pb = rig.pose.bones
        for p in self.pb:
            p.rotation_mode = 'QUATERNION'
        self.rest = {b.name: b.matrix_local.copy() for b in rig.data.bones}
        self.blen = {b.name: b.length for b in rig.data.bones}
        self.unreachable = []
        self._prevq = {}

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
    z0, z1 = 0.98 - 0.145, 0.86 - 0.145
    for f in range(25):
        t = f / 24.0
        hz = smooth_pts(t, HZ)
        if t <= 0.25:                                    # 手壓著球往下推
            zb = hz - 0.145
        elif t <= 0.55:                                  # 球加速落地
            s = (t - 0.25) / 0.30
            zb = z1 - (z1 - R_BALL) * s * s
        else:                                            # 反彈減速回到手上
            u = (t - 0.55) / 0.45
            zb = R_BALL + (z0 - R_BALL) * (1 - (1 - u) ** 2)
        P.pose(f"D{f}", V((0, -0.03, -0.150 - 0.012 * math.sin(2 * math.pi * t))), (0.10, 0.10, 0.06), 0.18,
               V((-0.30, -0.30, hz)) + Z, V((0.33, -0.16, 1.08 + 0.01 * math.sin(2 * math.pi * t))) + Z,
               aR0, aL0, handR_dir=V((0, -1.0, -0.25)))
        P.key(f + 1, V((-0.30, -0.355, zb)) + Z)


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
        P.key(f + 1, V((-0.34, -0.22, R_BALL)) + Z)


def make_shoot(P):
    """跳投：收球 → 屈膝 → 起跳舉球（手肘在球正下方、朝前）→ 最高點出手 → 壓腕 → 落地。"""
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
         (25, V((0, -0.02, -0.18)), (0.06, 0.05, 0.03), 0.05, V((-0.07, -0.21, 2.06)), V((-0.22, -0.30, 1.30)), V((0.30, -0.15, 1.20)), V((0, -1, -0.4)), 0.0, V((-0.3, 0.6, -0.6)), V((0.35, 1.0, -0.25))),
         (30, V((0, -0.03, -0.15)), (0.10, 0.10, 0.06), 0.18, V((-0.30, -0.355, 0.835)), V((-0.30, -0.30, 0.98)), V((0.33, -0.16, 1.08)), V((0, -1, -0.25)), 0.0, V((-0.35, 1.0, -0.25)), V((0.35, 1.0, -0.25)))]

    def interp(f):
        for a, b in zip(K, K[1:]):
            if a[0] <= f <= b[0]:
                s = ease((f - a[0]) / (b[0] - a[0]))
                L = lambda x, y: x + (y - x) * s
                return (L(a[1], b[1]), tuple(L(x, y) for x, y in zip(a[2], b[2])), L(a[3], b[3]), L(a[4], b[4]),
                        L(a[5], b[5]), L(a[6], b[6]), a[7].lerp(b[7], s), L(a[8], b[8]), a[9].lerp(b[9], s), a[10].lerp(b[10], s))

    for f in range(31):
        hd, ln, ht, bl, wR, wL, hR, lift, pR, pL = interp(f)
        w = min(1.0, f / 6.0) if f <= 10 else (1.0 if f <= 25 else 1.0 - (f - 25) / 5.0)
        aR = aR0.lerp(aRs, w) + V((0, 0, lift))
        aL = aL0.lerp(aLs, w) + V((0, 0, lift))
        toe = 0.55 * (lift / 0.14)                       # 離地時腳尖朝下
        P.pose(f"S{f}", hd, ln, ht, wR + Z, wL + Z, aR, aL, handR_dir=hR, poleR=pR, poleL=pL, footR=toe, footL=toe)
        P.key(f + 1, bl + Z, 1.0 if f <= SHOOT_RELEASE_FRAME else 0.0)


def make_sprint(P):
    """運球衝刺：12 格跑兩步、運球一次。原地循環，地面上的腳以固定速度往後移。"""
    global SPRINT_SPEED
    P.new_action("Sprint")
    Z = P.Z
    N, S, YF, YB = 12, 0.40, -0.30, 0.30                 # 影格數、著地比例、腳最前與最後的位置

    def foot_cycle(ph, base):
        if ph < S:
            return base + V((0, YF + (YB - YF) * (ph / S), 0)), 0.0
        s = (ph - S) / (1 - S)
        return base + V((0, YB + (YF - YB) * ease(s), 0.20 * math.sin(math.pi * s) ** 0.8)), 0.45 * math.sin(math.pi * s)

    HZs = [(0.0, 0.97), (0.2, 0.86), (0.55, 1.00), (0.85, 1.00), (1.0, 0.97)]
    zs0, zs1 = 0.97 - 0.145, 0.86 - 0.145
    for f in range(N + 1):
        t = f / N
        aR, rR = foot_cycle(t % 1.0, P.ankle_rest(".R") + V((0.02, 0, 0)))
        aL, rL = foot_cycle((t + 0.5) % 1.0, P.ankle_rest(".L") + V((-0.02, 0, 0)))
        hz = smooth_pts(t, HZs)
        if t <= 0.2:
            zb, yb = hz - 0.145, -0.46
        elif t <= 0.55:
            s = (t - 0.2) / 0.35
            zb, yb = zs1 - (zs1 - R_BALL) * s * s, -0.46 - 0.16 * s
        else:
            u = (t - 0.55) / 0.45
            zb, yb = R_BALL + (zs0 - R_BALL) * (1 - (1 - u) ** 2), -0.62 + 0.16 * u
        swing = math.cos(2 * math.pi * t)
        P.pose(f"R{f}", V((0, -0.04, -0.10 + 0.02 * math.sin(4 * math.pi * t))), (0.16, 0.08, 0.03), -0.12,
               V((-0.28, -0.40, hz)) + Z, V((0.26, -0.20 * swing, 1.00 - 0.05 * swing)) + Z,
               aR, aL, handR_dir=V((0, -1.0, -0.3)), poleL=V((0.3, 1.0, -0.3)), footR=rR, footL=rL, twist=0.06 * swing)
        P.key(f + 1, V((-0.28, yb, zb)) + Z)
    SPRINT_SPEED = (YB - YF) / (S * N / FPS)


CLIPS = ("Idle", "Dribble", "Shoot", "Sprint")


def build_all(rig, ball, off):
    bpy.context.scene.render.fps = FPS
    P = Poser(rig, ball, off)
    make_dribble(P)
    make_idle(P)
    make_shoot(P)
    make_sprint(P)
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
