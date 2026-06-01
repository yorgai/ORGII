/**
 * Avatar Component
 *
 * Native avatar with clean styling. Renders an image when `src` is provided,
 * otherwise renders `children` (text or icon) on a neutral background.
 *
 * @example
 * ```tsx
 * import Avatar from "@src/components/Avatar";
 *
 * <Avatar size={24}>A</Avatar>
 * <Avatar size={32} style={{ backgroundColor: "#1890ff" }}>B</Avatar>
 * <Avatar size={32} src="/me.png" />
 * ```
 */
import React, { memo, useMemo } from "react";

export interface AvatarProps {
  /** Avatar size in pixels. @default 32 */
  size?: number;
  /** Avatar content (text or icon). Ignored when `src` is provided. */
  children?: React.ReactNode;
  /** Image URL. */
  src?: string;
  /** Additional inline style (e.g. `backgroundColor`). */
  style?: React.CSSProperties;
}

const WRAPPER_CLASS =
  "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-fill-3 font-medium text-text-1";

const Avatar: React.FC<AvatarProps> = ({ size = 32, children, src, style }) => {
  const wrapperStyle = useMemo<React.CSSProperties>(
    () => ({ width: size, height: size, fontSize: size * 0.4, ...style }),
    [size, style]
  );

  return (
    <div className={WRAPPER_CLASS} style={wrapperStyle}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        children
      )}
    </div>
  );
};

export default memo(Avatar);
