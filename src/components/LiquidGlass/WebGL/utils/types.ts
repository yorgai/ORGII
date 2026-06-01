export type GL = WebGL2RenderingContext;

export interface ShaderSource {
  vertex: string;
  fragment: string;
}

export interface AttributeInfo {
  location: number;
  size: number;
  type: number;
}

export interface UniformInfo {
  location: WebGLUniformLocation;
  type: number;
  value: unknown;
  isArray:
    | false
    | {
        size: number;
      };
}

export interface RenderPassConfig {
  name: string;
  shader: ShaderSource;
  inputs?: { [uniformName: string]: string };
  outputToScreen?: boolean;
}
