"""Reaper Mesh "Tether" field case for the Heltec WiFi LoRa 32 V3, as printable parts.

Units are millimetres. Axes: X across the face (left to right as you look at the screen),
Y up the face, Z from the front face (Z = 0) toward the back. Every part is exported in the
orientation it should be printed in, sitting on Z = 0.

Run:  python tether.py            (writes stl/*.stl)
Needs: pip install manifold3d trimesh numpy

Measure your own board, battery, switch and connectors and adjust the PARAMETERS block. The
defaults come from published sizes, not from a measured unit.
"""

import math
from pathlib import Path

import numpy as np
import trimesh
from manifold3d import CrossSection, JoinType, Manifold, OpType

# ---------------------------------------------------------------- PARAMETERS
W, H = 58.0, 88.0  # body width and height (lugs add 4.5 mm per side)
SHELL_D = 29.0  # front shell depth; the back plate adds PLATE_T
PLATE_T = 3.0
WALL = 3.2  # side walls (the gasket groove runs inside them)
FACE = 3.0  # front wall
CHAMFER = 3.0  # vertical body edges

BOARD = (50.2, 25.5)  # Heltec V3 board, lying across the top so the screen reads upright
BOARD_TOP = 80.5  # Y of the board's top edge
WINDOW = (28.0, 14.0)  # screen opening (OLED active area is about 21.7 x 10.9)
PANE = (31.0, 19.0, 1.0)  # clear pane, bedded in sealant on the inside lip
OLED_OFFSET_X = 0.0  # move the window if your OLED isn't centred on the board

SMA_X, SMA_Z = 46.0, 19.0  # SMA bulkhead jack in the top wall
SMA_HOLE = 6.6  # 1/4-36 thread
SMA_CB = (16.0, 3.5)  # counterbore diameter and depth: the panel nut sits inside it

SWITCH = (
    46.0,
    15.0,
)  # sealed 12 mm momentary switch, wired to the PRG pads; clears the battery and the right wall
SWITCH_HOLE = 12.2
WELL = (19.5, 4.5)  # guard well diameter and depth: the cap sits about 2 mm below the face
SWITCH_PANEL = 3.5  # panel thickness under the well

USB_Z = 8.5  # centre of the board's USB-C behind the side wall
USB_SLOT = (13.5, 8.0)  # (along Y, along Z)

GROOVE_X = (13.0, 45.0)  # shutter dovetail grooves
GROOVE_Y = (31.0, 80.0)
FIT = 0.2  # sliding clearance per side

INSERT_HOLE = 3.6  # M2.5 heat-set insert
SCREW_CLEAR = 2.9  # M2.5 clearance
LUG = 4.5  # how far the corner lugs stand out
SEG = 64  # circle resolution

OUT = Path(__file__).parent / "stl"


# ---------------------------------------------------------------- helpers
def chamfer_rect(x0, y0, x1, y1, c):
    return CrossSection(
        [
            [
                (x0 + c, y0),
                (x1 - c, y0),
                (x1, y0 + c),
                (x1, y1 - c),
                (x1 - c, y1),
                (x0 + c, y1),
                (x0, y1 - c),
                (x0, y0 + c),
            ]
        ]
    )


def rect(x0, y0, x1, y1):
    return CrossSection([[(x0, y0), (x1, y0), (x1, y1), (x0, y1)]])


def box(x0, y0, z0, x1, y1, z1):
    return Manifold.cube((x1 - x0, y1 - y0, z1 - z0)).translate((x0, y0, z0))


def prism(cs, z0, z1):
    return Manifold.extrude(cs, z1 - z0).translate((0, 0, z0))


def cyl_z(x, y, r, z0, z1, r2=None):
    return Manifold.cylinder(z1 - z0, r, r if r2 is None else r2, SEG).translate((x, y, z0))


def cyl_y(x, z, r, y0, y1):
    # a cylinder along +Y: build along +Z, then rotate X by -90 (z -> y, y -> -z)
    return Manifold.cylinder(y1 - y0, r, r, SEG).rotate((-90, 0, 0)).translate((x, y0, z))


def poly_cs(points):
    """A cross-section from one loop, wound counter-clockwise whatever order it was given in."""
    area = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(points, points[1:] + points[:1]))
    return CrossSection([points if area > 0 else list(reversed(points))])


def along_y(profile_xz, y0, y1):
    """Extrude a profile given as [(x, z)] along Y."""
    cs = poly_cs([(x, -z) for x, z in profile_xz])
    return Manifold.extrude(cs, y1 - y0).rotate((-90, 0, 0)).translate((0, y0, 0))


def along_x(profile_yz, x0, x1):
    """Extrude a profile given as [(y, z)] along X."""
    cs = poly_cs([(-z, y) for y, z in profile_yz])  # rotating Y by +90 maps x -> -z
    return Manifold.extrude(cs, x1 - x0).rotate((0, 90, 0)).translate((x0, 0, 0))


def outline():
    """Body with armored corner lugs that carry the screws outside the seal."""
    body = chamfer_rect(0, 0, W, H, CHAMFER)
    lugs = []
    for cx, cy in [(0, 0), (W, 0), (0, H), (W, H)]:
        sx = -1 if cx == 0 else 1
        sy = -1 if cy == 0 else 1
        x0, x1 = sorted((cx - sx * 3.5, cx + sx * LUG))
        y0, y1 = sorted((cy - sy * 3.5, cy + sy * LUG))
        lugs.append(chamfer_rect(x0, y0, x1, y1, 2.2))
    return CrossSection.batch_boolean([body] + lugs, OpType.Add)


def screw_points():
    return [(-1.0, -1.0), (W + 1.0, -1.0), (-1.0, H + 1.0), (W + 1.0, H + 1.0)]


def gasket_ring(inset_outer, inset_inner):
    base = chamfer_rect(0, 0, W, H, CHAMFER)
    return base.offset(-inset_outer, JoinType.Miter) - base.offset(-inset_inner, JoinType.Miter)


def logo_section(cx, cy, size):
    """The Blade R mark (from the app's 100 x 100 drawing), as a filled cross-section."""
    s = size / 70.0

    def P(x, y):
        return (cx + (x - 57) * s, cy - (y - 55) * s)

    # stem and bowl, as a stroked path: sample it and union circles and segment quads
    path = [(30, 84), (30, 20), (52, 20)]
    for i in range(1, 41):
        a = -math.pi / 2 + math.pi * i / 40
        path.append((52 + 15 * math.cos(a), 35 + 15 * math.sin(a)))
    path.append((30, 50))
    r = 5 * s
    parts = []
    pts = [P(x, y) for x, y in path]
    for (x1, y1), (x2, y2) in zip(pts, pts[1:]):
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L * r, dx / L * r
        parts.append(
            poly_cs(
                [(x1 + nx, y1 + ny), (x2 + nx, y2 + ny), (x2 - nx, y2 - ny), (x1 - nx, y1 - ny)]
            )
        )
    for x, y in pts:
        parts.append(CrossSection.circle(r, 24).translate((x, y)))

    # the scythe blade
    def bez(p0, p1, p2, p3, n=24):
        out = []
        for i in range(n + 1):
            t = i / n
            out.append(
                tuple(
                    (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t**2 * c + t**3 * d
                    for a, b, c, d in zip(p0, p1, p2, p3)
                )
            )
        return out

    blade = (
        bez((36, 46), (58, 52), (74, 66), (85, 90))
        + bez((85, 90), (70, 76), (54, 68), (36, 62))[1:]
    )
    poly = [P(x, y) for x, y in blade]
    parts.append(poly_cs(poly))
    return CrossSection.batch_boolean(parts, OpType.Add)


def dovetail(cx, top_w, bottom_w, depth):
    """Profile in (x, z): top_w at the face (z = 0), bottom_w at z = depth."""
    return [
        (cx - top_w / 2, -0.01),
        (cx + top_w / 2, -0.01),
        (cx + bottom_w / 2, depth),
        (cx - bottom_w / 2, depth),
    ]


# ---------------------------------------------------------------- front shell
def front_shell(usb_side="left"):
    shell = prism(outline(), 0, SHELL_D)
    cavity = prism(chamfer_rect(WALL, WALL, W - WALL, H - WALL, 1.5), FACE, SHELL_D + 1)
    shell = shell - cavity

    # inside: SMA boss under the top wall, switch boss behind the face, board rails
    # a solid block rising from the face, so it prints without supports; it gives the jack a
    # 3.5 mm panel under the counterbore and carries any lever load into the face and walls
    sma_boss = box(
        SMA_X - 11, BOARD_TOP + 0.5, FACE - 0.01, W - WALL + 0.01, H - WALL + 0.01, SHELL_D - 2.0
    )
    switch_boss = cyl_z(
        SWITCH[0], SWITCH[1], WELL[0] / 2 + 2.2, FACE - 0.01, WELL[1] + SWITCH_PANEL
    )
    switch_boss = switch_boss ^ box(WALL - 1, WALL - 1, 0, W - WALL + 1, H - WALL + 1, SHELL_D)
    board_bottom = BOARD_TOP - BOARD[1]
    rails = (
        box(8, board_bottom - 0.3 - 1.4, FACE, 24, board_bottom - 0.3, FACE + 6)
        + box(34, board_bottom - 0.3 - 1.4, FACE, 50, board_bottom - 0.3, FACE + 6)
        + box(6, BOARD_TOP + 0.3, FACE, 52, H - WALL + 0.01, FACE + 6)
    )
    shell = shell + sma_boss + switch_boss + rails

    # screen window, with the inside lip the pane seals against
    wx = W / 2 + OLED_OFFSET_X
    wy = board_bottom + BOARD[1] / 2
    shell = shell - box(
        wx - WINDOW[0] / 2, wy - WINDOW[1] / 2, -1, wx + WINDOW[0] / 2, wy + WINDOW[1] / 2, FACE + 1
    )
    pw, ph = PANE[0] + 0.2, PANE[1] + 0.2
    shell = shell - box(
        wx - pw / 2, wy - ph / 2, FACE - PANE[2], wx + pw / 2, wy + ph / 2, FACE + 1
    )

    # shutter dovetail grooves with entry pockets at the bottom
    for gx in GROOVE_X:
        shell = shell - along_y(dovetail(gx, 2.4, 3.6, 1.6), GROOVE_Y[0], GROOVE_Y[1])
        shell = shell - box(gx - 1.8, GROOVE_Y[0], -1, gx + 1.8, GROOVE_Y[0] + 6.4, 1.6)

    # guarded switch well: chamfered mouth for a gloved thumb, then the 12 mm hole
    sx, sy = SWITCH
    shell = shell - cyl_z(sx, sy, WELL[0] / 2 + 1.5, -0.01, 1.5, WELL[0] / 2)
    shell = shell - cyl_z(sx, sy, WELL[0] / 2, -0.01, WELL[1])
    shell = shell - cyl_z(sx, sy, SWITCH_HOLE / 2, -1, WELL[1] + SWITCH_PANEL + 1)

    # SMA: counterbore for the panel nut, through hole for the jack
    shell = shell - cyl_y(SMA_X, SMA_Z, SMA_CB[0] / 2, H - SMA_CB[1], H + 1)
    shell = shell - cyl_y(SMA_X, SMA_Z, SMA_HOLE / 2, H - 12, H + 1)

    # USB-C access slot in the side wall, with a seat for the TPU plug's flange
    ux0, ux1 = (-1, WALL + 0.5) if usb_side == "left" else (W - WALL - 0.5, W + 1)
    fx0, fx1 = (-1, 1.2) if usb_side == "left" else (W - 1.2, W + 1)
    shell = shell - prism_slot_x(ux0, ux1, wy, USB_Z, USB_SLOT[0], USB_SLOT[1], 2.0)
    shell = shell - prism_slot_x(fx0, fx1, wy, USB_Z, USB_SLOT[0] + 4, USB_SLOT[1] + 4, 3.0)

    # cable hook for the extension cable's strain, on the side away from the USB port
    hook = prism(rect(W - 0.5, 66, W + 6, 69), 0, 18) + prism(rect(W + 3, 66, W + 6, 77), 0, 18)
    if usb_side == "right":
        hook = hook.mirror((1, 0, 0)).translate((W, 0, 0))
    shell = shell + hook

    # gasket groove in the back rim, inside the wall, inboard of nothing: screws are in the lugs
    shell = shell - prism(gasket_ring(0.8, 2.4), SHELL_D - 1.4, SHELL_D + 1)

    # heat-set inserts in the lugs, from the back
    for x, y in screw_points():
        shell = shell - cyl_z(x, y, INSERT_HOLE / 2, SHELL_D - 7, SHELL_D + 1)

    # grip grooves down both sides, and the Blade R on the face
    for y in np.arange(20, 52, 3.0):
        shell = shell - box(-1, y, 7, 0.8, y + 1.2, 24) - box(W - 0.8, y, 7, W + 1, y + 1.2, 24)
    shell = shell - prism(logo_section(18, 17, 17), -1, 0.8)
    return shell


def prism_slot_x(x0, x1, cy, cz, ly, lz, r):
    """A rounded slot through an X wall: ly along Y, lz along Z."""
    cs = rect(cy - ly / 2 + r, cz - lz / 2, cy + ly / 2 - r, cz + lz / 2) + rect(
        cy - ly / 2, cz - lz / 2 + r, cy + ly / 2, cz + lz / 2 - r
    )
    for yy in (cy - ly / 2 + r, cy + ly / 2 - r):
        for zz in (cz - lz / 2 + r, cz + lz / 2 - r):
            cs = cs + CrossSection.circle(r, 32).translate((yy, zz))
    return along_x([(y, z) for y, z in cs.to_polygons()[0]], x0, x1)


# ---------------------------------------------------------------- back plate
def back_plate():
    """Printed inner face down. Two 1 in webbing loops on the outside."""
    plate = prism(outline(), 0, PLATE_T)
    for x, y in screw_points():
        plate = plate - cyl_z(x, y, SCREW_CLEAR / 2, -1, PLATE_T + 1)
        plate = plate - cyl_z(x, y, 2.9, PLATE_T - 1.6, PLATE_T + 1)
    loops = Manifold()
    for y0 in (12.0, 64.0):
        posts = box(12, y0, PLATE_T - 0.01, 16, y0 + 9, PLATE_T + 3.4) + box(
            42, y0, PLATE_T - 0.01, 46, y0 + 9, PLATE_T + 3.4
        )
        bar = box(12, y0, PLATE_T + 3.4, 46, y0 + 9, PLATE_T + 6.0)
        loops = loops + posts + bar
    return plate + loops


# ---------------------------------------------------------------- small parts
def gasket():
    """TPU 95A. Or skip it and lay 1.5 mm O-ring cord in the groove."""
    return prism(gasket_ring(0.85, 2.35), 0, 2.0)


def shutter():
    """Printed face down with the dovetail keys up. Slides in the face grooves."""
    sw, sh, st = GROOVE_X[1] - GROOVE_X[0] + 6.0, 20.0, 1.8
    x0 = GROOVE_X[0] - 3.0
    plate = box(x0, 0, 0, x0 + sw, sh, st)
    # finger grooves on the outside face (on the bed side)
    for y in (4.0, 7.0, 10.0, 13.0, 16.0):
        plate = plate - box(x0 + 6, y, -1, x0 + sw - 6, y + 1.0, 0.6)
    keys = Manifold()
    for gx in GROOVE_X:
        k = along_y(
            [
                (gx - 1.0 + FIT / 2, -0.01),
                (gx + 1.0 - FIT / 2, -0.01),
                (gx + 1.6 - FIT, 1.4),
                (gx - 1.6 + FIT, 1.4),
            ],
            sh - 6.0,
            sh,
        )
        keys = keys + k.translate((0, 0, st))
    part = plate + keys
    return part.translate((-x0, 0, 0))


def usb_plug():
    """TPU 95A. Flange down; the plug presses into the slot, the tab pulls it out."""
    ly, lz = USB_SLOT[0] + 0.2, USB_SLOT[1] + 0.2
    plug = rounded_block(ly, lz, 2.0, 1.2, 4.2)
    flange = rounded_block(USB_SLOT[0] + 3.8, USB_SLOT[1] + 3.8, 3.0, 0, 1.2)
    tab = box(-3, USB_SLOT[1] / 2 + 1.9 - 0.01, 0, 3, USB_SLOT[1] / 2 + 9, 1.2)
    ring = cyl_z(0, USB_SLOT[1] / 2 + 9, 2.4, 0, 1.2) - cyl_z(0, USB_SLOT[1] / 2 + 9, 1.2, -1, 2)
    return plug + flange + tab + ring


def rounded_block(lx, ly, r, z0, z1):
    cs = rect(-lx / 2 + r, -ly / 2, lx / 2 - r, ly / 2) + rect(
        -lx / 2, -ly / 2 + r, lx / 2, ly / 2 - r
    )
    for x in (-lx / 2 + r, lx / 2 - r):
        for y in (-ly / 2 + r, ly / 2 - r):
            cs = cs + CrossSection.circle(r, 32).translate((x, y))
    return prism(cs, z0, z1)


def window_template():
    """Cut the real window from 1 mm polycarbonate; this is a template, or print it in clear PETG."""
    return box(0, 0, 0, PANE[0], PANE[1], PANE[2])


# ---------------------------------------------------------------- export
def to_trimesh(m):
    mesh = m.to_mesh()
    # process=False keeps manifold's exact, closed mesh; merging vertices can only damage it
    return trimesh.Trimesh(
        vertices=np.asarray(mesh.vert_properties)[:, :3],
        faces=np.asarray(mesh.tri_verts),
        process=False,
    )


def main():
    OUT.mkdir(exist_ok=True)
    parts = {
        "front-shell-usb-left": (front_shell("left"), "PETG or ASA, face down, no supports"),
        "front-shell-usb-right": (front_shell("right"), "PETG or ASA, face down, no supports"),
        "back-plate": (back_plate(), "PETG or ASA, inner face down, no supports"),
        "shutter": (shutter(), "PETG, face down"),
        "gasket": (gasket(), "TPU 95A, flat"),
        "usb-plug": (usb_plug(), "TPU 95A, flange down"),
        "window-template": (window_template(), "template, or clear PETG"),
    }
    report = []
    for name, (solid, note) in parts.items():
        tm = to_trimesh(solid)
        lo, hi = tm.bounds
        tm.apply_translation((-lo[0], -lo[1], -lo[2]))
        tm.export(OUT / f"{name}.stl")
        size = hi - lo
        report.append((name, tm.is_watertight, tm.volume, size, note))
    for name, ok, vol, size, note in report:
        print(
            f"{name:24s} watertight={ok}  {size[0]:6.1f} x {size[1]:6.1f} x {size[2]:5.1f} mm  {vol / 1000:6.1f} cm3  {note}"
        )


if __name__ == "__main__":
    main()
