/** 80s synthwave perspective grid with sun and stars */
import { useAtomValue } from "jotai";
import React, { useCallback, useEffect, useRef } from "react";

import { resolvedBackgroundConfigAtom } from "@src/store/ui/backgroundConfigAtom";

import { hexToRgb } from "./retroUtils";

export const RetroSynthwaveAnimation: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const config = useAtomValue(resolvedBackgroundConfigAtom);
  const themeRgb = config.backgroundColor
    ? hexToRgb(config.backgroundColor)
    : null;

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

    timeRef.current++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    let r = 255,
      g = 0,
      b = 255;
    if (themeRgb) {
      r = themeRgb.r;
      g = themeRgb.g;
      b = themeRgb.b;
    }

    const horizonY = canvas.height * 0.4;
    const gridColor = `rgba(${r}, ${g}, ${b}, 0.4)`;

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 2;
    ctx.shadowBlur = 10;
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, 0.8)`;
    ctx.beginPath();

    for (let x = -canvas.width; x < canvas.width * 2; x += 100) {
      ctx.moveTo(x, canvas.height);
      const vpX = canvas.width / 2;
      ctx.lineTo(vpX + (x - vpX) * 0.1, horizonY);
    }

    const speed = 2;
    const offset = (timeRef.current * speed) % 100;
    for (let z = 0; z < canvas.height - horizonY; z += 20) {
      const y =
        horizonY +
        Math.pow(z / (canvas.height - horizonY), 2) *
          (canvas.height - horizonY);
      const movingY = y + offset;
      if (movingY < canvas.height && movingY > horizonY) {
        ctx.moveTo(0, movingY);
        ctx.lineTo(canvas.width, movingY);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    const sunGradient = ctx.createLinearGradient(
      0,
      horizonY - 150,
      0,
      horizonY
    );
    sunGradient.addColorStop(0, `rgba(${r}, ${g}, ${b}, 0.8)`);
    sunGradient.addColorStop(1, `rgba(255, 200, 50, 0.8)`);
    ctx.fillStyle = sunGradient;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, horizonY - 50, 80, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "rgba(0,0,0,0.5)";
    for (let i = 0; i < 8; i++) {
      const bandY = horizonY - 10 - i * 12;
      ctx.fillRect(canvas.width / 2 - 90, bandY, 180, 2 + i);
    }

    ctx.fillStyle = "rgba(255, 255, 255, 0.5)";
    for (let i = 0; i < 50; i++) {
      const sx = (i * 137) % canvas.width;
      const sy = (i * 59) % horizonY;
      if (Math.random() > 0.95) ctx.globalAlpha = Math.random();
      ctx.fillRect(sx, sy, 2, 2);
      ctx.globalAlpha = 1;
    }
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
    />
  );
};
