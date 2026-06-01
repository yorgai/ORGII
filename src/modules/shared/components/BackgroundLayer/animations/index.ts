/**
 * Animation Components Registry
 *
 * All background animations are grouped by category:
 * - tech: Matrix, Pulse
 * - nature: Rain, Snow, Sakura, Maple, Fireflies
 * - ambient: Particles, Waves, Stars, Aurora
 * - zen: Koi, Ripples
 */
import type { FC } from "react";

import {
  AuroraAnimation,
  ParticlesAnimation,
  StarfieldAnimation,
  WavesAnimation,
} from "./ambient";
import {
  FirefliesAnimation,
  MapleAnimation,
  RainAnimation,
  SakuraAnimation,
  SnowAnimation,
} from "./nature";
import { RetroPhosphorAnimation, RetroSynthwaveAnimation } from "./retro";
import { MatrixAnimation, PulseAnimation } from "./tech";
import { KoiAnimation, RipplesAnimation } from "./zen";

// Re-export all animations for direct import if needed
export {
  // Retro
  RetroPhosphorAnimation,
  RetroSynthwaveAnimation,
  // Tech
  MatrixAnimation,
  PulseAnimation,
  // Nature
  RainAnimation,
  SnowAnimation,
  SakuraAnimation,
  MapleAnimation,
  FirefliesAnimation,
  // Ambient
  ParticlesAnimation,
  WavesAnimation,
  StarfieldAnimation,
  AuroraAnimation,
  // Zen
  KoiAnimation,
  RipplesAnimation,
};

// Animation component map for dynamic lookup
export const AnimationComponents: Record<string, FC> = {
  // Retro
  "retro-phosphor": RetroPhosphorAnimation,
  "retro-synthwave": RetroSynthwaveAnimation,
  // Tech
  matrix: MatrixAnimation,
  pulse: PulseAnimation,
  // Nature
  rain: RainAnimation,
  snow: SnowAnimation,
  sakura: SakuraAnimation,
  maple: MapleAnimation,
  fireflies: FirefliesAnimation,
  // Ambient
  particles: ParticlesAnimation,
  waves: WavesAnimation,
  stars: StarfieldAnimation,
  aurora: AuroraAnimation,
  // Zen
  koi: KoiAnimation,
  ripples: RipplesAnimation,
};
