//! Experimental renderer for the Paprika canvas.
//!
//! JS flattens the document into a *display list* (absolute boxes, already laid out by
//! `@paprika/core`), packed as `f32`s. Rust turns that list into vector shapes and rasterizes
//! them with **vello** (WebGPU compute) or **vello_cpu** (SIMD software rasterizer) when no
//! GPU adapter is available. Text and images are out of scope for this prototype.

pub mod cpu;
pub mod scene;
#[cfg(target_arch = "wasm32")]
mod web;
