import Button from "@/src/components/Button";
import { useAtomValue } from "jotai";
import React, { useEffect, useMemo, useState } from "react";

import Markdown from "@src/components/MarkDown";
import { isThemeCssPathDark } from "@src/config/appearance/globalThemes";
import { themesAtom } from "@src/store";
import { chatAppearanceAtom } from "@src/store/config/configAtom";

import DecryptedText from "../components/DecryptedText";

interface AgentChatItemProps {
  children: string;
  expand: boolean;
  finish: boolean;
  handleResultClick?: () => void;
  resultPresent?: boolean;
  title?: string;
  itemIndex: number;
  streamHtml?: boolean;
  /** Container width for code block diff view */
  codeBlockContainerWidth?: number;
  /** Current check status (for showing result indicator) */
  curCheckStatus?: string;
}
// ── Incremental Block Rendering ──
//
// During streaming, re-parsing the full markdown on every token is O(n) and
// becomes visibly laggy for long messages (react-markdown + Prism highlighting).
//
// Split content into completed blocks (paragraph boundaries outside code fences)
// and a streaming tail. Completed blocks are wrapped in React.memo — their
// content never changes so they skip re-renders entirely. Only the short tail
// re-renders on each token, keeping cost O(tail_length) ≈ O(1).

function splitIntoStableBlocks(content: string): string[] {
  if (!content) return [""];

  const blocks: string[] = [];
  let blockStart = 0;
  let inFence = false;
  let i = 0;

  while (i < content.length) {
    if (
      content[i] === "`" &&
      i + 2 < content.length &&
      content[i + 1] === "`" &&
      content[i + 2] === "`"
    ) {
      inFence = !inFence;
      i += 3;
      continue;
    }

    if (
      !inFence &&
      content[i] === "\n" &&
      i + 1 < content.length &&
      content[i + 1] === "\n"
    ) {
      const block = content.slice(blockStart, i + 2);
      if (block.trim()) {
        blocks.push(block);
      }
      blockStart = i + 2;
      i = blockStart;
      continue;
    }

    i++;
  }

  blocks.push(content.slice(blockStart));
  return blocks;
}

interface MemoBlockProps {
  content: string;
  useChatCodeBlock?: boolean;
  codeBlockContainerWidth?: number;
}

const MemoizedMarkdownBlock = React.memo<MemoBlockProps>(
  function MemoizedMarkdownBlock({
    content,
    useChatCodeBlock,
    codeBlockContainerWidth,
  }) {
    return (
      <Markdown
        textContent={content}
        useChatCodeBlock={useChatCodeBlock}
        codeBlockContainerWidth={codeBlockContainerWidth}
        enableFileNavigation={false}
        skipPreprocess={true}
      />
    );
  },
  (prev, next) => prev.content === next.content
);

const AgentChatItemDefault: React.FC<AgentChatItemProps> = ({
  children,
  expand,
  handleResultClick,
  title,
  streamHtml,
  codeBlockContainerWidth,
  curCheckStatus,
}) => {
  const [isShow, setIsShow] = useState(expand);
  const themes = useAtomValue(themesAtom);
  const chatAppearance = useAtomValue(chatAppearanceAtom);

  const isStreaming = Boolean(streamHtml);
  const shouldUseDecryptEffect =
    !isStreaming && chatAppearance.decryptEffectEnabled;

  const streamBlocks = useMemo(
    () => (isStreaming && children ? splitIntoStableBlocks(children) : null),
    [isStreaming, children]
  );

  useEffect(() => {
    setIsShow(expand);
  }, [expand]);

  return (
    <div className="group/agent-msg box-border flex w-full flex-row items-stretch self-stretch">
      <div className="relative flex min-w-0 flex-1 flex-col items-start gap-2">
        {isShow && (
          <>
            <div
              className="chat-text flex flex-col items-start gap-3 self-stretch text-text-1"
              data-testid="chat-message-assistant"
            >
              <div className="resultBgc allow-select w-full overflow-visible break-words font-normal">
                {isStreaming ? (
                  children?.length > 0 && streamBlocks ? (
                    <div className="relative">
                      {streamBlocks.map((block, i) => (
                        <div key={i} className={i > 0 ? "mt-3" : undefined}>
                          <MemoizedMarkdownBlock
                            content={block}
                            useChatCodeBlock={true}
                            codeBlockContainerWidth={codeBlockContainerWidth}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-text-3"> </span>
                  )
                ) : shouldUseDecryptEffect ? (
                  <DecryptedText
                    text={children}
                    speed={chatAppearance.typingSpeed}
                    className="allow-select"
                  />
                ) : (
                  <Markdown
                    textContent={children || ""}
                    useChatCodeBlock={true}
                    codeBlockContainerWidth={codeBlockContainerWidth}
                    enableFileNavigation={true}
                    skipPreprocess={false}
                  />
                )}

                {handleResultClick &&
                  (curCheckStatus === title ? (
                    <div
                      className={`chat-text-sm mr-3 mt-3 flex h-6 w-[6rem] items-center justify-center rounded-[1.75rem] border border-solid border-primary-5 bg-primary-1 ${
                        isThemeCssPathDark(themes)
                          ? "text-text-1"
                          : "text-primary-5"
                      } `}
                    >
                      <p>{"Result"}</p>
                    </div>
                  ) : (
                    <div>
                      <Button
                        variant="secondary"
                        onClick={handleResultClick}
                        className="chat-text-sm mb-1 mt-3 h-[24px] rounded-[100px] py-[2px]"
                      >
                        {"Result"}
                      </Button>
                    </div>
                  ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default AgentChatItemDefault;
