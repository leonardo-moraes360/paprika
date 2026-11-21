//! Software fallback: vello_cpu rasterizes the same display list into an RGBA8 buffer.

use crate::scene::{Item, Kind, Scene};
use vello_cpu::{
    Pixmap, RenderContext, Resources,
    color::{AlphaColor, Srgb},
    kurbo::{Affine as CAffine, Stroke},
};

pub struct CpuRenderer {
    ctx: RenderContext,
    resources: Resources,
    pixmap: Pixmap,
}

fn affine(a: vello::kurbo::Affine) -> CAffine {
    CAffine::new(a.as_coeffs())
}

fn path(p: &vello::kurbo::BezPath) -> vello_cpu::kurbo::BezPath {
    // vello and vello_cpu may pin different kurbo versions; go through SVG path data to stay decoupled.
    vello_cpu::kurbo::BezPath::from_svg(&p.to_svg()).unwrap_or_default()
}

impl CpuRenderer {
    pub fn new(width: u16, height: u16) -> Self {
        Self {
            ctx: RenderContext::new(width, height),
            resources: Resources::new(),
            pixmap: Pixmap::new(width, height),
        }
    }

    pub fn resize(&mut self, width: u16, height: u16) {
        self.ctx.reset_and_resize(width, height);
        self.pixmap = Pixmap::new(width, height);
    }

    /// Renders and returns premultiplied RGBA8. The background is opaque, so for every
    /// pixel premultiplied == straight alpha and the buffer can go to `putImageData` as is.
    pub fn render(
        &mut self,
        scene: &Scene,
        view: vello::kurbo::Affine,
        background: [f32; 4],
    ) -> &[u8] {
        let (w, h) = (self.ctx.width(), self.ctx.height());
        self.ctx.reset();
        self.ctx.reset_transform();
        self.ctx.set_paint(AlphaColor::<Srgb>::new(background));
        self.ctx
            .fill_rect(&vello_cpu::kurbo::Rect::new(0.0, 0.0, w as f64, h as f64));
        for it in &scene.items {
            let t = affine(view * it.transform());
            self.ctx.set_transform(t);
            match it.kind {
                Kind::Path => {
                    let Some(p) = scene.paths.get(it.path_index) else {
                        continue;
                    };
                    let bp = path(&p.path);
                    if it.fill[3] > 0.0 {
                        self.ctx.set_fill_rule(if p.even_odd {
                            vello_cpu::peniko::Fill::EvenOdd
                        } else {
                            vello_cpu::peniko::Fill::NonZero
                        });
                        self.ctx.set_paint(AlphaColor::<Srgb>::new(it.fill));
                        self.ctx.fill_path(&bp);
                        self.ctx.set_fill_rule(vello_cpu::peniko::Fill::NonZero);
                    }
                    if it.stroke_width > 0.0 && it.stroke[3] > 0.0 {
                        let cap = match p.cap {
                            vello::kurbo::Cap::Butt => vello_cpu::kurbo::Cap::Butt,
                            vello::kurbo::Cap::Square => vello_cpu::kurbo::Cap::Square,
                            _ => vello_cpu::kurbo::Cap::Round,
                        };
                        let join = match p.join {
                            vello::kurbo::Join::Miter => vello_cpu::kurbo::Join::Miter,
                            vello::kurbo::Join::Bevel => vello_cpu::kurbo::Join::Bevel,
                            _ => vello_cpu::kurbo::Join::Round,
                        };
                        self.ctx.set_stroke(
                            Stroke::new(it.stroke_width).with_caps(cap).with_join(join),
                        );
                        self.ctx.set_paint(AlphaColor::<Srgb>::new(it.stroke));
                        self.ctx.stroke_path(&bp);
                    }
                }
                Kind::PopClip => self.ctx.pop_layer(),
                Kind::PushClip => {
                    self.paint(it);
                    self.ctx.push_clip_layer(&path(&it.path()));
                }
                _ => self.paint(it),
            }
        }
        self.ctx.flush();
        self.ctx.render(&mut self.pixmap, &mut self.resources);
        self.pixmap.data_as_u8_slice()
    }

    fn paint(&mut self, it: &Item) {
        if it.fill[3] > 0.0 {
            self.ctx.set_paint(AlphaColor::<Srgb>::new(it.fill));
            self.ctx.fill_path(&path(&it.path()));
        }
        if let Some(p) = it.stroke_path() {
            self.ctx.set_stroke(Stroke::new(it.stroke_width));
            self.ctx.set_paint(AlphaColor::<Srgb>::new(it.stroke));
            self.ctx.stroke_path(&path(&p));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scene::{STRIDE, Scene};

    fn item(kind: f32, x: f32, y: f32, w: f32, h: f32, fill: [f32; 4]) -> [f32; STRIDE] {
        [
            kind, x, y, w, h, 0.0, 0.0, 1.0, fill[0], fill[1], fill[2], fill[3], 0.0, 0.0, 0.0, 0.0,
        ]
    }

    fn px(buf: &[u8], w: usize, x: usize, y: usize) -> [u8; 4] {
        let i = (y * w + x) * 4;
        [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]
    }

    #[test]
    fn draws_rect_ellipse_and_clip() {
        let mut data = Vec::new();
        data.extend(item(0.0, 10.0, 10.0, 20.0, 20.0, [1.0, 0.0, 0.0, 1.0])); // red rect
        data.extend(item(1.0, 40.0, 0.0, 20.0, 20.0, [0.0, 0.0, 1.0, 1.0])); // blue circle
        data.extend(item(2.0, 0.0, 40.0, 20.0, 20.0, [0.0, 0.0, 0.0, 0.0])); // clip frame
        data.extend(item(0.0, 0.0, 40.0, 60.0, 20.0, [0.0, 1.0, 0.0, 1.0])); // green, wider than clip
        data.extend(item(3.0, 0.0, 0.0, 0.0, 0.0, [0.0; 4]));
        let items = Scene::parse(&data, "");
        let mut r = CpuRenderer::new(64, 64);
        let buf = r
            .render(&items, vello::kurbo::Affine::IDENTITY, [1.0, 1.0, 1.0, 1.0])
            .to_vec();
        assert_eq!(px(&buf, 64, 20, 20), [255, 0, 0, 255], "rect center");
        assert_eq!(px(&buf, 64, 50, 10), [0, 0, 255, 255], "ellipse center");
        assert_eq!(
            px(&buf, 64, 41, 1),
            [255, 255, 255, 255],
            "ellipse corner is empty"
        );
        assert_eq!(px(&buf, 64, 10, 50), [0, 255, 0, 255], "inside clip");
        assert_eq!(px(&buf, 64, 40, 50), [255, 255, 255, 255], "clipped away");
    }

    #[test]
    fn view_transform_zooms() {
        let data = item(0.0, 0.0, 0.0, 10.0, 10.0, [1.0, 0.0, 0.0, 1.0]);
        let items = Scene::parse(&data, "");
        let mut r = CpuRenderer::new(32, 32);
        let buf = r
            .render(&items, vello::kurbo::Affine::scale(3.0), [1.0; 4])
            .to_vec();
        assert_eq!(px(&buf, 32, 25, 25), [255, 0, 0, 255]);
        assert_eq!(px(&buf, 32, 31, 31), [255, 255, 255, 255]);
    }

    #[test]
    fn path_with_viewbox_and_evenodd() {
        // 10x10 viewBox square with a hole, drawn into a 40x20 box: meet -> 20x20 centered at x=10..30.
        let mut d = item(4.0, 0.0, 0.0, 40.0, 20.0, [0.0, 0.0, 1.0, 1.0]);
        d[5] = 0.0;
        let table = "0 0 10 10 evenodd round round|M0 0H10V10H0Z M3 3H7V7H3Z";
        let mut r = CpuRenderer::new(40, 20);
        let buf = r
            .render(
                &Scene::parse(&d, table),
                vello::kurbo::Affine::IDENTITY,
                [1.0; 4],
            )
            .to_vec();
        assert_eq!(px(&buf, 40, 12, 2), [0, 0, 255, 255], "inside the square");
        assert_eq!(px(&buf, 40, 20, 10), [255, 255, 255, 255], "evenodd hole");
        assert_eq!(
            px(&buf, 40, 5, 10),
            [255, 255, 255, 255],
            "letterboxed by meet"
        );
    }

    #[test]
    fn rotation_pivots_on_center() {
        let mut d = item(0.0, 0.0, 0.0, 20.0, 4.0, [1.0, 0.0, 0.0, 1.0]);
        d[1] = 6.0;
        d[2] = 14.0;
        d[6] = 90.0; // 20x4 bar at (6,14) rotated 90° -> vertical bar centered at (16,16)
        let mut r = CpuRenderer::new(32, 32);
        let buf = r
            .render(
                &Scene::parse(&d, ""),
                vello::kurbo::Affine::IDENTITY,
                [1.0; 4],
            )
            .to_vec();
        assert_eq!(
            px(&buf, 32, 16, 8),
            [255, 0, 0, 255],
            "vertical after rotation"
        );
        assert_eq!(
            px(&buf, 32, 8, 16),
            [255, 255, 255, 255],
            "no longer horizontal"
        );
    }
}
