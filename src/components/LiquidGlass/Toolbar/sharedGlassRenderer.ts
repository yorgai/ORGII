/**
 * SharedGlassRenderer - Singleton WebGL Renderer
 *
 * PERFORMANCE OPTIMIZATION:
 * Instead of each LiquidGlassToolbar creating its own WebGL context,
 * we use a SINGLE shared WebGL context and render all toolbars in one pass.
 *
 * Memory savings:
 * - Before: 6-8 WebGL contexts × ~15-20MB each = 90-160MB
 * - After: 1 WebGL context = ~20MB (saves ~80-140MB)
 *
 * How it works:
 * 1. Single offscreen canvas with WebGL2 context
 * 2. Single background texture (loaded once)
 * 3. Each toolbar registers with position/size/preset
 * 4. One RAF loop renders all registered toolbars
 * 5. Results are copied to each toolbar's canvas via 2D context
 */
import FragmentBgHblurShader from "../WebGL/shaders/fragment-bg-hblur.glsl";
import FragmentBgVblurShader from "../WebGL/shaders/fragment-bg-vblur.glsl";
import FragmentBgShader from "../WebGL/shaders/fragment-bg.glsl";
import FragmentMainShader from "../WebGL/shaders/fragment-main.glsl";
import VertexShader from "../WebGL/shaders/vertex.glsl";
import { MultiPassRenderer, loadTextureFromURL } from "../WebGL/utils/glUtils";
import {
  type BackgroundSource,
  NONE_SOURCE,
  sourceEquals,
} from "./backgroundSource";
import { GlassPreset, computeGaussianKernelByRadius } from "./config";

// ============================================
// Types
// ============================================

export interface ToolbarRenderConfig {
  /** Unique ID for this toolbar */
  id: string;
  /** Target canvas to copy result to */
  canvas: HTMLCanvasElement;
  /** Glass effect preset */
  preset: GlassPreset;
  /** Border radius */
  radius: number;
  /** Background container selector */
  backgroundContainerSelector: string;
  /** Callback when background is ready */
  onBackgroundReady?: (ready: boolean) => void;
}

// ============================================
// Singleton Class
// ============================================

class SharedGlassRendererClass {
  private static instance: SharedGlassRendererClass | null = null;

  // WebGL resources (single instance)
  private offscreenCanvas: HTMLCanvasElement | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private renderer: MultiPassRenderer | null = null;

  // Background texture (single instance)
  private bgTexture: WebGLTexture | null = null;
  private bgTextureRatio: number = 1;
  private bgTextureReady: boolean = false;
  // Single source of truth for which background is currently bound.
  // Replaces the prior split-brain (currentBackgroundUrl + currentBackgroundColor).
  private currentSource: BackgroundSource = NONE_SOURCE;
  // Token to invalidate in-flight image loads when the source changes mid-load.
  private loadToken: number = 0;

  // Blur weights cache (keyed by blur radius)
  private blurWeightsCache: Map<number, number[]> = new Map();

  // Registered toolbars
  private toolbars: Map<string, ToolbarRenderConfig> = new Map();

  // Render loop
  private rafId: number | null = null;
  private isRunning: boolean = false;

  // Dirty-based rendering (performance optimization)
  private isDirty: boolean = true;
  private idleFrames: number = 0; // Tracks consecutive idle frames for auto-stop
  private lastActivityTime: number = 0; // Timestamp of last resize/scroll event
  private lastPositions: Map<
    string,
    { left: number; top: number; width: number; height: number }
  > = new Map();
  private resizeObserver: ResizeObserver | null = null;
  private scrollHandler: (() => void) | null = null;
  private resizeHandler: (() => void) | null = null;

  // Initialization state
  private isInitialized: boolean = false;
  private initError: Error | null = null;

  private constructor() {
    // Private constructor for singleton
    this.setupEventListeners();
  }

  /**
   * Setup event listeners for dirty-based rendering
   */
  private setupEventListeners(): void {
    // Mark dirty on scroll (toolbars may move relative to background)
    this.scrollHandler = () => {
      this.markDirty();
    };
    window.addEventListener("scroll", this.scrollHandler, { passive: true });

    // Mark dirty on resize - force layout flush before rendering
    this.resizeHandler = () => {
      // Use RAF to ensure layout is complete before marking dirty
      // This is crucial when expanding the window
      requestAnimationFrame(() => {
        this.markDirty();
      });
    };
    window.addEventListener("resize", this.resizeHandler, { passive: true });

    // ResizeObserver for canvas size changes
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(() => {
        // Force layout flush before marking dirty
        requestAnimationFrame(() => {
          this.markDirty();
        });
      });
    }
  }

  /**
   * Mark renderer as dirty - needs to re-render
   */
  public markDirty(): void {
    this.isDirty = true;
    this.idleFrames = 0; // Reset idle counter to restart continuous rendering
    this.lastActivityTime = Date.now(); // Track when activity occurred
    // Schedule a render if not already scheduled
    if (this.isRunning && this.rafId === null) {
      this.rafId = requestAnimationFrame(this.renderLoop);
    }
  }

  public static getInstance(): SharedGlassRendererClass {
    if (!SharedGlassRendererClass.instance) {
      SharedGlassRendererClass.instance = new SharedGlassRendererClass();
    }
    return SharedGlassRendererClass.instance;
  }

  /**
   * Check if WebGL2 is supported
   */
  public isSupported(): boolean {
    return typeof WebGL2RenderingContext !== "undefined";
  }

  /**
   * Initialize the shared WebGL context
   */
  private initialize(): boolean {
    if (this.isInitialized) return !this.initError;
    if (!this.isSupported()) {
      this.initError = new Error("WebGL2 not supported");
      return false;
    }

    try {
      // Create offscreen canvas - use a reasonable size
      // The actual rendering will resize based on each toolbar
      this.offscreenCanvas = document.createElement("canvas");
      this.offscreenCanvas.width = 512;
      this.offscreenCanvas.height = 64;

      // Get WebGL2 context
      this.gl = this.offscreenCanvas.getContext("webgl2", {
        alpha: true,
        premultipliedAlpha: true,
        antialias: false,
        preserveDrawingBuffer: true, // Need this for copying to 2D canvases
      });

      if (!this.gl) {
        throw new Error("Failed to create WebGL2 context");
      }

      // Check float texture extension
      const ext = this.gl.getExtension("EXT_color_buffer_float");
      if (!ext) {
        throw new Error("EXT_color_buffer_float not supported");
      }

      // Create multi-pass renderer
      this.renderer = new MultiPassRenderer(this.offscreenCanvas, [
        {
          name: "bgPass",
          shader: { vertex: VertexShader, fragment: FragmentBgShader },
        },
        {
          name: "vBlurPass",
          shader: { vertex: VertexShader, fragment: FragmentBgVblurShader },
          inputs: { u_prevPassTexture: "bgPass" },
        },
        {
          name: "hBlurPass",
          shader: { vertex: VertexShader, fragment: FragmentBgHblurShader },
          inputs: { u_prevPassTexture: "vBlurPass" },
        },
        {
          name: "mainPass",
          shader: { vertex: VertexShader, fragment: FragmentMainShader },
          inputs: { u_blurredBg: "hBlurPass", u_bg: "bgPass" },
          outputToScreen: true,
        },
      ]);

      this.isInitialized = true;
      return true;
    } catch (error) {
      console.error("[SharedGlassRenderer] Initialization failed:", error);
      this.initError = error as Error;
      return false;
    }
  }

  /**
   * Get blur weights for a given radius (cached)
   */
  private getBlurWeights(radius: number): number[] {
    if (!this.blurWeightsCache.has(radius)) {
      this.blurWeightsCache.set(radius, computeGaussianKernelByRadius(radius));
    }
    return this.blurWeightsCache.get(radius)!;
  }

  /**
   * Check if background is ready
   */
  public isBackgroundReady(): boolean {
    return this.bgTextureReady;
  }

  /**
   * Single declarative entry point for switching the background.
   *
   * Replaces the prior trio of loadBackgroundTexture / setBackgroundColor /
   * clearBackground. Callers describe what they want as a BackgroundSource;
   * this method resolves the transition (including disposing the previous
   * texture and invalidating any in-flight async image load).
   */
  public setBackground(source: BackgroundSource): void {
    // Structural dedup: if nothing actually changed, skip work entirely.
    if (sourceEquals(source, this.currentSource)) return;

    // Any prior in-flight image load is now stale.
    const myToken = ++this.loadToken;
    this.currentSource = source;

    if (source.kind === "none") {
      this.applyNone();
      return;
    }

    if (!this.initialize() || !this.gl) return;

    if (source.kind === "color") {
      this.applyColor(source.value);
      return;
    }

    // source.kind === "image"
    this.applyImage(source.url, myToken);
  }

  private applyNone(): void {
    this.bgTextureReady = false;
    if (this.bgTexture && this.gl) {
      this.gl.deleteTexture(this.bgTexture);
      this.bgTexture = null;
    }
    this.notifyReady(false);
    this.markDirty();
  }

  private applyColor(color: string): void {
    if (!this.gl) return;
    const gl = this.gl;

    this.bgTextureReady = false;
    this.notifyReady(false);

    const canvas = document.createElement("canvas");
    canvas.width = 4;
    canvas.height = 4;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 4, 4);

    const texture = gl.createTexture();
    if (!texture) return;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    if (this.bgTexture) {
      gl.deleteTexture(this.bgTexture);
    }

    this.bgTexture = texture;
    this.bgTextureRatio = 1;
    this.bgTextureReady = true;

    this.markDirty();
    this.notifyReady(true);
  }

  private applyImage(url: string, token: number): void {
    if (!this.gl) return;

    this.bgTextureReady = false;
    this.notifyReady(false);

    loadTextureFromURL(this.gl, url)
      .then(({ texture, ratio }) => {
        // If another setBackground() ran while we were loading, drop this result.
        if (token !== this.loadToken || !this.gl) {
          this.gl?.deleteTexture(texture);
          return;
        }

        if (this.bgTexture) {
          this.gl.deleteTexture(this.bgTexture);
        }

        this.bgTexture = texture;
        this.bgTextureRatio = ratio;
        this.bgTextureReady = true;

        this.markDirty();
        this.notifyReady(true);
      })
      .catch((error) => {
        if (token !== this.loadToken) return;
        console.error("[SharedGlassRenderer] Background load failed:", error);
        this.bgTextureReady = false;
        this.notifyReady(false);
      });
  }

  private notifyReady(ready: boolean): void {
    this.toolbars.forEach((config) => {
      config.onBackgroundReady?.(ready);
    });
  }

  /**
   * Register a toolbar for rendering
   */
  public registerToolbar(config: ToolbarRenderConfig): void {
    if (!this.initialize()) return;

    this.toolbars.set(config.id, config);

    // Observe canvas for size changes
    if (this.resizeObserver) {
      this.resizeObserver.observe(config.canvas);
    }

    // Mark dirty for initial render
    this.markDirty();

    // Start render loop if not running
    if (!this.isRunning && this.toolbars.size > 0) {
      this.start();
    }

    // Notify about current background state
    config.onBackgroundReady?.(this.bgTextureReady);
  }

  /**
   * Unregister a toolbar
   */
  public unregisterToolbar(id: string): void {
    const config = this.toolbars.get(id);
    if (config && this.resizeObserver) {
      this.resizeObserver.unobserve(config.canvas);
    }

    this.toolbars.delete(id);
    this.lastPositions.delete(id);

    // Stop render loop if no toolbars
    if (this.toolbars.size === 0) {
      this.stop();
    }
  }

  /**
   * Update toolbar configuration
   */
  public updateToolbar(
    id: string,
    updates: Partial<ToolbarRenderConfig>
  ): void {
    const config = this.toolbars.get(id);
    if (config) {
      Object.assign(config, updates);
      this.markDirty();
    }
  }

  /**
   * Start the render loop
   */
  private start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isDirty = true;
    this.lastActivityTime = Date.now(); // Initialize activity timestamp
    this.rafId = requestAnimationFrame(this.renderLoop);
  }

  /**
   * Stop the render loop
   */
  private stop(): void {
    this.isRunning = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  /**
   * Check if any toolbar has moved (position changed)
   */
  private checkPositionChanges(): boolean {
    let hasChanges = false;

    this.toolbars.forEach((config, id) => {
      const rect = config.canvas.getBoundingClientRect();
      const lastPos = this.lastPositions.get(id);

      if (
        !lastPos ||
        lastPos.left !== rect.left ||
        lastPos.top !== rect.top ||
        lastPos.width !== rect.width ||
        lastPos.height !== rect.height
      ) {
        this.lastPositions.set(id, {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        });
        hasChanges = true;
      }
    });

    return hasChanges;
  }

  /**
   * Main render loop - renders all registered toolbars
   *
   * PERFORMANCE OPTIMIZATION:
   * - During active resize/scroll: renders every frame at 60fps (no checks)
   * - Continues for 1.5 seconds after last activity to catch slow resizing
   * - When idle: only renders when positions change
   * - Auto-stops after 60 idle frames to save CPU
   */
  private renderLoop = (): void => {
    if (!this.isRunning) {
      this.rafId = null;
      return;
    }

    const timeSinceLastActivity = Date.now() - this.lastActivityTime;
    const isRecentlyActive = timeSinceLastActivity < 1500; // Extended to 1.5 seconds for window expansion

    let shouldRender = false;

    if (isRecentlyActive || this.isDirty) {
      // During active resize/scroll: always render (no expensive checks)
      shouldRender = true;
    } else {
      // When idle: only render if positions changed
      shouldRender = this.checkPositionChanges();
    }

    if (shouldRender) {
      // Render each toolbar
      this.toolbars.forEach((config) => {
        this.renderToolbar(config);
      });

      // Clear dirty flag after rendering
      this.isDirty = false;

      // Reset idle counter when actively rendering
      this.idleFrames = 0;
    } else {
      // Increment idle counter when nothing changed
      this.idleFrames++;
    }

    // Continue RAF while recently active or still checking for changes
    this.rafId = null;
    if (this.isRunning && (isRecentlyActive || this.idleFrames < 60)) {
      this.rafId = requestAnimationFrame(this.renderLoop);
    }
  };

  /**
   * Render a single toolbar
   */
  private renderToolbar(config: ToolbarRenderConfig): void {
    if (!this.gl || !this.renderer || !this.offscreenCanvas) return;

    const { canvas, preset, radius, backgroundContainerSelector } = config;
    const gl = this.gl;
    const dpr = window.devicePixelRatio || 1;

    // Get canvas dimensions
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (width <= 0 || height <= 0) return;

    // Resize offscreen canvas to match toolbar
    const targetWidth = width * dpr;
    const targetHeight = height * dpr;

    if (
      this.offscreenCanvas.width !== targetWidth ||
      this.offscreenCanvas.height !== targetHeight
    ) {
      this.offscreenCanvas.width = targetWidth;
      this.offscreenCanvas.height = targetHeight;
      gl.viewport(0, 0, targetWidth, targetHeight);
      this.renderer.resize(targetWidth, targetHeight);
    }

    // Clear
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Get element's position relative to background
    const rect = canvas.getBoundingClientRect();
    const bgContainer = backgroundContainerSelector
      ? document.querySelector(backgroundContainerSelector)
      : null;

    let bgRect: DOMRect;
    if (bgContainer) {
      bgRect = bgContainer.getBoundingClientRect();
    } else {
      bgRect = new DOMRect(0, 0, window.innerWidth, window.innerHeight);
    }

    const relativeLeft = rect.left - bgRect.left;
    const relativeTop = rect.top - bgRect.top;
    const viewportWidth = bgRect.width;
    const viewportHeight = bgRect.height;

    // Shape settings
    const shapeWidth = width;
    const shapeHeight = height;
    const maxRadius = Math.min(width, height) / 2;
    const shapeRadius = Math.min(radius, maxRadius);

    // Get blur weights
    const blurWeights = this.getBlurWeights(preset.blurRadius);

    // Set uniforms
    this.renderer.setUniforms({
      u_resolution: [targetWidth, targetHeight],
      u_dpr: dpr,
      u_blurWeights: blurWeights,
      u_blurRadius: preset.blurRadius,
      u_mouse: [targetWidth / 2, targetHeight / 2],
      u_mouseSpring: [targetWidth / 2, targetHeight / 2],
      u_shapeWidth: shapeWidth,
      u_shapeHeight: shapeHeight,
      u_shapeRadius: shapeRadius,
      u_shapeRoundness: preset.shapeRoundness,
      u_mergeRate: 0,
      u_glareAngle: (preset.glareAngle * Math.PI) / 180,
      u_showShape1: 0,
    });

    // Render passes
    this.renderer.render({
      bgPass: {
        u_bgType: this.bgTextureReady ? 3 : 0,
        u_bgTexture: this.bgTexture ?? undefined,
        u_bgTextureRatio: this.bgTextureRatio,
        u_bgTextureReady: this.bgTextureReady ? 1 : 0,
        u_shadowExpand: preset.shadowExpand,
        u_shadowFactor: preset.shadowFactor / 100,
        u_shadowPosition: [-preset.shadowPosition.x, -preset.shadowPosition.y],
        u_elementPosition: [relativeLeft, relativeTop],
        u_elementSize: [rect.width, rect.height],
        u_viewportSize: [viewportWidth, viewportHeight],
      },
      mainPass: {
        u_tint: [
          preset.tint.r / 255,
          preset.tint.g / 255,
          preset.tint.b / 255,
          preset.tint.a,
        ],
        u_refThickness: preset.refThickness,
        u_refFactor: preset.refFactor,
        u_refDispersion: preset.refDispersion,
        u_refFresnelRange: preset.refFresnelSize,
        u_refFresnelHardness: preset.refFresnelHardness / 100,
        u_refFresnelFactor: preset.refFresnelIntensity / 100,
        u_glareRange: preset.glareSize,
        u_glareHardness: preset.glareHardness / 100,
        u_glareConvergence: preset.glareConvergence / 100,
        u_glareOppositeFactor: preset.glareOpposite / 100,
        u_glareFactor: preset.glareIntensity / 100,
        u_blurEdge: preset.blurEdge ? 1 : 0,
        STEP: 9,
      },
    });

    // Copy result to toolbar's canvas using 2D context
    this.copyToCanvas(canvas, targetWidth, targetHeight, dpr);
  }

  /**
   * Copy WebGL result to a 2D canvas
   */
  private copyToCanvas(
    targetCanvas: HTMLCanvasElement,
    width: number,
    height: number,
    _dpr: number
  ): void {
    if (!this.offscreenCanvas) return;

    // Update target canvas size if needed
    if (targetCanvas.width !== width || targetCanvas.height !== height) {
      targetCanvas.width = width;
      targetCanvas.height = height;
    }

    // Get 2D context and draw
    const ctx = targetCanvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(this.offscreenCanvas, 0, 0);
    }
  }

  /**
   * Dispose all resources
   */
  public dispose(): void {
    this.stop();

    // Clean up event listeners
    if (this.scrollHandler) {
      window.removeEventListener("scroll", this.scrollHandler);
      this.scrollHandler = null;
    }
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      this.resizeHandler = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }

    if (this.bgTexture && this.gl) {
      this.gl.deleteTexture(this.bgTexture);
      this.bgTexture = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer = null;
    }

    this.gl = null;
    this.offscreenCanvas = null;
    this.toolbars.clear();
    this.blurWeightsCache.clear();
    this.lastPositions.clear();
    this.currentSource = NONE_SOURCE;
    this.loadToken++;
    this.bgTextureReady = false;
    this.isInitialized = false;
    this.initError = null;
  }

  /**
   * Get debug info
   */
  public getDebugInfo(): {
    toolbarCount: number;
    isRunning: boolean;
    isDirty: boolean;
    bgReady: boolean;
    memoryEstimate: string;
  } {
    return {
      toolbarCount: this.toolbars.size,
      isRunning: this.isRunning,
      isDirty: this.isDirty,
      bgReady: this.bgTextureReady,
      memoryEstimate: "~20MB (single shared context, dirty-based rendering)",
    };
  }
}

// Export singleton accessor
export const SharedGlassRenderer = SharedGlassRendererClass.getInstance();
export default SharedGlassRenderer;
