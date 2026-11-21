//! Display list shared by both backends.

use vello::kurbo::{Affine, BezPath, Ellipse, Rect, RoundedRect, Shape};

/// Floats per display-list entry. Layout (all `f32`):
/// `[kind, x, y, w, h, radius, rotation_deg, opacity, fill_rgba(4), stroke_width, stroke_rgba(4),
///   shadow_dx, shadow_dy, shadow_blur, shadow_spread, shadow_rgba(4)]`
/// `kind`: 0 = rect, 1 = ellipse, 2 = push clip (frame with `clip: true`), 3 = pop clip,
/// 4 = vector path (`radius` holds the index into the path table, see [`parse_paths`]).
/// Colors are straight (non-premultiplied) RGBA in 0..=1; alpha 0 means "no paint".
pub const STRIDE: usize = 25;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Kind {
    Rect,
    Ellipse,
    PushClip,
    PopClip,
    Path,
}

/// Geometry of a `path` node: SVG `d` already mapped into the node's local box.
#[derive(Clone, Debug)]
pub struct PathData {
    pub path: BezPath,
    pub even_odd: bool,
    pub cap: vello::kurbo::Cap,
    pub join: vello::kurbo::Join,
}

/// A parsed display list: boxes plus the vector paths they reference.
#[derive(Clone, Debug, Default)]
pub struct Scene {
    pub items: Vec<Item>,
    pub paths: Vec<PathData>,
}

#[derive(Clone, Copy, Debug)]
pub struct Item {
    /// Index into [`Scene::paths`] for [`Kind::Path`].
    pub path_index: usize,
    pub kind: Kind,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub radius: f64,
    pub rotation: f64,
    pub opacity: f32,
    pub fill: [f32; 4],
    pub stroke_width: f64,
    pub stroke: [f32; 4],
    pub shadow: Option<Shadow>,
}

/// CSS `box-shadow` (outer), drawn as a blurred rounded rectangle under the box.
#[derive(Clone, Copy, Debug)]
pub struct Shadow {
    pub dx: f64,
    pub dy: f64,
    pub blur: f64,
    pub spread: f64,
    pub color: [f32; 4],
}

impl Item {
    /// Blurred rect geometry of the shadow in local coordinates: `(rect, corner radius, std_dev)`.
    /// CSS blur radius ≈ 2 standard deviations.
    pub fn shadow_geometry(&self) -> Option<(Rect, f64, f64, [f32; 4])> {
        let s = self.shadow?;
        if s.color[3] <= 0.0 || matches!(self.kind, Kind::Path | Kind::PopClip) {
            return None;
        }
        let r = Rect::new(
            s.dx - s.spread,
            s.dy - s.spread,
            s.dx + self.w + s.spread,
            s.dy + self.h + s.spread,
        );
        let base = if self.kind == Kind::Ellipse {
            self.w.min(self.h) / 2.0
        } else {
            self.radius
        };
        Some((
            r,
            (base + s.spread).max(0.0),
            (s.blur / 2.0).max(0.01),
            s.color,
        ))
    }

    /// Box shape in local coordinates; [`Item::transform`] places it in document space.
    pub fn path(&self) -> BezPath {
        let r = Rect::new(0.0, 0.0, self.w, self.h);
        match self.kind {
            Kind::Ellipse => Ellipse::from_rect(r).to_path(0.1),
            _ if self.radius > 0.0 => {
                RoundedRect::from_rect(r, self.radius.min(self.w.min(self.h) / 2.0)).to_path(0.1)
            }
            _ => r.to_path(0.1),
        }
    }

    /// Document-space transform. Rotation pivots on the box center, like CSS `rotate()`.
    pub fn transform(&self) -> Affine {
        let t = Affine::translate((self.x, self.y));
        if self.rotation == 0.0 {
            return t;
        }
        let c = (self.w / 2.0, self.h / 2.0);
        t * Affine::translate(c)
            * Affine::rotate(self.rotation.to_radians())
            * Affine::translate((-c.0, -c.1))
    }

    /// The border is drawn inside the box (CSS `box-sizing: border-box`).
    pub fn stroke_path(&self) -> Option<BezPath> {
        if self.stroke_width <= 0.0 || self.stroke[3] <= 0.0 {
            return None;
        }
        let i = self.stroke_width / 2.0;
        let inner = Item {
            x: 0.0,
            y: 0.0,
            w: (self.w - self.stroke_width).max(0.0),
            h: (self.h - self.stroke_width).max(0.0),
            radius: (self.radius - i).max(0.0),
            rotation: 0.0,
            ..*self
        };
        let mut p = inner.path();
        p.apply_affine(Affine::translate((i, i)));
        Some(p)
    }
}

pub fn parse(data: &[f32]) -> Vec<Item> {
    data.chunks_exact(STRIDE)
        .map(|c| Item {
            kind: match c[0] as u32 {
                1 => Kind::Ellipse,
                2 => Kind::PushClip,
                3 => Kind::PopClip,
                4 => Kind::Path,
                _ => Kind::Rect,
            },
            path_index: if c[0] as u32 == 4 { c[5] as usize } else { 0 },
            x: c[1] as f64,
            y: c[2] as f64,
            w: c[3] as f64,
            h: c[4] as f64,
            radius: if c[0] as u32 == 4 { 0.0 } else { c[5] as f64 },
            rotation: c[6] as f64,
            opacity: c[7],
            fill: [c[8], c[9], c[10], c[11] * c[7]],
            stroke_width: c[12] as f64,
            stroke: [c[13], c[14], c[15], c[16] * c[7]],
            shadow: (c[24] > 0.0).then(|| Shadow {
                dx: c[17] as f64,
                dy: c[18] as f64,
                blur: c[19] as f64,
                spread: c[20] as f64,
                color: [c[21], c[22], c[23], c[24] * c[7]],
            }),
        })
        .collect()
}

/// Path table: one line per path, `vx vy vw vh rule cap join|d` where the viewBox is all
/// zeros when absent (path coordinates are already local), `rule` is `nonzero|evenodd`,
/// `cap` is `butt|round|square` and `join` is `miter|round|bevel`. The viewBox is mapped
/// with `preserveAspectRatio="xMidYMid meet"`, like the SVG the DOM canvas renders.
pub fn parse_paths(table: &str, items: &[Item]) -> Vec<PathData> {
    use vello::kurbo::{Cap, Join};
    let mut boxes = vec![None; table.lines().count()];
    for it in items.iter().filter(|i| i.kind == Kind::Path) {
        if let Some(b) = boxes.get_mut(it.path_index) {
            *b = Some((it.w, it.h));
        }
    }
    table
        .lines()
        .enumerate()
        .map(|(i, line)| {
            let (head, d) = line.split_once('|').unwrap_or(("", line));
            let f: Vec<&str> = head.split_whitespace().collect();
            let num = |k: usize| f.get(k).and_then(|v| v.parse::<f64>().ok()).unwrap_or(0.0);
            let mut path = BezPath::from_svg(d).unwrap_or_default();
            let (vw, vh) = (num(2), num(3));
            if let (true, Some((w, h))) = (vw > 0.0 && vh > 0.0, boxes[i]) {
                let s = (w / vw).min(h / vh);
                let tx = (w - vw * s) / 2.0 - num(0) * s;
                let ty = (h - vh * s) / 2.0 - num(1) * s;
                path.apply_affine(Affine::new([s, 0.0, 0.0, s, tx, ty]));
            }
            PathData {
                path,
                even_odd: f.get(4) == Some(&"evenodd"),
                cap: match f.get(5) {
                    Some(&"butt") => Cap::Butt,
                    Some(&"square") => Cap::Square,
                    _ => Cap::Round,
                },
                join: match f.get(6) {
                    Some(&"miter") => Join::Miter,
                    Some(&"bevel") => Join::Bevel,
                    _ => Join::Round,
                },
            }
        })
        .collect()
}

impl Scene {
    pub fn parse(data: &[f32], paths: &str) -> Self {
        let items = parse(data);
        let paths = parse_paths(paths, &items);
        Self { items, paths }
    }
}

/// Encodes a display list into a vello GPU scene under the view transform (pan/zoom/DPR).
pub fn encode_gpu(scene: &mut vello::Scene, s: &Scene, view: Affine) {
    use vello::{
        kurbo::Stroke,
        peniko::{Color, Fill},
    };
    for it in &s.items {
        let t = view * it.transform();
        match it.kind {
            Kind::Path => {
                let Some(p) = s.paths.get(it.path_index) else {
                    continue;
                };
                if it.fill[3] > 0.0 {
                    scene.fill(
                        if p.even_odd {
                            Fill::EvenOdd
                        } else {
                            Fill::NonZero
                        },
                        t,
                        Color::new(it.fill),
                        None,
                        &p.path,
                    );
                }
                if it.stroke_width > 0.0 && it.stroke[3] > 0.0 {
                    // SVG strokes are centered on the outline (unlike the inner CSS border of boxes).
                    let st = Stroke::new(it.stroke_width)
                        .with_caps(p.cap)
                        .with_join(p.join);
                    scene.stroke(&st, t, Color::new(it.stroke), None, &p.path);
                }
            }
            Kind::PopClip => scene.pop_layer(),
            Kind::PushClip => {
                // Frames paint their own fill/stroke before clipping their children.
                paint_gpu(scene, it, t, Color::new);
                scene.push_clip_layer(Fill::NonZero, t, &it.path());
            }
            _ => paint_gpu(scene, it, t, Color::new),
        }
    }
}

fn paint_gpu(
    scene: &mut vello::Scene,
    it: &Item,
    t: Affine,
    color: fn([f32; 4]) -> vello::peniko::Color,
) {
    use vello::{kurbo::Stroke, peniko::Fill};
    if let Some((r, radius, std_dev, c)) = it.shadow_geometry() {
        scene.draw_blurred_rounded_rect(t, r, color(c), radius, std_dev);
    }
    if it.fill[3] > 0.0 {
        scene.fill(Fill::NonZero, t, color(it.fill), None, &it.path());
    }
    if let Some(p) = it.stroke_path() {
        scene.stroke(&Stroke::new(it.stroke_width), t, color(it.stroke), None, &p);
    }
}
