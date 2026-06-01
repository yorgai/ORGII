/**
 * Ambient animations: Particles, Waves, Stars, Aurora
 */
import React, { useCallback, useEffect, useRef } from "react";

// Particles animation - floating particles
export const ParticlesAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const particlesRef = useRef<
    Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      opacity: number;
    }>
  >([]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (
      canvas.width !== window.innerWidth ||
      canvas.height !== window.innerHeight
    ) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      particlesRef.current = [];
    }

    if (particlesRef.current.length === 0) {
      for (let i = 0; i < 50; i++) {
        particlesRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.5,
          vy: (Math.random() - 0.5) * 0.5,
          size: Math.random() * 3 + 1,
          opacity: Math.random() * 0.5 + 0.2,
        });
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    particlesRef.current.forEach((particle) => {
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${particle.opacity})`;
      ctx.fill();

      particle.x += particle.vx;
      particle.y += particle.vy;

      if (particle.x < 0 || particle.x > canvas.width) particle.vx *= -1;
      if (particle.y < 0 || particle.y > canvas.height) particle.vy *= -1;
    });
  }, []);

  useEffect(() => {
    const animate = () => {
      draw();
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-[1]"
    />
  );
};

// Waves animation - gentle flowing waves
export const WavesAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (
      canvas.width !== window.innerWidth ||
      canvas.height !== window.innerHeight
    ) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    timeRef.current += 0.02;
    const time = timeRef.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const waveColors = [
      "rgba(100, 150, 200, 0.08)",
      "rgba(80, 130, 180, 0.06)",
      "rgba(120, 170, 220, 0.04)",
    ];

    waveColors.forEach((color, layerIndex) => {
      ctx.beginPath();
      ctx.moveTo(0, canvas.height);

      const amplitude = 30 + layerIndex * 15;
      const frequency = 0.003 - layerIndex * 0.0005;
      const speed = 1 + layerIndex * 0.5;
      const baseY = canvas.height * (0.5 + layerIndex * 0.15);

      for (let x = 0; x <= canvas.width; x += 5) {
        const y =
          baseY +
          Math.sin(x * frequency + time * speed) * amplitude +
          Math.sin(x * frequency * 2 + time * speed * 0.7) * (amplitude * 0.5);
        ctx.lineTo(x, y);
      }

      ctx.lineTo(canvas.width, canvas.height);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    });
  }, []);

  useEffect(() => {
    const animate = () => {
      draw();
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-[1]"
    />
  );
};

// Starfield animation - twinkling stars
export const StarfieldAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const starsRef = useRef<
    Array<{
      x: number;
      y: number;
      size: number;
      brightness: number;
      twinkleSpeed: number;
      phase: number;
    }>
  >([]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (
      canvas.width !== window.innerWidth ||
      canvas.height !== window.innerHeight
    ) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      starsRef.current = [];
    }

    if (starsRef.current.length === 0) {
      const starCount = Math.floor((canvas.width * canvas.height) / 8000);
      for (let i = 0; i < starCount; i++) {
        starsRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 2 + 0.5,
          brightness: Math.random(),
          twinkleSpeed: Math.random() * 0.03 + 0.01,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    starsRef.current.forEach((star) => {
      star.phase += star.twinkleSpeed;
      const twinkle = (Math.sin(star.phase) + 1) / 2;
      const alpha = 0.3 + twinkle * 0.7 * star.brightness;

      const glowSize = star.size * (2 + twinkle);
      const gradient = ctx.createRadialGradient(
        star.x,
        star.y,
        0,
        star.x,
        star.y,
        glowSize
      );
      gradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
      gradient.addColorStop(0.5, `rgba(200, 220, 255, ${alpha * 0.3})`);
      gradient.addColorStop(1, "rgba(150, 180, 255, 0)");

      ctx.beginPath();
      ctx.arc(star.x, star.y, glowSize, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(star.x, star.y, star.size * 0.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
      ctx.fill();
    });
  }, []);

  useEffect(() => {
    const animate = () => {
      draw();
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-[1]"
    />
  );
};

// Aurora animation - northern lights effect
export const AuroraAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (
      canvas.width !== window.innerWidth ||
      canvas.height !== window.innerHeight
    ) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    timeRef.current += 0.008;
    const time = timeRef.current;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const layers = 4;
    for (let layer = 0; layer < layers; layer++) {
      ctx.beginPath();

      const baseY = -80 + layer * 80;
      const points: Array<{ x: number; y: number }> = [];

      for (let x = 0; x <= canvas.width; x += 10) {
        const wave1 = Math.sin(x * 0.005 + time + layer * 0.5) * 60;
        const wave2 = Math.sin(x * 0.003 + time * 0.7 + layer) * 40;
        const wave3 = Math.sin(x * 0.008 + time * 1.3) * 25;
        const y = baseY + wave1 + wave2 + wave3;
        points.push({ x, y });
      }

      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        ctx.lineTo(points[i].x, points[i].y);
      }

      const bandHeight = 120 + Math.sin(time + layer) * 30;
      for (let i = points.length - 1; i >= 0; i--) {
        ctx.lineTo(points[i].x, points[i].y + bandHeight);
      }
      ctx.closePath();

      const hue1 = (120 + layer * 25 + time * 10) % 360;
      const hue2 = (180 + layer * 15 + time * 5) % 360;
      const gradient = ctx.createLinearGradient(
        0,
        baseY,
        0,
        baseY + bandHeight
      );
      const alpha = 0.1 - layer * 0.008;
      gradient.addColorStop(0, `hsla(${hue1}, 80%, 60%, ${alpha})`);
      gradient.addColorStop(
        0.5,
        `hsla(${(hue1 + hue2) / 2}, 70%, 50%, ${alpha * 1.5})`
      );
      gradient.addColorStop(1, `hsla(${hue2}, 60%, 40%, 0)`);

      ctx.fillStyle = gradient;
      ctx.fill();
    }
  }, []);

  useEffect(() => {
    const animate = () => {
      draw();
      animationRef.current = requestAnimationFrame(animate);
    };
    animationRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-[1]"
    />
  );
};
