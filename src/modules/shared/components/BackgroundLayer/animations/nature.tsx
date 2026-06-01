/**
 * Nature-themed animations: Rain, Snow, Sakura, Maple, Fireflies
 */
import React, { useCallback, useEffect, useRef } from "react";

// Rain animation - falling raindrops
export const RainAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const dropsRef = useRef<
    Array<{
      x: number;
      y: number;
      length: number;
      speed: number;
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
      dropsRef.current = [];
    }

    if (dropsRef.current.length === 0) {
      for (let i = 0; i < 150; i++) {
        dropsRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          length: Math.random() * 20 + 10,
          speed: Math.random() * 8 + 6,
          opacity: Math.random() * 0.3 + 0.1,
        });
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    dropsRef.current.forEach((drop) => {
      ctx.beginPath();
      ctx.moveTo(drop.x, drop.y);
      ctx.lineTo(drop.x + 1, drop.y + drop.length);
      ctx.strokeStyle = `rgba(150, 180, 220, ${drop.opacity})`;
      ctx.lineWidth = 1;
      ctx.stroke();

      drop.y += drop.speed;
      if (drop.y > canvas.height) {
        drop.y = -drop.length;
        drop.x = Math.random() * canvas.width;
      }
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

// Snow animation - falling snowflakes
export const SnowAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const flakesRef = useRef<
    Array<{
      x: number;
      y: number;
      size: number;
      speed: number;
      wobble: number;
      wobbleSpeed: number;
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
      flakesRef.current = [];
    }

    if (flakesRef.current.length === 0) {
      for (let i = 0; i < 80; i++) {
        flakesRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 4 + 2,
          speed: Math.random() * 1.5 + 0.5,
          wobble: 0,
          wobbleSpeed: Math.random() * 0.03 + 0.01,
          opacity: Math.random() * 0.5 + 0.3,
        });
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    flakesRef.current.forEach((flake) => {
      flake.wobble += flake.wobbleSpeed;
      const wobbleX = Math.sin(flake.wobble) * 2;

      ctx.beginPath();
      ctx.arc(flake.x + wobbleX, flake.y, flake.size, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${flake.opacity})`;
      ctx.fill();

      flake.y += flake.speed;
      flake.x += wobbleX * 0.1;

      if (flake.y > canvas.height + flake.size) {
        flake.y = -flake.size;
        flake.x = Math.random() * canvas.width;
      }
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

// Sakura animation - cherry blossom petals
export const SakuraAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const petalsRef = useRef<
    Array<{
      x: number;
      y: number;
      size: number;
      speedY: number;
      speedX: number;
      rotation: number;
      rotationSpeed: number;
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
      petalsRef.current = [];
    }

    if (petalsRef.current.length === 0) {
      for (let i = 0; i < 40; i++) {
        petalsRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 8 + 6,
          speedY: Math.random() * 1 + 0.5,
          speedX: Math.random() * 0.5 - 0.25,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.05,
          opacity: Math.random() * 0.4 + 0.3,
        });
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    petalsRef.current.forEach((petal) => {
      ctx.save();
      ctx.translate(petal.x, petal.y);
      ctx.rotate(petal.rotation);

      ctx.beginPath();
      ctx.ellipse(0, 0, petal.size, petal.size * 0.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 183, 197, ${petal.opacity})`;
      ctx.fill();

      ctx.beginPath();
      ctx.ellipse(0, 0, petal.size * 0.3, petal.size * 0.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 150, 170, ${petal.opacity * 0.5})`;
      ctx.fill();

      ctx.restore();

      petal.y += petal.speedY;
      petal.x += petal.speedX + Math.sin(petal.rotation) * 0.3;
      petal.rotation += petal.rotationSpeed;

      if (petal.y > canvas.height + petal.size) {
        petal.y = -petal.size;
        petal.x = Math.random() * canvas.width;
      }
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

// Maple animation - falling autumn maple leaves
export const MapleAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const leavesRef = useRef<
    Array<{
      x: number;
      y: number;
      size: number;
      speedY: number;
      speedX: number;
      rotation: number;
      rotationSpeed: number;
      swayPhase: number;
      swaySpeed: number;
      color: string;
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
      leavesRef.current = [];
    }

    const colors = [
      "rgba(200, 60, 30, 0.7)",
      "rgba(220, 100, 20, 0.7)",
      "rgba(180, 40, 20, 0.7)",
      "rgba(230, 140, 30, 0.7)",
      "rgba(160, 80, 20, 0.7)",
    ];

    if (leavesRef.current.length === 0) {
      for (let i = 0; i < 25; i++) {
        leavesRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 15 + 12,
          speedY: Math.random() * 1.2 + 0.4,
          speedX: Math.random() * 0.5 - 0.25,
          rotation: Math.random() * Math.PI * 2,
          rotationSpeed: (Math.random() - 0.5) * 0.04,
          swayPhase: Math.random() * Math.PI * 2,
          swaySpeed: Math.random() * 0.02 + 0.01,
          color: colors[Math.floor(Math.random() * colors.length)],
        });
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    leavesRef.current.forEach((leaf) => {
      ctx.save();
      ctx.translate(leaf.x, leaf.y);
      ctx.rotate(leaf.rotation);

      const size = leaf.size;
      ctx.beginPath();
      ctx.moveTo(0, -size);
      ctx.quadraticCurveTo(size * 0.3, -size * 0.6, size * 0.8, -size * 0.7);
      ctx.quadraticCurveTo(size * 0.5, -size * 0.3, size, 0);
      ctx.quadraticCurveTo(size * 0.5, size * 0.1, size * 0.6, size * 0.5);
      ctx.quadraticCurveTo(size * 0.3, size * 0.3, 0, size * 0.8);
      ctx.quadraticCurveTo(-size * 0.3, size * 0.3, -size * 0.6, size * 0.5);
      ctx.quadraticCurveTo(-size * 0.5, size * 0.1, -size, 0);
      ctx.quadraticCurveTo(-size * 0.5, -size * 0.3, -size * 0.8, -size * 0.7);
      ctx.quadraticCurveTo(-size * 0.3, -size * 0.6, 0, -size);
      ctx.closePath();

      ctx.fillStyle = leaf.color;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(0, size * 0.8);
      ctx.lineTo(0, size * 1.2);
      ctx.strokeStyle = "rgba(100, 60, 30, 0.5)";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.restore();

      leaf.swayPhase += leaf.swaySpeed;
      const sway = Math.sin(leaf.swayPhase) * 1.5;

      leaf.y += leaf.speedY;
      leaf.x += leaf.speedX + sway * 0.3;
      leaf.rotation += leaf.rotationSpeed + sway * 0.01;

      if (leaf.y > canvas.height + leaf.size * 2) {
        leaf.y = -leaf.size * 2;
        leaf.x = Math.random() * canvas.width;
      }
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

// Fireflies animation - glowing dots that float and pulse
export const FirefliesAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const firefliesRef = useRef<
    Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      brightness: number;
      phase: number;
      speed: number;
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
      firefliesRef.current = [];
    }

    if (firefliesRef.current.length === 0) {
      for (let i = 0; i < 30; i++) {
        firefliesRef.current.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          vx: (Math.random() - 0.5) * 0.8,
          vy: (Math.random() - 0.5) * 0.8,
          size: Math.random() * 3 + 2,
          brightness: Math.random(),
          phase: Math.random() * Math.PI * 2,
          speed: Math.random() * 0.02 + 0.01,
        });
      }
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    firefliesRef.current.forEach((firefly) => {
      firefly.phase += firefly.speed;
      firefly.brightness = (Math.sin(firefly.phase) + 1) / 2;

      const glowRadius = firefly.size * 4 * (0.5 + firefly.brightness * 0.5);
      const gradient = ctx.createRadialGradient(
        firefly.x,
        firefly.y,
        0,
        firefly.x,
        firefly.y,
        glowRadius
      );

      const alpha = 0.3 + firefly.brightness * 0.5;
      gradient.addColorStop(0, `rgba(255, 255, 150, ${alpha})`);
      gradient.addColorStop(0.3, `rgba(200, 255, 100, ${alpha * 0.5})`);
      gradient.addColorStop(1, "rgba(100, 200, 50, 0)");

      ctx.beginPath();
      ctx.arc(firefly.x, firefly.y, glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(
        firefly.x,
        firefly.y,
        firefly.size * (0.5 + firefly.brightness * 0.5),
        0,
        Math.PI * 2
      );
      ctx.fillStyle = `rgba(255, 255, 200, ${0.8 + firefly.brightness * 0.2})`;
      ctx.fill();

      firefly.vx += (Math.random() - 0.5) * 0.1;
      firefly.vy += (Math.random() - 0.5) * 0.1;
      firefly.vx *= 0.99;
      firefly.vy *= 0.99;
      firefly.x += firefly.vx;
      firefly.y += firefly.vy;

      const padding = 50;
      if (firefly.x < -padding) firefly.x = canvas.width + padding;
      if (firefly.x > canvas.width + padding) firefly.x = -padding;
      if (firefly.y < -padding) firefly.y = canvas.height + padding;
      if (firefly.y > canvas.height + padding) firefly.y = -padding;
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
