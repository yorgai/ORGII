import React from "react";

import Button from "@src/components/Button";
import Modal from "@src/scaffold/ModalSystem";

import { TUTORIALS, type TutorialEntry } from "./tutorialRegistry";

interface TutorialsModalProps {
  open: boolean;
  onClose: () => void;
}

function startTutorial(tutorial: TutorialEntry): void {
  window.dispatchEvent(new CustomEvent(tutorial.eventName));
}

const TutorialsModal: React.FC<TutorialsModalProps> = ({ open, onClose }) => {
  const handleStart = (tutorial: TutorialEntry) => {
    onClose();
    window.setTimeout(() => startTutorial(tutorial), 120);
  };

  return (
    <Modal
      visible={open}
      onCancel={onClose}
      title="Tutorials"
      footer={null}
      width={560}
      bodyClassName="p-0"
      zIndex={10020}
    >
      <div className="flex flex-col px-3 py-2">
        {TUTORIALS.map((tutorial) => (
          <div
            key={tutorial.id}
            className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-2 text-left transition-colors hover:bg-fill-1"
          >
            <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-text-1">
              {tutorial.title} ({tutorial.durationLabel})
            </span>

            <Button
              size="small"
              variant="primary"
              onClick={() => handleStart(tutorial)}
            >
              Start
            </Button>
          </div>
        ))}
      </div>
    </Modal>
  );
};

export default TutorialsModal;
