#version 300 es

precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_dpr;
uniform vec2 u_mouse;
uniform vec2 u_mouseSpring;
uniform float u_time;
uniform float u_mergeRate;
uniform float u_shapeWidth;
uniform float u_shapeHeight;
uniform float u_shapeRadius;
uniform float u_shapeRoundness;
uniform float u_shadowExpand;
uniform float u_shadowFactor;
uniform vec2 u_shadowPosition;
uniform int u_bgType;
uniform sampler2D u_bgTexture;
uniform float u_bgTextureRatio;
uniform int u_bgTextureReady;
uniform int u_showShape1;

// Element position for correct background sampling (toolbar mode)
uniform vec2 u_elementPosition;  // Element's top-left position in viewport
uniform vec2 u_elementSize;      // Element's size in viewport
uniform vec2 u_viewportSize;     // Full viewport size

float chessboard(vec2 uv, float size, int mode) {
  float yBars = step(size * 2.0, mod(uv.y * 2.0, size * 4.0));
  float xBars = step(size * 2.0, mod(uv.x * 2.0, size * 4.0));

  if (mode == 0) {
    return yBars;
  } else if (mode == 1) {
    return xBars;
  } else {
    return abs(yBars - xBars);
  }
}

float halfColor(vec2 uv) {
  if (uv.y > 0.5) {
    return 1.0;
  } else {
    return 0.0;
  }
}

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

float superellipseCornerSDF(vec2 p, float r, float n) {
  p = abs(p);
  float v = pow(pow(p.x, n) + pow(p.y, n), 1.0 / n);
  return v - r;
}

float roundedRectSDF(vec2 p, vec2 center, float width, float height, float cornerRadius, float n) {
  // 移动到中心坐标系
  p -= center;

  float cr = cornerRadius * u_dpr;

  // 计算到矩形边缘的距离
  vec2 d = abs(p) - vec2(width * u_dpr, height * u_dpr) * 0.5;

  // 对于边缘区域和角落，我们需要不同的处理
  float dist;

  if (d.x > -cr && d.y > -cr) {
    // 角落区域
    vec2 cornerCenter = sign(p) * (vec2(width * u_dpr, height * u_dpr) * 0.5 - vec2(cr));
    vec2 cornerP = p - cornerCenter;
    dist = superellipseCornerSDF(cornerP, cr, n);
  } else {
    // 内部和边缘区域
    dist = min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
  }

  return dist;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float sdgMin(float a, float b) {
  return a < b
    ? a
    : b;
}

float mainSDF(vec2 p1, vec2 p2, vec2 p) {
  vec2 p1n = p1 + p / u_resolution.y;
  vec2 p2n = p2 + p / u_resolution.y;
  float d1 = u_showShape1 == 1 ? sdCircle(p1n, 100.0 * u_dpr / u_resolution.y) : 1.0;
  // float d2 = sdSuperellipse(p2, 200.0 / u_resolution.y, 4.0).x;
  float d2 = roundedRectSDF(
    p2n,
    vec2(0.0),
    u_shapeWidth / u_resolution.y,
    u_shapeHeight / u_resolution.y,
    u_shapeRadius / u_resolution.y,
    u_shapeRoundness
  );

  return smin(d1, d2, u_mergeRate);
}

// CSS background-size: cover simulation
// Input: uv (0-1), container aspect ratio, texture aspect ratio
// Output: transformed UV for texture sampling that mimics CSS cover behavior
vec2 getCoverUV(vec2 uv, float containerAspect, float textureAspect) {
  // CSS cover: scale the image so it fills the container, cropping if necessary
  // The image maintains aspect ratio and is centered
  
  if (containerAspect > textureAspect) {
    // Container is wider than texture
    // Texture fills width, overflows in height -> sample smaller Y range (centered)
    float scale = containerAspect / textureAspect;
    uv.y = (uv.y - 0.5) / scale + 0.5;
  } else {
    // Container is taller than texture (or equal)
    // Texture fills height, overflows in width -> sample smaller X range (centered)
    float scale = textureAspect / containerAspect;
    uv.x = (uv.x - 0.5) / scale + 0.5;
  }
  
  return uv;
}

void main() {
  vec2 u_resolution1x = u_resolution.xy / u_dpr;
  // float chessboardBg = chessboard(gl_FragCoord.xy, 14.0);
  vec3 bgColor = vec3(1.0);

  if (u_bgType <= 0) {
    // chessboard
    bgColor = vec3(1.0 - chessboard(gl_FragCoord.xy / u_dpr, 20.0, 2) / 4.0);
  } else if (u_bgType <= 1) {
    if (v_uv.x < 0.5 && v_uv.y > 0.5) {
      bgColor = vec3(chessboard(gl_FragCoord.xy / u_dpr, 10.0, 0));
    } else if (v_uv.x > 0.5 && v_uv.y < 0.5) {
      bgColor = vec3(chessboard(gl_FragCoord.xy / u_dpr, 10.0, 1));
    } else if (v_uv.x < 0.5 && v_uv.y < 0.5) {
      bgColor = vec3(0.0);
    }
  } else if (u_bgType <= 2) {
    bgColor = vec3(halfColor(gl_FragCoord.xy / u_resolution) * 0.6 + 0.3);
  } else if (u_bgType <= 11) {
    if (u_bgTextureReady != 1) {
      // chessboard
      bgColor = vec3(1.0 - chessboard(gl_FragCoord.xy / u_dpr, 20.0, 2) / 4.0);
    } else {
      // Transform element-local UV to background-container UV based on element position
      vec2 bgUV;
      if (u_viewportSize.x > 0.0 && u_viewportSize.y > 0.0) {
        // Calculate the pixel position within the background container
        // v_uv is 0-1 within this element (WebGL coordinate system: 0,0 = bottom-left)
        // Screen/CSS coordinate system: 0,0 = top-left, Y increases downward
        // 
        // Key transformation: flip Y-axis between WebGL and screen space
        // - v_uv.y = 0 (bottom in WebGL) -> elementTop + elementHeight (bottom in screen)
        // - v_uv.y = 1 (top in WebGL) -> elementTop (top in screen)
        
        float screenX = u_elementPosition.x + v_uv.x * u_elementSize.x;
        float screenY = u_elementPosition.y + (1.0 - v_uv.y) * u_elementSize.y;
        
        // Convert screen position to normalized background container UV (0-1)
        bgUV = vec2(screenX / u_viewportSize.x, screenY / u_viewportSize.y);
      } else {
        // Fallback: no position tracking, use element-local UV
        bgUV = v_uv;
      }
      
      // Apply CSS background-size: cover transformation
      // The background container aspect ratio is what matters, not the canvas aspect ratio
      float containerAspect = u_viewportSize.x / u_viewportSize.y;
      vec2 textureUV = getCoverUV(bgUV, containerAspect, u_bgTextureRatio);

      // Flip Y back to WebGL coordinates for texture sampling
      // The texture was loaded with UNPACK_FLIP_Y_WEBGL=true, so it expects bottom-up coordinates
      // But bgUV is in screen coordinates (top-down), so we need to flip it back
      textureUV.y = 1.0 - textureUV.y;

      // Sample the texture (CLAMP_TO_EDGE handles out-of-bounds)
      bgColor = texture(u_bgTexture, textureUV).rgb;
    }
  }

  // float chessboardBg = 1.0 - chessboard(gl_FragCoord.xy / u_dpr, 10.0) / 4.0;
  // float halfColorBg = halfColor(gl_FragCoord.xy / u_resolution);

  // draw shadow
  // center of shape 1
  vec2 p1 =
    (vec2(0, 0) -
      u_resolution.xy * 0.5 +
      vec2(u_shadowPosition.x * u_dpr, u_shadowPosition.y * u_dpr)) /
    u_resolution.y;
  // center of shape 2
  vec2 p2 =
    (vec2(0, 0) - u_mouseSpring + vec2(u_shadowPosition.x * u_dpr, u_shadowPosition.y * u_dpr)) /
    u_resolution.y;
  // merged shape
  float merged = mainSDF(p1, p2, gl_FragCoord.xy);

  float shadow = exp(-1.0 / u_shadowExpand * abs(merged) * u_resolution1x.y) * 0.6 * u_shadowFactor;

  fragColor = vec4(bgColor - vec3(shadow), 1.0);
}
