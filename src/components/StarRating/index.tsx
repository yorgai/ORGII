/**
 * StarRating — display or edit a 1–5 star rating (shared UI).
 */
import { Star } from "lucide-react";
import React, { useCallback, useState } from "react";

export interface StarRatingProps {
  rating: number;
  onChange?: (rating: number) => void;
  size?: number;
  showValue?: boolean;
  reviewCount?: number;
  className?: string;
  disabled?: boolean;
}

const StarRating: React.FC<StarRatingProps> = ({
  rating,
  onChange,
  size = 16,
  showValue = false,
  reviewCount,
  className = "",
  disabled = false,
}) => {
  const [hoverRating, setHoverRating] = useState<number>(0);
  const isInteractive = !!onChange && !disabled;

  const handleClick = useCallback(
    (value: number) => {
      if (isInteractive) {
        onChange(value);
      }
    },
    [isInteractive, onChange]
  );

  const handleMouseEnter = useCallback(
    (value: number) => {
      if (isInteractive) {
        setHoverRating(value);
      }
    },
    [isInteractive]
  );

  const handleMouseLeave = useCallback(() => {
    if (isInteractive) {
      setHoverRating(0);
    }
  }, [isInteractive]);

  const displayRating = hoverRating || rating;

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <div
        className="flex items-center gap-0.5"
        onMouseLeave={handleMouseLeave}
      >
        {[1, 2, 3, 4, 5].map((value) => {
          const isFilled = value <= displayRating;
          return (
            <button
              key={value}
              type="button"
              onClick={() => handleClick(value)}
              onMouseEnter={() => handleMouseEnter(value)}
              disabled={!isInteractive}
              className={`transition-all duration-150 ${
                isInteractive
                  ? "cursor-pointer hover:scale-110"
                  : "cursor-default"
              }`}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Star
                size={size}
                fill={isFilled ? "#FFB800" : "transparent"}
                color={isFilled ? "#FFB800" : "var(--text-3)"}
                strokeWidth={1.5}
              />
            </button>
          );
        })}
      </div>

      {showValue && (
        <span
          className="text-text-2"
          style={{ fontSize: `${Math.max(11, size * 0.75)}px` }}
        >
          {rating > 0 ? rating.toFixed(1) : "—"}
          {reviewCount !== undefined && (
            <span className="ml-1 text-text-3">({reviewCount})</span>
          )}
        </span>
      )}
    </div>
  );
};

export default StarRating;
