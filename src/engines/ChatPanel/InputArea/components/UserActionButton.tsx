import { X } from "lucide-react";
import React from "react";

interface UserActionButtonProps {
  title: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  onClick?: () => void;
  onClose?: () => void;
}

export default function UserActionButton({
  title,
  leftIcon,
  rightIcon,
  onClick,
  onClose,
}: UserActionButtonProps) {
  return (
    <div
      className="inline-flex h-[28px] cursor-pointer items-center rounded-full border border-solid border-border-2 bg-fill-2 px-3 py-2 transition-colors hover:bg-fill-3"
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        {leftIcon && <span className="text-text-2">{leftIcon}</span>}
        <span className="chat-block-content text-text-1">{title}</span>
      </div>

      {onClose && (
        <div
          className="ml-2 flex items-center justify-center"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          {rightIcon || (
            <X
              size={12}
              strokeWidth={1.75}
              className="text-text-2 hover:text-text-1"
            />
          )}
        </div>
      )}
    </div>
  );
}
