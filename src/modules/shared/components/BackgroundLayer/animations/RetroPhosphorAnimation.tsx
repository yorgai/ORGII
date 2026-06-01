/** CRT phosphor terminal style with glowing text/pixels and scanlines */
import { useAtomValue } from "jotai";
import React, { useCallback, useEffect, useRef } from "react";

import { resolvedBackgroundConfigAtom } from "@src/store/ui/backgroundConfigAtom";

import { hexToRgb } from "./retroUtils";

export const RetroPhosphorAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const config = useAtomValue(resolvedBackgroundConfigAtom);
  const themeRgb = config.backgroundColor
    ? hexToRgb(config.backgroundColor)
    : null;
  const blocksRef = useRef<
    Array<{ x: number; y: number; w: number; h: number; life: number }>
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
    }

    timeRef.current += 1;

    let r = 0,
      g = 255,
      b = 50;
    if (themeRgb) {
      r = themeRgb.r;
      g = themeRgb.g;
      b = themeRgb.b;
      const brightness = r * 0.299 + g * 0.587 + b * 0.114;
      if (brightness < 50) {
        r = Math.min(255, r + 100);
        g = Math.min(255, g + 100);
        b = Math.min(255, b + 100);
      }
    }

    ctx.fillStyle = `rgba(${Math.floor(r / 10)}, ${Math.floor(g / 10)}, ${Math.floor(b / 10)}, 0.1)`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const phosphorColor = `rgba(${r}, ${g}, ${b}, 0.15)`;
    const scanlineColor = `rgba(${r}, ${g}, ${b}, 0.2)`;
    const gridColor = `rgba(${r}, ${g}, ${b}, 0.08)`;
    const cursorColor = `rgba(${r}, ${g}, ${b}, 0.8)`;

    ctx.fillStyle = phosphorColor;
    if (Math.random() > 0.95) {
      blocksRef.current.push({
        x: Math.floor(Math.random() * (canvas.width / 10)) * 10,
        y: Math.floor(Math.random() * (canvas.height / 10)) * 10,
        w: 10 + Math.random() * 50,
        h: 10,
        life: 20 + Math.random() * 20,
      });
    }

    blocksRef.current = blocksRef.current.filter((bl) => {
      bl.life--;
      ctx.fillStyle = phosphorColor;
      ctx.fillRect(bl.x, bl.y, bl.w, bl.h);
      if (Math.random() > 0.9) {
        ctx.fillStyle = cursorColor;
        ctx.fillRect(bl.x + bl.w + 2, bl.y, 8, 10);
      }
      return bl.life > 0;
    });

    const scanY = (timeRef.current * 4) % canvas.height;
    ctx.fillStyle = scanlineColor;
    ctx.fillRect(0, scanY, canvas.width, 4);

    const gridOffset = (timeRef.current * 0.5) % 20;
    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let y = gridOffset; y < canvas.height; y += 20) {
      ctx.moveTo(0, y);
      ctx.lineTo(canvas.width, y);
    }
    for (let x = 0; x < canvas.width; x += 20) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, canvas.height);
    }
    ctx.stroke();
  }, [themeRgb]);

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
      style={{ mixBlendMode: "screen" }}
    />
  );
};
