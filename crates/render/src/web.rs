//! wasm-bindgen surface: picks WebGPU (vello) when an adapter exists, otherwise vello_cpu + Canvas2D.

use crate::{cpu::CpuRenderer, scene};
use vello::{
    AaConfig, AaSupport, RenderParams, RendererOptions, kurbo::Affine, peniko::Color, wgpu,
};
use wasm_bindgen::{Clamped, JsCast, prelude::*};
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement, ImageData};

/// Default clear color (the bench's light gray). The app sets a transparent one.
const BACKGROUND: [f32; 4] = [0.93, 0.93, 0.94, 1.0];

struct Gpu {
    device: wgpu::Device,
    queue: wgpu::Queue,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    renderer: vello::Renderer,
    target: wgpu::TextureView,
    target_tex: wgpu::Texture,
    readback: Option<(wgpu::Buffer, u32)>,
    blitter: wgpu::util::TextureBlitter,
    scene: vello::Scene,
    adapter_info: String,
    /// First asynchronous device problem (uncaptured validation error or device loss). WebGPU
    /// reports these after `render` already returned, so the frame may never reach the canvas.
    failure: std::sync::Arc<std::sync::Mutex<String>>,
}

struct Cpu {
    renderer: CpuRenderer,
    ctx: CanvasRenderingContext2d,
}

enum Backend {
    Gpu(Box<Gpu>),
    Cpu(Box<Cpu>),
}

#[wasm_bindgen]
pub struct Renderer {
    backend: Backend,
    scene: scene::Scene,
    width: u32,
    height: u32,
    /// Why the GPU path was not used (empty when it was).
    fallback_reason: String,
    background: [f32; 4],
}

fn err(e: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&e.to_string())
}

fn record_failure(slot: &std::sync::Mutex<String>, msg: String) {
    if let Ok(mut f) = slot.lock()
        && f.is_empty()
    {
        *f = msg;
    }
}

fn target_view(device: &wgpu::Device, w: u32, h: u32) -> (wgpu::Texture, wgpu::TextureView) {
    let tex = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("vello-target"),
        size: wgpu::Extent3d {
            width: w,
            height: h,
            depth_or_array_layers: 1,
        },
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        usage: wgpu::TextureUsages::STORAGE_BINDING
            | wgpu::TextureUsages::TEXTURE_BINDING
            | wgpu::TextureUsages::COPY_SRC,
        format: wgpu::TextureFormat::Rgba8Unorm,
        view_formats: &[],
    });
    let view = tex.create_view(&wgpu::TextureViewDescriptor::default());
    (tex, view)
}

/// Everything that can fail runs *before* the canvas gets a `webgpu` context, so a failure
/// still leaves the same canvas free for the Canvas2D fallback.
async fn init_gpu(canvas: &HtmlCanvasElement, allow_software: bool) -> Result<Gpu, String> {
    let has_gpu = js_sys::Reflect::get(
        &web_sys::window().ok_or("no window")?.navigator(),
        &"gpu".into(),
    )
    .map(|v| !v.is_undefined())
    .unwrap_or(false);
    if !has_gpu {
        return Err("navigator.gpu is not available (browser without WebGPU)".into());
    }
    let instance = wgpu::Instance::new(wgpu::InstanceDescriptor {
        backends: wgpu::Backends::BROWSER_WEBGPU,
        ..wgpu::InstanceDescriptor::new_without_display_handle()
    });
    let adapter = instance
        .request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            ..Default::default()
        })
        .await
        .map_err(|e| format!("no WebGPU adapter: {e}"))?;
    let info = adapter.get_info();
    // A software adapter (SwiftShader, WARP) runs vello's compute shaders emulated on the CPU:
    // measured 45-220x slower than vello_cpu on the same machine (bench/results). Treat it as "no GPU".
    if info.device_type == wgpu::DeviceType::Cpu && !allow_software {
        return Err(format!(
            "software WebGPU adapter ({}), vello_cpu is faster",
            if info.name.is_empty() {
                "unnamed"
            } else {
                &info.name
            }
        ));
    }
    let (device, queue) = adapter
        .request_device(&wgpu::DeviceDescriptor {
            label: Some("paprika"),
            required_limits: wgpu::Limits::default(),
            ..Default::default()
        })
        .await
        .map_err(|e| format!("request_device failed: {e}"))?;
    // Validation errors are async on the web; surface them in the console instead of dropping them.
    let failure = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
    let on_error = failure.clone();
    device.on_uncaptured_error(std::sync::Arc::new(move |e: wgpu::Error| {
        web_sys::console::error_1(&format!("[paprika-render] wgpu: {e}").into());
        record_failure(&on_error, format!("wgpu: {e}"));
    }));
    let on_lost = failure.clone();
    device.set_device_lost_callback(move |reason, msg| {
        web_sys::console::error_1(
            &format!("[paprika-render] device lost ({reason:?}): {msg}").into(),
        );
        record_failure(&on_lost, format!("device lost ({reason:?}): {msg}"));
    });
    let renderer = vello::Renderer::new(
        &device,
        RendererOptions {
            use_cpu: false,
            antialiasing_support: AaSupport::area_only(),
            num_init_threads: None,
            pipeline_cache: None,
        },
    )
    .map_err(|e| format!("vello init failed: {e}"))?;

    let surface = instance
        .create_surface(wgpu::SurfaceTarget::Canvas(canvas.clone()))
        .map_err(|e| e.to_string())?;
    let (w, h) = (canvas.width().max(1), canvas.height().max(1));
    let caps = surface.get_capabilities(&adapter);
    let format = caps
        .formats
        .iter()
        .copied()
        .find(|f| {
            matches!(
                f,
                wgpu::TextureFormat::Rgba8Unorm | wgpu::TextureFormat::Bgra8Unorm
            )
        })
        .ok_or("no Rgba8Unorm/Bgra8Unorm surface format")?;
    let config = wgpu::SurfaceConfiguration {
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
        format,
        width: w,
        height: h,
        present_mode: wgpu::PresentMode::Fifo,
        desired_maximum_frame_latency: 2,
        // vello writes premultiplied color; a transparent background must composite as such.
        alpha_mode: if caps
            .alpha_modes
            .contains(&wgpu::CompositeAlphaMode::PreMultiplied)
        {
            wgpu::CompositeAlphaMode::PreMultiplied
        } else {
            wgpu::CompositeAlphaMode::Auto
        },
        view_formats: vec![],
        color_space: wgpu::SurfaceColorSpace::Auto,
    };
    surface.configure(&device, &config);
    let (target_tex, target) = target_view(&device, w, h);
    let blitter = wgpu::util::TextureBlitter::new(&device, format);
    Ok(Gpu {
        device,
        queue,
        surface,
        config,
        renderer,
        target,
        target_tex,
        readback: None,
        blitter,
        scene: vello::Scene::new(),
        adapter_info: format!("{} ({:?}, {})", info.name, info.device_type, info.driver),
        failure,
    })
}

fn init_cpu(canvas: &HtmlCanvasElement) -> Result<Cpu, JsValue> {
    let ctx = canvas
        .get_context("2d")?
        .ok_or("canvas already has a non-2d context")?
        .dyn_into::<CanvasRenderingContext2d>()?;
    Ok(Cpu {
        renderer: CpuRenderer::new(canvas.width() as u16, canvas.height() as u16),
        ctx,
    })
}

/// `mode`: `"auto"` (hardware WebGPU, else CPU), `"gpu"` (any WebGPU adapter, including a
/// software one; fails without WebGPU) or `"cpu"`.
#[wasm_bindgen(js_name = createRenderer)]
pub async fn create_renderer(canvas: HtmlCanvasElement, mode: String) -> Result<Renderer, JsValue> {
    let (width, height) = (canvas.width().max(1), canvas.height().max(1));
    let (backend, fallback_reason) = match mode.as_str() {
        "cpu" => (
            Backend::Cpu(Box::new(init_cpu(&canvas)?)),
            "forced by mode=cpu".to_string(),
        ),
        "gpu" => (
            Backend::Gpu(Box::new(init_gpu(&canvas, true).await.map_err(err)?)),
            String::new(),
        ),
        _ => match init_gpu(&canvas, false).await {
            Ok(g) => (Backend::Gpu(Box::new(g)), String::new()),
            Err(reason) => (Backend::Cpu(Box::new(init_cpu(&canvas)?)), reason),
        },
    };
    Ok(Renderer {
        backend,
        scene: scene::Scene::default(),
        width,
        height,
        fallback_reason,
        background: BACKGROUND,
    })
}

#[wasm_bindgen]
impl Renderer {
    /// `"webgpu"` or `"cpu"`.
    #[wasm_bindgen(getter)]
    pub fn backend(&self) -> String {
        match self.backend {
            Backend::Gpu(_) => "webgpu".into(),
            Backend::Cpu(_) => "cpu".into(),
        }
    }

    #[wasm_bindgen(getter, js_name = adapterInfo)]
    pub fn adapter_info(&self) -> String {
        match &self.backend {
            Backend::Gpu(g) => g.adapter_info.clone(),
            Backend::Cpu(_) => "vello_cpu (wasm32, single thread)".into(),
        }
    }

    /// First asynchronous GPU failure (device lost, uncaptured validation error), or empty. After
    /// one, frames can silently stop reaching the canvas, so the page must take the paint back.
    #[wasm_bindgen(getter, js_name = deviceError)]
    pub fn device_error(&self) -> String {
        match &self.backend {
            Backend::Gpu(g) => g.failure.lock().map(|f| f.clone()).unwrap_or_default(),
            Backend::Cpu(_) => String::new(),
        }
    }

    #[wasm_bindgen(getter, js_name = fallbackReason)]
    pub fn fallback_reason(&self) -> String {
        self.fallback_reason.clone()
    }

    /// Clear color in straight RGBA 0..1; alpha 0 keeps the canvas transparent.
    #[wasm_bindgen(js_name = setBackground)]
    pub fn set_background(&mut self, r: f32, g: f32, b: f32, a: f32) {
        self.background = [r, g, b, a];
    }

    /// Replaces the display list (see `scene::STRIDE` for the layout) and its path table
    /// (see `scene::parse_paths`).
    #[wasm_bindgen(js_name = setScene)]
    pub fn set_scene(&mut self, data: &[f32], paths: &str) {
        self.scene = scene::Scene::parse(data, paths);
    }

    pub fn resize(&mut self, width: u32, height: u32) {
        let (width, height) = (width.max(1), height.max(1));
        self.width = width;
        self.height = height;
        match &mut self.backend {
            Backend::Gpu(g) => {
                g.config.width = width;
                g.config.height = height;
                g.surface.configure(&g.device, &g.config);
                (g.target_tex, g.target) = target_view(&g.device, width, height);
            }
            Backend::Cpu(c) => c.renderer.resize(width as u16, height as u16),
        }
    }

    /// Draws one frame with the view transform `translate(tx, ty) · scale(zoom)` in device pixels.
    pub fn render(&mut self, tx: f64, ty: f64, zoom: f64) -> Result<(), JsValue> {
        self.render_inner(tx, ty, zoom, true)
    }

    /// Like [`Renderer::render`] but leaves the frame in the offscreen target (no blit/present).
    #[wasm_bindgen(js_name = renderOffscreen)]
    pub fn render_offscreen(&mut self, tx: f64, ty: f64, zoom: f64) -> Result<(), JsValue> {
        self.render_inner(tx, ty, zoom, false)
    }

    fn render_inner(&mut self, tx: f64, ty: f64, zoom: f64, present: bool) -> Result<(), JsValue> {
        let view = Affine::translate((tx, ty)) * Affine::scale(zoom);
        let (w, h) = (self.width, self.height);
        match &mut self.backend {
            Backend::Gpu(g) => {
                if let Some(f) = g.failure.lock().ok().filter(|f| !f.is_empty()) {
                    return Err(err(&*f));
                }
                g.scene.reset();
                scene::encode_gpu(&mut g.scene, &self.scene, view);
                let params = RenderParams {
                    base_color: Color::new(self.background),
                    width: w,
                    height: h,
                    antialiasing_method: AaConfig::Area,
                };
                g.renderer
                    .render_to_texture(&g.device, &g.queue, &g.scene, &g.target, &params)
                    .map_err(err)?;
                if !present {
                    return Ok(());
                }
                let frame = g.surface.get_current_texture();
                let frame = match frame {
                    wgpu::CurrentSurfaceTexture::Success(f)
                    | wgpu::CurrentSurfaceTexture::Suboptimal(f) => f,
                    other => return Err(err(format!("surface texture unavailable: {other:?}"))),
                };
                let view = frame
                    .texture
                    .create_view(&wgpu::TextureViewDescriptor::default());
                let mut enc = g
                    .device
                    .create_command_encoder(&wgpu::CommandEncoderDescriptor {
                        label: Some("blit"),
                    });
                g.blitter.copy(&g.device, &mut enc, &g.target, &view);
                g.queue.submit([enc.finish()]);
                g.queue.present(frame);
            }
            Backend::Cpu(c) => {
                let buf = c.renderer.render(&self.scene, view, self.background);
                let img = ImageData::new_with_u8_clamped_array_and_sh(Clamped(buf), w, h)?;
                c.ctx.put_image_data(&img, 0.0, 0.0)?;
            }
        }
        Ok(())
    }

    /// Copies the last vello frame (the offscreen target, before the blit) into a mappable
    /// buffer. Resolves once it can be read with [`Renderer::take_pixels`]. Used by tests: a
    /// headless browser without a real GPU cannot read a WebGPU canvas back.
    #[wasm_bindgen(js_name = readPixels)]
    pub fn read_pixels(&mut self) -> js_sys::Promise {
        let Backend::Gpu(g) = &mut self.backend else {
            return js_sys::Promise::reject(&"cpu backend: read the 2d canvas".into());
        };
        let (w, h) = (self.width, self.height);
        let row = (w * 4).div_ceil(256) * 256;
        let buf = g.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("readback"),
            size: (row * h) as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut enc = g
            .device
            .create_command_encoder(&wgpu::CommandEncoderDescriptor::default());
        enc.copy_texture_to_buffer(
            g.target_tex.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buf,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(row),
                    rows_per_image: Some(h),
                },
            },
            wgpu::Extent3d {
                width: w,
                height: h,
                depth_or_array_layers: 1,
            },
        );
        g.queue.submit([enc.finish()]);
        let slice = buf.slice(..);
        let promise = js_sys::Promise::new(&mut |resolve, reject| {
            slice.map_async(wgpu::MapMode::Read, move |r| {
                let _ = match r {
                    Ok(()) => resolve.call0(&JsValue::NULL),
                    Err(e) => reject.call1(&JsValue::NULL, &e.to_string().into()),
                };
            });
        });
        g.readback = Some((buf, row));
        promise
    }

    /// Tightly packed RGBA8 of the frame requested by [`Renderer::read_pixels`].
    #[wasm_bindgen(js_name = takePixels)]
    pub fn take_pixels(&mut self) -> Result<Vec<u8>, JsValue> {
        let Backend::Gpu(g) = &mut self.backend else {
            return Err("cpu backend".into());
        };
        let (buf, row) = g.readback.take().ok_or("call readPixels first")?;
        let data = buf.slice(..).get_mapped_range().map_err(err)?;
        let mut out = Vec::with_capacity((self.width * self.height * 4) as usize);
        for y in 0..self.height {
            let o = (y * row) as usize;
            out.extend_from_slice(&data[o..o + (self.width * 4) as usize]);
        }
        drop(data);
        buf.unmap();
        Ok(out)
    }

    /// Resolves when the GPU has finished the submitted work (no-op on CPU). Benchmarks await
    /// this so they time real GPU work instead of command submission only.
    pub fn finish(&self) -> js_sys::Promise {
        match &self.backend {
            Backend::Gpu(g) => {
                let queue = g.queue.clone();
                js_sys::Promise::new(&mut move |resolve, _reject| {
                    queue.on_submitted_work_done(move || {
                        let _ = resolve.call0(&JsValue::NULL);
                    });
                })
            }
            Backend::Cpu(_) => js_sys::Promise::resolve(&JsValue::NULL),
        }
    }
}
