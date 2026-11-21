#!/usr/bin/env bash
# Builds the WASM package into ./pkg (needs: rustup target add wasm32-unknown-unknown;
# cargo install wasm-bindgen-cli --version 0.2.130).
set -euo pipefail
cd "$(dirname "$0")"
cargo build --release --target wasm32-unknown-unknown
wasm-bindgen --target web --out-dir pkg target/wasm32-unknown-unknown/release/paprika_render.wasm
ls -l pkg/paprika_render_bg.wasm
