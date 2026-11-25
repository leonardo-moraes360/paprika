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

    pub fn render(
        &mut self,
        scene: &Scene,
        view: vello::kurbo::Affine,
        background: [f32; 4],
    ) -> &[u8] {
        let (w, h) = (self.ctx.width(), self.ctx.height());
        self.ctx.reset();
        self.ctx.reset_transform();
        if background[3] > 0.0 {
            self.ctx.set_paint(AlphaColor::<Srgb>::new(background));
            self.ctx
                .fill_rect(&vello_cpu::kurbo::Rect::new(0.0, 0.0, w as f64, h as f64));
        }
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
        if background[3] < 1.0 {
            vello_common::pixmap::unpremultiply_rgba8(self.pixmap.data_as_u8_slice_mut());
        }
        self.pixmap.data_as_u8_slice()
    }

    fn paint(&mut self, it: &Item) {
        if let Some((r, radius, std_dev, c)) = it.shadow_geometry() {
            self.ctx.set_paint(AlphaColor::<Srgb>::new(c));
            let r = vello_cpu::kurbo::Rect::new(r.x0, r.y0, r.x1, r.y1);
            self.ctx
                .fill_blurred_rounded_rect(&r, radius as f32, std_dev as f32);
        }
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
        let mut it = [0.0; STRIDE];
        it[..12].copy_from_slice(&[
            kind, x, y, w, h, 0.0, 0.0, 1.0, fill[0], fill[1], fill[2], fill[3],
        ]);
        it
    }

    fn px(buf: &[u8], w: usize, x: usize, y: usize) -> [u8; 4] {
        let i = (y * w + x) * 4;
        [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]
    }

    #[test]
    fn draws_rect_ellipse_and_clip() {
        let mut data = Vec::new();
        data.extend(item(0.0, 10.0, 10.0, 20.0, 20.0, [1.0, 0.0, 0.0, 1.0]));
        data.extend(item(1.0, 40.0, 0.0, 20.0, 20.0, [0.0, 0.0, 1.0, 1.0]));
        data.extend(item(2.0, 0.0, 40.0, 20.0, 20.0, [0.0, 0.0, 0.0, 0.0]));
        data.extend(item(0.0, 0.0, 40.0, 60.0, 20.0, [0.0, 1.0, 0.0, 1.0]));
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
    fn shadow_and_translucent_stroke() {
        let mut d = item(0.0, 4.0, 4.0, 10.0, 10.0, [1.0, 1.0, 1.0, 1.0]);
        d[12] = 2.0;
        d[13..17].copy_from_slice(&[0.0, 0.0, 0.0, 0.5]);
        d[17..21].copy_from_slice(&[12.0, 0.0, 0.0, 0.0]);
        d[21..25].copy_from_slice(&[0.0, 0.0, 1.0, 1.0]);
        let mut r = CpuRenderer::new(32, 20);
        let buf = r
            .render(
                &Scene::parse(&d, ""),
                vello::kurbo::Affine::IDENTITY,
                [1.0; 4],
            )
            .to_vec();
        assert_eq!(px(&buf, 32, 9, 9), [255, 255, 255, 255], "white fill");
        let border = px(&buf, 32, 4, 9);
        assert!(
            (120..=135).contains(&border[0]),
            "half-transparent border: {border:?}"
        );
        assert_eq!(
            px(&buf, 32, 21, 9),
            [0, 0, 255, 255],
            "shadow beside the box"
        );
    }

    #[test]
    fn dark_shapes_over_clipped_frame_fill() {
        let near_black = [11.0 / 255.0, 11.0 / 255.0, 11.0 / 255.0, 1.0];
        let frame_fill = [0x62 as f32 / 255.0, 0x71 as f32 / 255.0, 1.0, 1.0];
        let mut data = Vec::new();
        data.extend(item(2.0, 0.0, 0.0, 1200.0, 900.0, frame_fill));
        for k in 0..9 {
            let (x, y) = (277.0 + (k % 3) as f32 * 34.0, 391.0 + (k / 3) as f32 * 24.0);
            let mut r = item(0.0, x, y, 13.0, 13.0, near_black);
            r[5] = 2.0;
            data.extend(r);
        }
        for index in 0..2 {
            let mut p = item(4.0, 0.0, 0.0, 460.0, 520.0, near_black);
            p[5] = index as f32;
            data.extend(p);
        }
        data.extend(item(1.0, 408.0, 405.0, 14.0, 14.0, frame_fill));
        data.extend(item(3.0, 0.0, 0.0, 0.0, 0.0, [0.0; 4]));
        let table = "0 0 0 0 nonzero round round|M278 437 L390 437 C400 437 403 430 405 421 C408 409 416 402 428 399 C427 411 422 419 415 423 C414 470 394 505 358 505 L280 505 Q268 505 268 493 L268 449 Q268 437 278 437 Z\n0 0 0 0 nonzero round round|M405 419 C401 407 405 399 412 395 C415 404 413 412 405 419 Z";
        let scene = Scene::parse(&data, table);
        assert_eq!(scene.paths.len(), 2);
        let zoom = 1.04;
        let mut r = CpuRenderer::new(1280, 960);
        let buf = r
            .render(&scene, vello::kurbo::Affine::scale(zoom), [0.0; 4])
            .to_vec();
        let at = |x: f64, y: f64| px(&buf, 1280, (x * zoom) as usize, (y * zoom) as usize);
        let dark = [11, 11, 11, 255];
        assert_eq!(at(100.0, 100.0), [0x62, 0x71, 0xff, 255], "frame fill");
        for k in 0..9 {
            let (x, y) = (277.0 + (k % 3) as f64 * 34.0, 391.0 + (k / 3) as f64 * 24.0);
            assert_eq!(at(x + 6.5, y + 6.5), dark, "rect {k}");
        }
        assert_eq!(at(330.0, 480.0), dark, "path body");
        assert_eq!(at(412.0, 400.0), dark, "second path (fluke)");
        assert_eq!(
            at(415.0, 412.0),
            [0x62, 0x71, 0xff, 255],
            "ellipse in the frame color"
        );
    }

    #[test]
    fn rotation_pivots_on_center() {
        let mut d = item(0.0, 0.0, 0.0, 20.0, 4.0, [1.0, 0.0, 0.0, 1.0]);
        d[1] = 6.0;
        d[2] = 14.0;
        d[6] = 90.0;
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
