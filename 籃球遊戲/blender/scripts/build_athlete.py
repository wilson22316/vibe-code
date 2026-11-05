"""從空白場景重建運動員（模型、骨架、球鞋、籃球、四段動作），匯出 .glb。

用法（在專案根目錄）：
  D:\\Blender\\blender.exe --background --python blender\\scripts\\build_athlete.py -- --out public\\models\\athlete_game.glb
  可加 --blend blender\\out\\athlete_game.blend 另存 Blender 檔。

注意：會清空目前的場景，請用 --background 執行，不要在開著重要檔案的 Blender 視窗裡跑。
"""
import argparse
import json
import os
import sys

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import athlete_anims  # noqa: E402
import athlete_model  # noqa: E402


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, help="輸出的 .glb 路徑")
    ap.add_argument("--blend", help="另存的 .blend 路徑（選用）")
    return ap.parse_args(argv)


def export_glb(path, rig, body, ball):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in (rig, body, ball):
        o.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(
        filepath=path, export_format='GLB', use_selection=True, use_active_scene=True,
        export_animations=True, export_animation_mode='NLA_TRACKS',      # 同名的 NLA 軌道合併成一段動畫
        export_force_sampling=True, export_frame_step=1, export_skins=True, export_def_bones=True,
        export_optimize_animation_size=False,
        export_optimize_animation_keep_anim_armature=True,
        export_optimize_animation_keep_anim_object=True)                 # 靜止的球也保留軌道


def height_scale(body):
    """縮到 TARGET_HEIGHT 的倍數。身高以赤腳量（頭頂到腳底，不含鞋底墊高的 SOLE_LIFT）。"""
    return athlete_model.TARGET_HEIGHT / (max(v.co.z for v in body.data.vertices) - athlete_model.SOLE_LIFT)


def scale_to_height(rig, ball, s):
    """整個角色（骨架與身體）等比例縮 s 倍；動作只記錄骨頭旋轉與臀部位移，會跟著縮。
    籃球大小不變，只縮放球的移動路徑；高度另外修正，讓球著地時仍剛好碰到地面。
    （球相對角色變大，動作腳本放球時已把這個效果算進去，見 athlete_anims.Poser.seat。）"""
    rig.scale = (s, s, s)
    r = athlete_model.BALL_R
    for act in {st.action for tr in ball.animation_data.nla_tracks for st in tr.strips}:
        for fc in getattr(act, "fcurves", None) or [fc for layer in act.layers for strip in layer.strips
                                                      for bag in strip.channelbags for fc in bag.fcurves]:
            if fc.data_path != "location":
                continue
            for kp in fc.keyframe_points:
                f = (lambda v: s * v + (1 - s) * r) if fc.array_index == 2 else (lambda v: s * v)
                kp.co[1], kp.handle_left[1], kp.handle_right[1] = f(kp.co[1]), f(kp.handle_left[1]), f(kp.handle_right[1])


def main():
    args = parse_args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    body, rig, ball, off = athlete_model.build_model()
    s = height_scale(body)
    info = athlete_anims.build_all(rig, ball, off, s)
    scale_to_height(rig, ball, s)
    info.update({"scale": round(s, 4), "sprint_speed": round(info["sprint_speed"] * s, 3),
                 "move_speeds": {k: round(v * s, 3) for k, v in info["move_speeds"].items()}})
    export_glb(args.out, rig, body, ball)
    if args.blend:
        os.makedirs(os.path.dirname(os.path.abspath(args.blend)), exist_ok=True)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.blend))
    info.update({
        "out": os.path.abspath(args.out),
        "body_tris": sum(len(p.vertices) - 2 for p in body.data.polygons),
        "bones": len(rig.data.bones),
        "materials": [m.name for m in body.data.materials] + [m.name for m in ball.data.materials],
    })
    print("BUILD_RESULT " + json.dumps(info, ensure_ascii=False))


if __name__ == "__main__":
    main()
