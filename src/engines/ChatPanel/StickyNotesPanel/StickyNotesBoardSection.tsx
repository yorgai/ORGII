/**
 * StickyNotesBoardSection — one collapsible section in the grid-layout
 * sticky-notes board.
 *
 * The board is a vertical stack of sections; each section's body is a
 * wrapped grid of `StickyNotesBoardCard`s. Sections are themselves
 * sortable (drag handle on the section header), and the cards inside
 * each section share the panel-level `DndContext` so cards can drag
 * across sections.
 */
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useSetAtom } from "jotai";
import {
  ChevronsDownUp,
  ChevronsUpDown,
  GripVertical,
  Plus,
  Trash2,
} from "lucide-react";
import React, { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import Input from "@src/components/Input";
import { Placeholder } from "@src/modules/shared/layouts/blocks";
import {
  addNoteAtom,
  removeSectionAtom,
  renameSectionAtom,
  toggleSectionCollapsedAtom,
} from "@src/store/stickyNotes/stickyNotesAtom";
import type { StickyNote, StickyNoteSection } from "@src/types/stickyNotes";

import StickyNotesBoardCard from "./StickyNotesBoardCard";

interface StickyNotesBoardSectionProps {
  section: StickyNoteSection;
  notes: StickyNote[];
}

const StickyNotesBoardSection: React.FC<StickyNotesBoardSectionProps> = ({
  section,
  notes,
}) => {
  const { t } = useTranslation("navigation");
  const addNote = useSetAtom(addNoteAtom);
  const removeSection = useSetAtom(removeSectionAtom);
  const renameSection = useSetAtom(renameSectionAtom);
  const toggleCollapsed = useSetAtom(toggleSectionCollapsedAtom);

  const sortableData = useMemo(
    () => ({ kind: "section" as const, id: section.id }),
    [section.id]
  );

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: section.id, data: sortableData });

  // Droppable covers the entire section body so cards can be dropped on
  // empty groups or on the gutter between cards.
  const droppableData = useMemo(
    () => ({ kind: "section" as const, id: section.id }),
    [section.id]
  );
  const { setNodeRef: setDroppableRef } = useDroppable({
    id: `section-${section.id}`,
    data: droppableData,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isCollapsed = Boolean(section.collapsed);

  const handleAddNote = useCallback(() => {
    addNote({ sectionId: section.id });
    // Adding a note while collapsed would hide it; expand the section so
    // the freshly-created card is visible to the user.
    if (isCollapsed) toggleCollapsed(section.id);
  }, [addNote, isCollapsed, section.id, toggleCollapsed]);

  const handleToggleCollapsed = useCallback(() => {
    toggleCollapsed(section.id);
  }, [section.id, toggleCollapsed]);

  const handleRemoveSection = useCallback(() => {
    if (
      notes.length > 0 &&
      !window.confirm(t("stickyNotes.deleteSectionConfirm"))
    ) {
      return;
    }
    removeSection(section.id);
  }, [notes.length, removeSection, section.id, t]);

  const handleTitleChange = useCallback(
    (title: string) => {
      renameSection({ sectionId: section.id, title });
    },
    [renameSection, section.id]
  );

  return (
    <section
      ref={setNodeRef}
      style={style}
      className={`group flex flex-col ${isDragging ? "opacity-50" : ""}`}
      data-testid="chat-panel-sticky-notes-section"
    >
      {/* Section header */}
      <header
        className="flex h-10 shrink-0 items-center gap-1 px-2"
        onDoubleClick={handleToggleCollapsed}
      >
        <Button
          htmlType="button"
          variant="tertiary"
          appearance="ghost"
          size="mini"
          iconOnly
          onClick={handleToggleCollapsed}
          aria-label={
            isCollapsed
              ? t("stickyNotes.expandSection")
              : t("stickyNotes.collapseSection")
          }
          icon={
            isCollapsed ? (
              <ChevronsUpDown size={14} strokeWidth={2} />
            ) : (
              <ChevronsDownUp size={14} strokeWidth={2} />
            )
          }
        />
        <Input
          type="text"
          value={section.title}
          onChange={handleTitleChange}
          onDoubleClick={(event) => event.stopPropagation()}
          placeholder={t("stickyNotes.sectionTitlePlaceholder")}
          fieldVariant="ghost"
          size="small"
          className="flex-1"
        />
        <Button
          htmlType="button"
          variant="tertiary"
          appearance="ghost"
          size="mini"
          iconOnly
          onClick={handleAddNote}
          aria-label={t("stickyNotes.addNoteToSection")}
          title={t("stickyNotes.addNoteToSection")}
          icon={<Plus size={14} strokeWidth={2} />}
        />
        <Button
          htmlType="button"
          variant="danger"
          appearance="ghost"
          size="mini"
          iconOnly
          onClick={handleRemoveSection}
          aria-label={t("stickyNotes.deleteSection")}
          title={t("stickyNotes.deleteSection")}
          icon={<Trash2 size={14} strokeWidth={2} />}
        />
        <Button
          htmlType="button"
          variant="tertiary"
          appearance="ghost"
          size="mini"
          iconOnly
          aria-label={t("stickyNotes.dragSection")}
          className="shrink-0 cursor-grab text-text-3 opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100"
          icon={<GripVertical size={14} strokeWidth={2} />}
          {...attributes}
          {...listeners}
        />
      </header>

      {/* Section body — wrapped grid of cards */}
      {!isCollapsed && (
        <div
          ref={setDroppableRef}
          className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-1 p-1"
          data-testid="chat-panel-sticky-notes-section-body"
        >
          <SortableContext
            items={notes.map((note) => note.id)}
            strategy={rectSortingStrategy}
          >
            {notes.map((note) => (
              <StickyNotesBoardCard
                key={note.id}
                note={note}
                sectionId={section.id}
              />
            ))}
          </SortableContext>
          {notes.length === 0 && (
            <Placeholder
              variant="empty"
              placement="sidebar"
              title={t("stickyNotes.emptySection")}
              action={{
                label: t("stickyNotes.addNoteToSection"),
                onClick: handleAddNote,
              }}
              className="col-span-full h-[150px] w-full rounded-lg"
            />
          )}
        </div>
      )}
    </section>
  );
};

export default StickyNotesBoardSection;
