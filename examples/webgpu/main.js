async function main() {
  const status = document.getElementById('status');
  const canvas = document.getElementById('gpu-canvas');
  if (!('gpu' in navigator)) { status.textContent = 'WebGPU is not supported in this browser.'; return; }
  try {
    const adapter = await navigator.gpu.requestAdapter();
    const device = await adapter.requestDevice();
    const context = canvas.getContext('webgpu');
    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: 'opaque' });

    const shader = device.createShaderModule({
      code: /* wgsl */`
        @vertex
        fn vs_main(@builtin(vertex_index) VertexIndex : u32) -> @builtin(position) vec4f {
          var pos = array<vec2f, 3>(
            vec2f(0.0, 0.7),
            vec2f(-0.7, -0.7),
            vec2f(0.7, -0.7),
          );
          let p = pos[VertexIndex];
          return vec4f(p, 0.0, 1.0);
        }
        @fragment
        fn fs_main() -> @location(0) vec4f {
          // Bright red triangle
          return vec4f(0.9, 0.15, 0.15, 1.0);
        }
      `
    });

    const pipeline = device.createRenderPipeline({
      layout: 'auto',
      vertex: { module: shader, entryPoint: 'vs_main' },
      fragment: { module: shader, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list' }
    });

    let frames = 0;
    function frame() {
      const encoder = device.createCommandEncoder();
      const currentTex = context.getCurrentTexture();
      const view = currentTex.createView();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view,
            clearValue: { r: 0.02, g: 0.05, b: 0.10, a: 1 },
            loadOp: 'clear',
            storeOp: 'store',
          }
        ]
      });
      pass.setPipeline(pipeline);
      pass.draw(3, 1, 0, 0);
      pass.end();
      // Read back center region before presenting
      if (frames === 0) {
        // Compute average color of a 200x200 center region via copyTextureToBuffer + mapAsync
        const region = { w: 200, h: 200 };
        const origin = { x: Math.max(0, Math.floor(canvas.width/2 - region.w/2)), y: Math.max(0, Math.floor(canvas.height/2 - region.h/2)) };
        const bytesPerPixel = 4; // rgba/bgra 8-bit
        const align = 256;
        const bytesPerRow = Math.ceil(region.w * bytesPerPixel / align) * align;
        const size = bytesPerRow * region.h;
        const buf = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        encoder.copyTextureToBuffer({ texture: currentTex, origin: { x: origin.x, y: origin.y, z: 0 } }, { buffer: buf, bytesPerRow, rowsPerImage: region.h }, { width: region.w, height: region.h, depthOrArrayLayers: 1 });
        device.queue.submit([encoder.finish()]);
        buf.mapAsync(GPUMapMode.READ).then(() => {
          const arr = new Uint8Array(buf.getMappedRange());
          let r=0,g=0,b=0,n=0;
          const rIdx = format.includes('bgra') ? 2 : 0;
          const gIdx = 1;
          const bIdx = format.includes('bgra') ? 0 : 2;
          for (let y=0; y<region.h; y+=4) {
            for (let x=0; x<region.w; x+=4) {
              const off = y*bytesPerRow + x*bytesPerPixel;
              r += arr[off + rIdx]; g += arr[off + gIdx]; b += arr[off + bIdx]; n++;
            }
          }
          const avg = [Math.round(r/n), Math.round(g/n), Math.round(b/n)];
          window.__TEST = { avg };
          buf.unmap();
        }).catch(()=>{});
      } else {
        device.queue.submit([encoder.finish()]);
      }
      frames++;
      if (frames < 30) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    status.textContent = 'WebGPU initialized (triangle rendered).';

    // Compute average color in the center region as a simple, portable "baseline"
    setTimeout(() => {
      const url = canvas.toDataURL('image/webp', 0.8);
      const img = new Image();
      img.onload = () => {
        const aux = document.createElement('canvas');
        aux.width = canvas.width; aux.height = canvas.height;
        const ctx2d = aux.getContext('2d');
        ctx2d.drawImage(img, 0, 0);
        // Sample a 200x200 region around the center
        const cx = Math.floor(aux.width / 2 - 100);
        const cy = Math.floor(aux.height / 2 - 100);
        const w = 200, h = 200;
        const data = ctx2d.getImageData(cx, cy, w, h).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let y = 0; y < h; y += 4) {
          for (let x = 0; x < w; x += 4) {
            const i = ((y * w) + x) * 4;
            r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
          }
        }
        const avg = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
        window.__TEST = { avg, url };
        // Also update status for human check
        status.textContent += ` AvgRGB=${avg.join(',')}`;
      };
      img.src = url;
    }, 300);
  } catch (err) {
    console.error(err);
    status.textContent = 'Failed to initialize WebGPU.';
  }
}

main();
