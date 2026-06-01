/**
 * Chat models configuration (shared)
 *
 * IMPORTANT:
 * - This file must NOT import `WorkspaceContext` barrel exports to avoid circular deps.
 * - Keep this module UI-light and side-effect free; it is imported by `ChatContext`.
 */
import { Book, Code, FileText, Sparkles } from "lucide-react";

export const chat_models = [
  {
    icon: <Sparkles className="text-[16px] text-text-2" size={16} />,
    title: "Autodetect",
    key: "auto",
  },
  {
    icon: <Code className="text-[16px] text-text-2" size={16} />,
    title: "Chat Codebase",
    key: "codebase",
  },
  {
    icon: <Book className="text-[16px] text-text-2" size={16} />,
    title: "Context",
    key: "context",
  },
  {
    icon: <FileText size={16} strokeWidth={1.75} className="text-text-2" />,
    title: "Spec",
    key: "spec",
  },
  {
    icon: <FileText size={16} strokeWidth={1.75} className="text-text-2" />,
    title: "Planner",
    key: "planner",
  },
] as const;
