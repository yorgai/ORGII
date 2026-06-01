import { FrameBuffer } from "./FrameBuffer";
import { ShaderProgram } from "./ShaderProgram";
import type { GL, RenderPassConfig, ShaderSource } from "./types";

export class RenderPass {
  private gl: GL;
  private program: ShaderProgram;
  private frameBuffer: FrameBuffer | null;
  private vao: WebGLVertexArrayObject;
  public config: RenderPassConfig;

  constructor(
    gl: GL,
    shaderSource: ShaderSource,
    outputToScreen: boolean = false
  ) {
    this.gl = gl;
    this.config = { name: "", shader: shaderSource };
    this.program = new ShaderProgram(gl, shaderSource);
    this.frameBuffer = !outputToScreen
      ? new FrameBuffer(gl, gl.canvas.width, gl.canvas.height)
      : null;
    this.vao = this.createVAO();
  }

  private createVAO(): WebGLVertexArrayObject {
    const gl = this.gl;

    const vao = gl.createVertexArray();
    if (!vao) throw new Error("Failed to create VAO");
    gl.bindVertexArray(vao);

    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Failed to create buffer");

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const positionLoc = this.program.getAttributeLocation("a_position");
    gl.enableVertexAttribArray(positionLoc);
    gl.vertexAttribPointer(positionLoc, 2, gl.FLOAT, false, 0, 0);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    return vao;
  }

  public setConfig(config: RenderPassConfig) {
    this.config = config;
  }

  public render(uniforms?: Record<string, unknown>): void {
    const gl = this.gl;

    if (this.frameBuffer) {
      this.frameBuffer.bind();
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    this.program.use();

    if (uniforms) {
      let textureCount = 0;
      Object.entries(uniforms).forEach(([name, value]) => {
        if (value instanceof WebGLTexture) {
          gl.activeTexture(gl.TEXTURE0 + textureCount);
          gl.bindTexture(gl.TEXTURE_2D, value);
          this.program.setUniform(name, textureCount);
          textureCount += 1;
        } else {
          this.program.setUniform(name, value);
        }
      });
    }

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);

    if (this.frameBuffer) {
      this.frameBuffer.unbind();
    }
  }

  public getOutputTexture(): WebGLTexture | null {
    return this.frameBuffer ? this.frameBuffer.getTexture() : null;
  }

  public resize(width: number, height: number): void {
    if (this.frameBuffer) {
      this.frameBuffer.resize(width, height);
    }
  }

  public dispose(): void {
    if (this.frameBuffer) {
      this.frameBuffer.dispose();
    }
    this.program.dispose();

    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    const buffer = gl.getVertexAttrib(0, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.deleteBuffer(buffer);

    gl.deleteVertexArray(this.vao);
  }
}
