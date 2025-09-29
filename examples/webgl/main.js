function createShader(gl, type, source) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, source);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh));
  }
  return sh;
}

function createProgram(gl, vsSource, fsSource) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(prog));
  }
  return prog;
}

function main() {
  const status = document.getElementById('status');
  const canvas = document.getElementById('gl-canvas');
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
  if (!gl) {
    status.textContent = 'WebGL is not supported in this browser.';
    return;
  }

  const vs = `
    attribute vec2 a_pos;
    void main() {
      gl_Position = vec4(a_pos, 0.0, 1.0);
    }
  `;
  const fs = `
    precision mediump float;
    void main() {
      gl_FragColor = vec4(0.9, 0.15, 0.15, 1.0);
    }
  `;
  const prog = createProgram(gl, vs, fs);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    0.0, 0.8,
   -0.8, -0.8,
    0.8, -0.8,
  ]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a_pos');

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0.02, 0.05, 0.10, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(prog);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  status.textContent = 'WebGL initialized (triangle rendered).';
}

main();
