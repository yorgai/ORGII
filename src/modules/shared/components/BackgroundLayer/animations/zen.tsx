/**
 * Zen-themed animations: Koi, Ripples, Incense
 */
import React, { useCallback, useEffect, useRef } from "react";

// Koi animation - peaceful koi fish swimming
const KOI_COLORS = [
  { body: "rgba(255, 120, 50, 0.6)", spot: "rgba(255, 255, 255, 0.5)" },
  { body: "rgba(255, 255, 255, 0.5)", spot: "rgba(255, 100, 50, 0.4)" },
  { body: "rgba(255, 80, 30, 0.6)", spot: "rgba(255, 200, 100, 0.4)" },
  { body: "rgba(50, 50, 50, 0.5)", spot: "rgba(255, 150, 50, 0.4)" },
];

export const KoiAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const koiRef = useRef<
    Array<{
      x: number;
      y: number;
      angle: number;
      speed: number;
      size: number;
      tailPhase: number;
      color: string;
      targetAngle: number;
      turnSpeed: number;
    }>
  >([]);

  // Define initKoi before the effect that uses it
  const initKoi = useCallback((width: number, height: number) => {
    koiRef.current = [];
    for (let i = 0; i < 5; i++) {
      const colorSet =
        KOI_COLORS[Math.floor(Math.random() * KOI_COLORS.length)];
      koiRef.current.push({
        x: Math.random() * width,
        y: Math.random() * height,
        angle: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.8 + 0.4,
        size: Math.random() * 20 + 25,
        tailPhase: Math.random() * Math.PI * 2,
        color: colorSet.body,
        targetAngle: Math.random() * Math.PI * 2,
        turnSpeed: 0.02,
      });
    }
  }, []);

  // Handle resize separately to avoid layout thrashing in animation loop
  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;

      // Re-initialize koi if needed, or let them continue
      if (koiRef.current.length === 0) {
        initKoi(canvas.width, canvas.height);
      }
    };

    window.addEventListener("resize", handleResize);
    handleResize(); // Initial setup

    return () => window.removeEventListener("resize", handleResize);
  }, [initKoi]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Ensure initialization if empty (fallback)
    if (koiRef.current.length === 0) {
      initKoi(canvas.width, canvas.height);
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    koiRef.current.forEach((koi) => {
      ctx.save();
      ctx.translate(koi.x, koi.y);
      ctx.rotate(koi.angle);

      // Update tail animation
      koi.tailPhase += 0.1;
      const tailWag = Math.sin(koi.tailPhase) * 0.3;

      // Draw tail
      ctx.beginPath();
      ctx.moveTo(-koi.size * 0.8, 0);
      ctx.quadraticCurveTo(
        -koi.size * 1.2,
        koi.size * 0.3 * Math.sin(koi.tailPhase),
        -koi.size * 1.5,
        koi.size * 0.4 * Math.sin(koi.tailPhase + 0.5)
      );
      ctx.quadraticCurveTo(
        -koi.size * 1.2,
        -koi.size * 0.3 * Math.sin(koi.tailPhase),
        -koi.size * 0.8,
        0
      );
      ctx.fillStyle = koi.color;
      ctx.fill();

      // Draw body (ellipse)
      ctx.beginPath();
      ctx.ellipse(0, 0, koi.size, koi.size * 0.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = koi.color;
      ctx.fill();

      // Draw head
      ctx.beginPath();
      ctx.ellipse(
        koi.size * 0.6,
        0,
        koi.size * 0.5,
        koi.size * 0.35,
        0,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = koi.color;
      ctx.fill();

      // Draw fins
      ctx.beginPath();
      ctx.ellipse(
        0,
        koi.size * 0.3 + Math.sin(koi.tailPhase * 0.5) * 3,
        koi.size * 0.3,
        koi.size * 0.15,
        tailWag,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = koi.color;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.ellipse(
        0,
        -koi.size * 0.3 - Math.sin(koi.tailPhase * 0.5) * 3,
        koi.size * 0.3,
        koi.size * 0.15,
        -tailWag,
        0,
        Math.PI * 2
      );
      ctx.fillStyle = koi.color;
      ctx.globalAlpha = 0.7;
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.restore();

      // Update position
      koi.x += Math.cos(koi.angle) * koi.speed;
      koi.y += Math.sin(koi.angle) * koi.speed;

      // Slowly turn toward target angle
      const angleDiff = koi.targetAngle - koi.angle;
      // Handle angle wrapping for smoother turning
      let diff = angleDiff;
      while (diff <= -Math.PI) diff += Math.PI * 2;
      while (diff > Math.PI) diff -= Math.PI * 2;

      koi.angle += Math.sign(diff) * Math.min(Math.abs(diff), koi.turnSpeed);

      // Occasionally change direction
      if (Math.random() > 0.995) {
        koi.targetAngle = Math.random() * Math.PI * 2;
      }

      // Wrap around screen
      const padding = koi.size * 2;
      if (koi.x < -padding) koi.x = canvas.width + padding;
      if (koi.x > canvas.width + padding) koi.x = -padding;
      if (koi.y < -padding) koi.y = canvas.height + padding;
      if (koi.y > canvas.height + padding) koi.y = -padding;
    });
  }, [initKoi]);

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

// Ripples animation - gentle water ripples expanding
export const RipplesAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const ripplesRef = useRef<
    Array<{
      x: number;
      y: number;
      radius: number;
      maxRadius: number;
      opacity: number;
    }>
  >([]);
  const lastRippleRef = useRef<number>(0);

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const now = Date.now();

    // Create new ripple occasionally
    if (now - lastRippleRef.current > 3000 && ripplesRef.current.length < 4) {
      ripplesRef.current.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: 0,
        maxRadius: Math.min(canvas.width, canvas.height) * 0.4,
        opacity: 0.4,
      });
      lastRippleRef.current = now;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw and update ripples
    ripplesRef.current = ripplesRef.current.filter((ripple) => {
      ripple.radius += 0.8;
      ripple.opacity = 0.4 * (1 - ripple.radius / ripple.maxRadius);

      if (ripple.opacity <= 0) return false;

      // Draw multiple concentric rings
      for (let i = 0; i < 3; i++) {
        const ringRadius = ripple.radius - i * 15;
        if (ringRadius > 0) {
          ctx.beginPath();
          ctx.arc(ripple.x, ripple.y, ringRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(150, 180, 200, ${ripple.opacity * (1 - i * 0.25)})`;
          ctx.lineWidth = 1.5 - i * 0.4;
          ctx.stroke();
        }
      }

      return true;
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

// Incense animation - smoke wisps rising softly
export const IncenseAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const smokesRef = useRef<
    Array<{
      x: number;
      y: number;
      baseX: number;
      size: number;
      opacity: number;
      speed: number;
      wobblePhase: number;
      wobbleSpeed: number;
      wobbleAmount: number;
    }>
  >([]);
  const lastSmokeRef = useRef<number>(0);
  const sourceXRef = useRef<number>(0);

  useEffect(() => {
    const handleResize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
      sourceXRef.current = canvas.width * 0.5; // Center of screen
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const now = Date.now();

    // Create new smoke particle
    if (now - lastSmokeRef.current > 100) {
      smokesRef.current.push({
        x: sourceXRef.current + (Math.random() - 0.5) * 10,
        y: canvas.height - 50,
        baseX: sourceXRef.current,
        size: Math.random() * 8 + 4,
        opacity: Math.random() * 0.2 + 0.15,
        speed: Math.random() * 0.8 + 0.5,
        wobblePhase: Math.random() * Math.PI * 2,
        wobbleSpeed: Math.random() * 0.02 + 0.01,
        wobbleAmount: Math.random() * 30 + 20,
      });
      lastSmokeRef.current = now;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw and update smoke particles
    smokesRef.current = smokesRef.current.filter((smoke) => {
      smoke.y -= smoke.speed;
      smoke.wobblePhase += smoke.wobbleSpeed;
      smoke.x =
        smoke.baseX +
        Math.sin(smoke.wobblePhase) *
          smoke.wobbleAmount *
          (1 - smoke.y / canvas.height);
      smoke.size += 0.05;
      smoke.opacity -= 0.001;

      if (smoke.opacity <= 0 || smoke.y < -50) return false;

      // Draw smoke puff
      const gradient = ctx.createRadialGradient(
        smoke.x,
        smoke.y,
        0,
        smoke.x,
        smoke.y,
        smoke.size
      );
      gradient.addColorStop(0, `rgba(200, 200, 210, ${smoke.opacity})`);
      gradient.addColorStop(0.5, `rgba(180, 180, 190, ${smoke.opacity * 0.5})`);
      gradient.addColorStop(1, `rgba(160, 160, 170, 0)`);

      ctx.beginPath();
      ctx.arc(smoke.x, smoke.y, smoke.size, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      return true;
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
