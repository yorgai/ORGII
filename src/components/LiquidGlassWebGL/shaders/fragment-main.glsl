#version 300 es

precision highp float;

#define PI (3.14159265359)

const float N_R = 1.0 - 0.02;
const float N_G = 1.0;
const float N_B = 1.0 + 0.02;

in vec2 v_uv;
uniform sampler2D u_blurredBg;
uniform sampler2D u_bg;
uniform vec2 u_resolution;
uniform float u_dpr;
uniform vec2 u_mouse;
uniform vec2 u_mouseSpring;
uniform float u_mergeRate;
uniform float u_shapeWidth;
uniform float u_shapeHeight;
uniform float u_shapeRadius;
uniform float u_shapeRoundness;
uniform vec4 u_tint;
uniform float u_refThickness;
uniform float u_refFactor;
uniform float u_refDispersion;
uniform float u_refFresnelRange;
uniform float u_refFresnelFactor;
uniform float u_refFresnelHardness;
uniform float u_glareRange;
uniform float u_glareConvergence;
uniform float u_glareOppositeFactor;
uniform float u_glareFactor;
uniform float u_glareHardness;
uniform float u_glareAngle;
uniform int u_blurEdge;
uniform int u_showShape1;

uniform int STEP;

out vec4 fragColor;

float sdCircle(vec2 p, float r) {
  return length(p) - r;
}

vec3 sdSuperellipse(vec2 p, float r, float n) {
  p = p / r;
  vec2 gs = sign(p);
  vec2 ps = abs(p);
  float gm = pow(ps.x, n) + pow(ps.y, n);
  float gd = pow(gm, 1.0 / n) - 1.0;
  vec2 g = gs * pow(ps, vec2(n - 1.0)) * pow(gm, 1.0 / n - 1.0);
  p = abs(p);
  if (p.y > p.x) p = p.yx;
  n = 2.0 / n;
  float s = 1.0;
  float d = 1e20;
  const int num = 24;
  vec2 oq = vec2(1.0, 0.0);
  for (int i = 1; i < num; i++) {
    float h = float(i) / float(num - 1);
    vec2 q = vec2(pow(cos(h * PI / 4.0), n), pow(sin(h * PI / 4.0), n));
    vec2 pa = p - oq;
    vec2 ba = q - oq;
    vec2 z = pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    float d2 = dot(z, z);
    if (d2 < d) {
      d = d2;
      s = pa.x * ba.y - pa.y * ba.x;
    }
    oq = q;
  }
  return vec3(sqrt(d) * sign(s) * r, g);
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

vec2 getNormal(vec2 p1, vec2 p2, vec2 p) {
  // 使用场景尺度自适应的 eps
  vec2 h = vec2(max(abs(dFdx(p.x)), 0.0001), max(abs(dFdy(p.y)), 0.0001));

  vec2 grad =
    vec2(
      mainSDF(p1, p2, p + vec2(h.x, 0.0)) - mainSDF(p1, p2, p - vec2(h.x, 0.0)),
      mainSDF(p1, p2, p + vec2(0.0, h.y)) - mainSDF(p1, p2, p - vec2(0.0, h.y))
    ) /
    (2.0 * h);

  // return normalize(grad);
  return grad * 1.414213562 * 1000.0;
}

vec2 getNormal2(vec2 p1, vec2 p2, vec2 p) {
  float eps = 0.7071 * 0.0005; // ~1/sqrt(2) * epsilon
  vec2 e1 = vec2(1.0, 1.0);
  vec2 e2 = vec2(-1.0, 1.0);
  vec2 e3 = vec2(1.0, -1.0);
  vec2 e4 = vec2(-1.0, -1.0);

  return normalize(
    e1 * mainSDF(p1, p2, p + eps * e1) +
      e2 * mainSDF(p1, p2, p + eps * e2) +
      e3 * mainSDF(p1, p2, p + eps * e3) +
      e4 * mainSDF(p1, p2, p + eps * e4)
  );
}

vec2 getNormal3(vec2 p1, vec2 p2, vec2 p) {
  float eps = 0.0005;
  vec2 e = vec2(eps, 0.0);

  float dx = mainSDF(p1, p2, p + e.xy) - mainSDF(p1, p2, p - e.xy); // ∂f/∂x
  float dy = mainSDF(p1, p2, p + e.yx) - mainSDF(p1, p2, p - e.yx); // ∂f/∂y

  return normalize(vec2(dx, dy));
}

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// from https://github.com/Rachmanin0xFF/GLSL-Color-Functions/blob/main/color-functions.glsl
//                          0.3127/0.3290  1.0  (1.0-0.3127-0.3290)/0.329
const vec3 D65_WHITE = vec3(0.95045592705, 1.0, 1.08905775076);
//                          0.3457/0.3585  1.0  (1.0-0.3457-0.3585)/0.3585
const vec3 D50_WHITE = vec3(0.96429567643, 1.0, 0.82510460251);
vec3 WHITE = D65_WHITE;
const mat3 RGB_TO_XYZ_M = mat3(
  0.4124, 0.3576, 0.1805,
  0.2126, 0.7152, 0.0722,
  0.0193, 0.1192, 0.9505
);
const mat3 XYZ_TO_XYZ50_M = mat3(
   1.0479298208405488  ,  0.022946793341019088, -0.05019222954313557 ,
   0.029627815688159344,  0.990434484573249   , -0.01707382502938514 ,
  -0.009243058152591178,  0.015055144896577895,  0.7518742899580008
);
const mat3 XYZ_TO_RGB_M = mat3(
   3.2406255, -1.537208 , -0.4986286,
  -0.9689307,  1.8757561,  0.0415175,
   0.0557101, -0.2040211,  1.0569959
);
const mat3 XYZ50_TO_XYZ_M = mat3(
   0.9554734527042182  , -0.023098536874261423,  0.0632593086610217  ,
  -0.028369706963208136,  1.0099954580058226  ,  0.021041398966943008,
   0.012314001688319899, -0.020507696433477912,  1.3303659366080753
);
float UNCOMPAND_SRGB(float a) {
  return a > 0.04045
    ? pow((a + 0.055) / 1.055, 2.4)
    : a / 12.92;
}
float COMPAND_RGB(float a) {
  return a <= 0.0031308
    ? 12.92 * a
    : 1.055 * pow(a, 0.41666666666) - 0.055;
}
vec3 RGB_TO_XYZ(vec3 rgb) {
  return WHITE == D65_WHITE
    ? rgb * RGB_TO_XYZ_M
    : rgb * RGB_TO_XYZ_M * XYZ_TO_XYZ50_M;
}
vec3 SRGB_TO_RGB(vec3 srgb) {
  return vec3(UNCOMPAND_SRGB(srgb.x), UNCOMPAND_SRGB(srgb.y), UNCOMPAND_SRGB(srgb.z));
}
vec3 RGB_TO_SRGB(vec3 rgb) {
  return vec3(COMPAND_RGB(rgb.x), COMPAND_RGB(rgb.y), COMPAND_RGB(rgb.z));
}
vec3 SRGB_TO_XYZ(vec3 srgb) {
  return RGB_TO_XYZ(SRGB_TO_RGB(srgb));
}
float XYZ_TO_LAB_F(float x) {
  //          (24/116)^3                         1/(3*(6/29)^2)     4/29
  return x > 0.00885645167
    ? pow(x, 0.333333333)
    : 7.78703703704 * x + 0.13793103448;
}
vec3 XYZ_TO_LAB(vec3 xyz) {
  vec3 xyz_scaled = xyz / WHITE;
  xyz_scaled = vec3(
    XYZ_TO_LAB_F(xyz_scaled.x),
    XYZ_TO_LAB_F(xyz_scaled.y),
    XYZ_TO_LAB_F(xyz_scaled.z)
  );
  return vec3(
    116.0 * xyz_scaled.y - 16.0,
    500.0 * (xyz_scaled.x - xyz_scaled.y),
    200.0 * (xyz_scaled.y - xyz_scaled.z)
  );
}
vec3 SRGB_TO_LAB(vec3 srgb) {
  return XYZ_TO_LAB(SRGB_TO_XYZ(srgb));
}
vec3 LAB_TO_LCH(vec3 Lab) {
  return vec3(Lab.x, sqrt(dot(Lab.yz, Lab.yz)), atan(Lab.z, Lab.y) * 57.2957795131);
}
vec3 SRGB_TO_LCH(vec3 srgb) {
  return LAB_TO_LCH(SRGB_TO_LAB(srgb));
}
vec3 XYZ_TO_RGB(vec3 xyz) {
  return WHITE == D65_WHITE
    ? xyz * XYZ_TO_RGB_M
    : xyz * XYZ50_TO_XYZ_M * XYZ_TO_RGB_M;
}
vec3 XYZ_TO_SRGB(vec3 xyz) {
  return RGB_TO_SRGB(XYZ_TO_RGB(xyz));
}
float LAB_TO_XYZ_F(float x) {
  //                                     3*(6/29)^2         4/29
  return x > 0.206897
    ? x * x * x
    : 0.12841854934 * (x - 0.137931034);
}
vec3 LAB_TO_XYZ(vec3 Lab) {
  float w = (Lab.x + 16.0) / 116.0;
  return WHITE *
  vec3(LAB_TO_XYZ_F(w + Lab.y / 500.0), LAB_TO_XYZ_F(w), LAB_TO_XYZ_F(w - Lab.z / 200.0));
}
vec3 LAB_TO_SRGB(vec3 lab) {
  return XYZ_TO_SRGB(LAB_TO_XYZ(lab));
}
vec3 LCH_TO_LAB(vec3 LCh) {
  return vec3(LCh.x, LCh.y * cos(LCh.z * 0.01745329251), LCh.y * sin(LCh.z * 0.01745329251));
}
vec3 LCH_TO_SRGB(vec3 lch) {
  return LAB_TO_SRGB(LCH_TO_LAB(lch));
}

float vec2ToAngle(vec2 v) {
  float angle = atan(v.y, v.x);
  if (angle < 0.0) angle += 2.0 * PI;
  return angle;
}

vec3 vec2ToRgb(vec2 v) {
  float angle = atan(v.y, v.x);
  if (angle < 0.0) angle += 2.0 * PI;
  float hue = angle / (2.0 * PI);
  vec3 hsv = vec3(hue, 1.0, 1.0);
  return hsv2rgb(hsv);
}

vec4 getTextureDispersion(
  sampler2D tex1,
  sampler2D tex2,
  float mixRate,
  vec2 offset,
  float factor
) {
  vec4 pixel = vec4(1.0);

  float bgR = texture(tex1, v_uv + offset * (1.0 - (N_R - 1.0) * factor)).r;
  float bgG = texture(tex1, v_uv + offset * (1.0 - (N_G - 1.0) * factor)).g;
  float bgB = texture(tex1, v_uv + offset * (1.0 - (N_B - 1.0) * factor)).b;

  float blurR = texture(tex2, v_uv + offset * (1.0 - (N_R - 1.0) * factor)).r;
  float blurG = texture(tex2, v_uv + offset * (1.0 - (N_G - 1.0) * factor)).g;
  float blurB = texture(tex2, v_uv + offset * (1.0 - (N_B - 1.0) * factor)).b;

  pixel.r = mix(bgR, blurR, mixRate);
  pixel.g = mix(bgG, blurG, mixRate);
  pixel.b = mix(bgB, blurB, mixRate);

  return pixel;
}

void main() {
  vec2 u_resolution1x = u_resolution.xy / u_dpr;
  // center of shape 1
  vec2 p1 = (vec2(0, 0) - u_resolution.xy * 0.5) / u_resolution.y;
  // center of shape 2
  vec2 p2 = (vec2(0, 0) - u_mouseSpring) / u_resolution.y;
  // merged shape
  float merged = mainSDF(p1, p2, gl_FragCoord.xy);

  vec4 outColor;
  // step 0: sdfs
  if (STEP <= 0) {
    float px = 2.0 / u_resolution.y;
    vec3 col = merged > 0.0 ? vec3(1.0, 1.0, 1.0) * merged : vec3(1.0, 1.0, 1.0) * -merged * 2.0;
    col *= 3.0;
    col = mix(
      col,
      vec3(1.0),
      1.0 - smoothstep(0.5 / u_resolution1x.y - px, 0.5 / u_resolution1x.y + px, abs(merged))
    );
    outColor = vec4(col, 1.0);
  } else if (STEP <= 1) {
    float px = 2.0 / u_resolution.y;
    vec3 col = merged > 0.0 ? vec3(0.9, 0.6, 0.3) : vec3(0.65, 0.85, 1.0);
    // 阴影
    col *= 1.0 - exp(-0.03 * abs(merged) * u_resolution1x.y);
    // 等高线
    col *= 0.6 + 0.4 * smoothstep(-0.5, 0.5, cos(0.25 * abs(merged) * u_resolution1x.y * 2.0));
    // 外层白框
    col = mix(
      col,
      vec3(1.0),
      1.0 - smoothstep(1.5 / u_resolution1x.y - px, 1.5 / u_resolution1x.y + px, abs(merged))
    );
    outColor = vec4(col, 1.0);
    // step 1: normals
  } else if (STEP <= 2) {
    if (merged < 0.0) {
      vec2 normal = getNormal(p1, p2, gl_FragCoord.xy);
      vec3 normalColor = vec2ToRgb(normal);

      float l = length(normal);

      outColor = vec4(normalColor, l);
    } else {
      outColor = vec4(vec3(0.8), 0.0);
    }
    // step2: edge factors
  } else if (STEP <= 3) {
    if (merged < 0.0) {
      float nmerged = -1.0 * (merged * u_resolution1x.y);

      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = asin(pow(x_R_ratio, 2.0));
      float thetaT = asin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      if (nmerged >= u_refThickness) {
        edgeFactor = 0.0;
      }

      if (nmerged < u_refThickness) {
        outColor = vec4(vec3(edgeFactor), 1.0);
      } else {
        outColor = vec4(vec3(0.0), 1.0);
      }
    } else {
      outColor = vec4(0.0);
    }
    // step3: edge factor with normal
  } else if (STEP <= 4) {
    if (merged < 0.0) {
      vec2 normal = getNormal(p1, p2, gl_FragCoord.xy);
      vec3 normalColor = vec2ToRgb(normal);
      float nmerged = -1.0 * (merged * u_resolution1x.y);

      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = asin(pow(x_R_ratio, 2.0));
      float thetaT = asin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      if (nmerged >= u_refThickness) {
        edgeFactor = 0.0;
      }

      outColor = vec4(normalColor * edgeFactor * u_dpr * length(normal), 1.0);
    } else {
      outColor = vec4(0.0);
    }
    // add refaction
  } else if (STEP <= 5) {
    if (merged < 0.0) {
      outColor = texture(u_blurredBg, v_uv);
    } else {
      outColor = texture(u_bg, v_uv);
    }
  } else if (STEP <= 6) {
    if (merged < 0.0) {
      vec2 normal = getNormal(p1, p2, gl_FragCoord.xy);
      float nmerged = -1.0 * (merged * u_resolution1x.y);

      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = asin(pow(x_R_ratio, 2.0));
      float thetaT = asin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      // Will have value > 0 inside of shape, force normalize here
      if (nmerged >= u_refThickness) {
        edgeFactor = 0.0;
      }

      if (edgeFactor <= 0.0) {
        outColor = texture(u_blurredBg, v_uv);
      } else {
        vec4 blurredPixel = texture(
          u_blurredBg,
          v_uv -
            normal *
              edgeFactor *
              0.05 *
              u_dpr *
              vec2(
                u_resolution.y / u_resolution1x.x, /* resolution independent */
                1.0
              )
        );
        outColor = blurredPixel;
      }
    } else {
      outColor = texture(u_bg, v_uv);
    }
    //
  } else if (STEP <= 7) {
    if (merged < 0.0) {
      vec2 normal = getNormal(p1, p2, gl_FragCoord.xy);
      float nmerged = -1.0 * (merged * u_resolution1x.y);

      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = asin(pow(x_R_ratio, 2.0));
      float thetaT = asin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      // Will have value > 0 inside of shape, force normalize here
      if (nmerged >= u_refThickness) {
        edgeFactor = 0.0;
      }

      // other fresnel implements:
      // float r0 = pow((1.0 - u_refFactor) / (1.0 + u_refFactor), 2.0);
      // float fresnelFactor = r0 + (1.0 - r0) * pow(1.0 - cos(thetaI), 5.0);
      // if (fresnelFactor < 0.028) {
      //   fresnelFactor = 0.0;
      // }
      // fresnelFactor *= 10.0;

      // float fresnelFactor =
      //   0.5 *
      //   (pow(sin(thetaI - thetaT) / sin(thetaI + thetaT), 2.0) +
      //     pow(tan(thetaI - thetaT) / tan(thetaI + thetaT), 2.0));
      // fresnelFactor = clamp(fresnelFactor, 0.0, 1.0);

      float fresnelFactor = clamp(
        pow(
          1.0 +
            merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_refFresnelRange, 2.0) +
            u_refFresnelHardness,
          5.0
        ),
        0.0,
        1.0
      );

      if (edgeFactor <= 0.0) {
        outColor = texture(u_blurredBg, v_uv);
      } else {
        vec4 blurredPixel = texture(
          u_blurredBg,
          v_uv -
            normal *
              edgeFactor *
              0.05 *
              u_dpr *
              vec2(
                u_resolution.y / u_resolution1x.x, /* resolution independent */
                1.0
              ),
          u_refDispersion
        );
        outColor = mix(blurredPixel, vec4(1.0), fresnelFactor * u_refFresnelFactor * 0.7);
        // outColor = vec4(vec3(fresnelFactor), 1.0);
      }
    } else {
      outColor = texture(u_bg, v_uv);
    }
  } else if (STEP <= 8) {
    if (merged < 0.0) {
      float nmerged = -1.0 * (merged * u_resolution1x.y);

      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = asin(pow(x_R_ratio, 2.0));
      float thetaT = asin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      // Will have value > 0 inside of shape, force normalize here
      if (nmerged >= u_refThickness) {
        edgeFactor = 0.0;
      }

      float fresnelFactor = clamp(
        pow(
          1.0 +
            merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_refFresnelRange, 2.0) +
            u_refFresnelHardness,
          5.0
        ),
        0.0,
        1.0
      );

      float glareGeoFactor = clamp(
        pow(
          1.0 +
            merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_glareRange, 2.0) +
            u_glareHardness,
          5.0
        ),
        0.0,
        1.0
      );

      if (edgeFactor <= 0.0) {
        outColor = texture(u_blurredBg, v_uv);
        //
        // outColor = mix(
        //   outColor,
        //   vec4(u_tint.r, u_tint.g, u_tint.b, u_tint.a * 0.5),
        //   u_tint.a * 0.8
        // );
        // outColor.a = 1.0;
      } else {
        vec2 normal = getNormal(p1, p2, gl_FragCoord.xy);

        float glareAngle = (vec2ToAngle(normalize(normal)) - PI / 4.0 + u_glareAngle) * 2.0;
        int glareFarside = 0;
        if (
          glareAngle > PI * (2.0 - 0.5) && glareAngle < PI * (4.0 - 0.5) ||
          glareAngle < PI * (0.0 - 0.5)
        ) {
          glareFarside = 1;
        }

        float glareAngleFactor =
          (0.5 + sin(glareAngle) * 0.5) * 1.0 * (glareFarside == 1 ? 0.8 : 1.2) * u_glareFactor;
        glareAngleFactor = clamp(pow(glareAngleFactor, 0.3 + u_glareConvergence * 1.5), 0.0, 1.0);

        vec4 blurredPixel = texture(
          u_blurredBg,
          v_uv -
            normal *
              edgeFactor *
              0.05 *
              u_dpr *
              vec2(
                u_resolution.y / u_resolution1x.x, /* resolution independent */
                1.0
              ),
          u_refDispersion
        );
        //
        // outColor = mix(
        //   blurredPixel,
        //   vec4(u_tint.r, u_tint.g, u_tint.b, u_tint.a * 0.5),
        //   u_tint.a * 0.8
        // );
        // outColor.a = 1.0;
        // outColor = mix(outColor, vec4(1.0), fresnelFactor * u_refFresnelFactor * 0.7);
        outColor = blurredPixel;

        vec3 tintLCH = SRGB_TO_LCH(
          mix(vec3(1.0), vec3(u_tint.r, u_tint.g, u_tint.b), u_tint.a * 0.5)
        );
        tintLCH.x += 20.0 * fresnelFactor * u_refFresnelFactor;
        tintLCH.x = clamp(tintLCH.x, 0.0, 100.0);

        outColor = mix(
          outColor,
          // vec4(
          // LCH_TO_SRGB(tintLCH),
          // u_tint.a * 0.5
          // ),
          vec4(1.0),
          fresnelFactor * u_refFresnelFactor * 0.7
        );

        // ------
        outColor = mix(
          outColor,
          // vec4(
          //   LCH_TO_SRGB(tintLCH),
          //   u_tint.a * 0.5
          // ),
          vec4(1.0),
          glareAngleFactor * glareGeoFactor
        );
        // outColor = vec4(vec3(glareAngleFactor * glareGeoFactor), 1.0);
      }
    } else {
      outColor = texture(u_bg, v_uv);
    }
  } else if (STEP <= 9) {
    if (merged < 0.005) {
      float nmerged = -1.0 * (merged * u_resolution1x.y);

      // calculate refraction edge factor:
      float x_R_ratio = 1.0 - nmerged / u_refThickness;
      float thetaI = asin(pow(x_R_ratio, 2.0));
      float thetaT = asin(1.0 / u_refFactor * sin(thetaI));
      float edgeFactor = -1.0 * tan(thetaT - thetaI);
      // Will have value > 0 inside of shape, force normalize here
      if (nmerged >= u_refThickness) {
        edgeFactor = 0.0;
      }

      if (edgeFactor <= 0.0) {
        outColor = texture(u_blurredBg, v_uv);
        outColor = mix(outColor, vec4(u_tint.r, u_tint.g, u_tint.b, 1.0), u_tint.a * 0.8);
      } else {
        // height of glass edge:
        // h = r - sqrt(r*r - x*x) // (0<=x<=r)
        float edgeH = nmerged / u_refThickness;
        // (u_refThickness - sqrt(u_refThickness * u_refThickness - nmerged * nmerged)) /
        // u_refThickness;
        // u_refThickness - pow(u_refThickness * u_refThickness - nmerged * nmerged, 0.5);
        // u_refThickness - pow(u_refThickness * u_refThickness - nmerged * nmerged, 0.5);
        // calculate parameters
        vec2 normal = getNormal(p1, p2, gl_FragCoord.xy);
        vec4 blurredPixel = getTextureDispersion(
          u_bg,
          u_blurredBg,
          u_blurEdge > 0
            ? 1.0
            : edgeH,
          -normal *
            edgeFactor *
            0.05 *
            u_dpr *
            vec2(
              u_resolution.y / (u_resolution1x.x * u_dpr), /* resolution independent */
              1.0
            ),
          u_refDispersion
        );

        // basic tint
        outColor = mix(blurredPixel, vec4(u_tint.r, u_tint.g, u_tint.b, 1.0), u_tint.a * 0.8);

        // add fresnel
        float fresnelFactor = clamp(
          pow(
            1.0 +
              merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_refFresnelRange, 2.0) +
              u_refFresnelHardness,
            5.0
          ),
          0.0,
          1.0
        );

        vec3 fresnelTintLCH = SRGB_TO_LCH(
          mix(vec3(1.0), vec3(u_tint.r, u_tint.g, u_tint.b), u_tint.a * 0.5)
        );
        fresnelTintLCH.x += 20.0 * fresnelFactor * u_refFresnelFactor;
        fresnelTintLCH.x = clamp(fresnelTintLCH.x, 0.0, 100.0);

        outColor = mix(
          outColor,
          vec4(LCH_TO_SRGB(fresnelTintLCH), 1.0),
          fresnelFactor * u_refFresnelFactor * 0.7 * length(normal)
        );

        // add glare
        float glareGeoFactor = clamp(
          pow(
            1.0 +
              merged * u_resolution1x.y / 1500.0 * pow(500.0 / u_glareRange, 2.0) +
              u_glareHardness,
            5.0
          ),
          0.0,
          1.0
        );

        float glareAngle = (vec2ToAngle(normalize(normal)) - PI / 4.0 + u_glareAngle) * 2.0;
        int glareFarside = 0;
        if (
          glareAngle > PI * (2.0 - 0.5) && glareAngle < PI * (4.0 - 0.5) ||
          glareAngle < PI * (0.0 - 0.5)
        ) {
          glareFarside = 1;
        }
        float glareAngleFactor =
          (0.5 + sin(glareAngle) * 0.5) *
          (glareFarside == 1
            ? 1.2 * u_glareOppositeFactor
            : 1.2) *
          u_glareFactor;
        glareAngleFactor = clamp(pow(glareAngleFactor, 0.1 + u_glareConvergence * 2.0), 0.0, 1.0);

        vec3 glareTintLCH = SRGB_TO_LCH(
          mix(blurredPixel.rgb, vec3(u_tint.r, u_tint.g, u_tint.b), u_tint.a * 0.5)
        );
        glareTintLCH.x += 150.0 * glareAngleFactor * glareGeoFactor;
        glareTintLCH.y += 30.0 * glareAngleFactor * glareGeoFactor;
        glareTintLCH.x = clamp(glareTintLCH.x, 0.0, 120.0);

        outColor = mix(
          outColor,
          vec4(LCH_TO_SRGB(glareTintLCH), 1.0),
          glareAngleFactor * glareGeoFactor * length(normal)
        );
      }
    } else {
      outColor = texture(u_bg, v_uv);
    }

    // smooth
    outColor = mix(outColor, texture(u_bg, v_uv), smoothstep(-0.001, 0.001, merged));

  }

  fragColor = outColor;
}
