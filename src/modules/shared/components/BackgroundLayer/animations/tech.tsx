/**
 * Tech-themed animations: Matrix, Circuit, Pulse, Gradient
 */
import { useAtomValue } from "jotai";
import React, { useCallback, useEffect, useRef, useState } from "react";

import { backgroundConfigAtom } from "@src/store/ui/backgroundConfigAtom";

/**
 * Get a random character based on the selected character set
 */
function getMatrixChar(
  charSet: "katakana" | "latin" | "binary" | "symbols" = "binary"
): string {
  switch (charSet) {
    case "katakana":
      // Japanese katakana characters (original Matrix style)
      return String.fromCharCode(0x30a0 + Math.random() * 96);
    case "latin": {
      // English letters and numbers
      const latinChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
      return latinChars[Math.floor(Math.random() * latinChars.length)];
    }
    case "binary":
      // Binary 0s and 1s
      return Math.random() > 0.5 ? "1" : "0";
    case "symbols": {
      // Mix of symbols and numbers
      const symbolChars = "0123456789!@#$%^&*()_+-=[]{}|;:,.<>?";
      return symbolChars[Math.floor(Math.random() * symbolChars.length)];
    }
    default:
      return String.fromCharCode(0x30a0 + Math.random() * 96);
  }
}

// Matrix rain animation
export const MatrixAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const config = useAtomValue(backgroundConfigAtom);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Resize canvas if needed
    if (
      canvas.width !== window.innerWidth ||
      canvas.height !== window.innerHeight
    ) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }

    // Semi-transparent black to create fade effect
    ctx.fillStyle = "rgba(0, 0, 0, 0.05)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#0F0";
    ctx.font = "15px monospace";

    const columns = Math.floor(canvas.width / 20);
    const drops: number[] =
      (canvas as unknown as { drops?: number[] }).drops ||
      Array(columns)
        .fill(1)
        .map(() => Math.random() * canvas.height);
    (canvas as unknown as { drops: number[] }).drops = drops;

    const charSet = config.matrixCharSet || "binary";

    for (let i = 0; i < drops.length; i++) {
      const char = getMatrixChar(charSet);
      ctx.fillText(char, i * 20, drops[i]);

      if (drops[i] > canvas.height && Math.random() > 0.975) {
        drops[i] = 0;
      }
      drops[i] += 20;
    }
  }, [config.matrixCharSet]);

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
      style={{ opacity: 0.3 }}
    />
  );
};

// Pulse animation - radar-like expanding rings
export const PulseAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const pulsesRef = useRef<
    Array<{
      x: number;
      y: number;
      radius: number;
      maxRadius: number;
      speed: number;
      hue: number;
    }>
  >([]);
  const lastPulseRef = useRef<number>(0);

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

    const now = Date.now();

    if (now - lastPulseRef.current > 2000 && pulsesRef.current.length < 5) {
      pulsesRef.current.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        radius: 0,
        maxRadius: Math.max(canvas.width, canvas.height) * 0.6,
        speed: Math.random() * 2 + 1,
        hue: Math.random() * 60 + 180,
      });
      lastPulseRef.current = now;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    pulsesRef.current = pulsesRef.current.filter((pulse) => {
      pulse.radius += pulse.speed;

      if (pulse.radius > pulse.maxRadius) return false;

      const progress = pulse.radius / pulse.maxRadius;
      const opacity = (1 - progress) * 0.3;

      for (let i = 0; i < 3; i++) {
        const ringRadius = pulse.radius - i * 20;
        if (ringRadius > 0) {
          ctx.beginPath();
          ctx.arc(pulse.x, pulse.y, ringRadius, 0, Math.PI * 2);
          ctx.strokeStyle = `hsla(${pulse.hue}, 80%, 60%, ${opacity * (1 - i * 0.3)})`;
          ctx.lineWidth = 2 - i * 0.5;
          ctx.stroke();
        }
      }

      if (pulse.radius < 50) {
        const centerGradient = ctx.createRadialGradient(
          pulse.x,
          pulse.y,
          0,
          pulse.x,
          pulse.y,
          50 - pulse.radius
        );
        centerGradient.addColorStop(0, `hsla(${pulse.hue}, 100%, 70%, 0.5)`);
        centerGradient.addColorStop(1, `hsla(${pulse.hue}, 100%, 50%, 0)`);
        ctx.beginPath();
        ctx.arc(pulse.x, pulse.y, 50 - pulse.radius, 0, Math.PI * 2);
        ctx.fillStyle = centerGradient;
        ctx.fill();
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

// Simple gradient animation
export const GradientAnimation: React.FC = () => {
  const [hue, setHue] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setHue((hue) => (hue + 0.5) % 360);
    }, 50);
    return () => clearInterval(interval);
  }, []);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[1]"
      style={{
        background: `linear-gradient(${hue}deg, 
          hsla(${hue}, 70%, 50%, 0.15), 
          hsla(${(hue + 60) % 360}, 70%, 50%, 0.15), 
          hsla(${(hue + 120) % 360}, 70%, 50%, 0.15))`,
        transition: "background 0.1s linear",
      }}
    />
  );
};
