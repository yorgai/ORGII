import { JSONContent } from "@tiptap/react";
import { useCallback, useEffect, useState } from "react";

import {
  DEBOUNCE_DELAYS,
  useDebouncedCallback,
} from "@src/hooks/perf/useDebouncedCallback";
import { isTauriDesktop } from "@src/util/platform/tauri";

// Document metadata interface
export interface DocumentMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  path?: string;
}

// Full document with content
export interface Document extends DocumentMeta {
  content: JSONContent;
}

// Storage key for localStorage fallback
const STORAGE_KEY = "orgii_files_documents";
const DOCS_FOLDER = "atlas-documents";

// Generate unique ID
const generateId = () => {
  return `doc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Get Tauri filesystem APIs dynamically
const getTauriFs = async () => {
  if (!isTauriDesktop()) return null;
  try {
    const fs = await import("@tauri-apps/plugin-fs");
    return fs;
  } catch {
    return null;
  }
};

// Get app data directory
const getDocsPath = async () => {
  if (!isTauriDesktop()) return null;
  try {
    const { appDataDir } = await import("@tauri-apps/api/path");
    const basePath = await appDataDir();
    return `${basePath}${DOCS_FOLDER}`;
  } catch {
    return null;
  }
};

export function useDocumentStorage() {
  const [documents, setDocuments] = useState<DocumentMeta[]>([]);
  const [currentDocument, setCurrentDocument] = useState<Document | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load from localStorage (fallback) - defined first to avoid circular dependency
  const loadFromLocalStorage = useCallback(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as Document[];
        const docs = parsed.map((doc) => ({
          id: doc.id,
          title: doc.title,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
        }));
        docs.sort(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime()
        );
        setDocuments(docs);
      }
    } catch (error) {
      console.error("Error loading from localStorage:", error);
      setDocuments([]);
    }
  }, []);

  // Load document list from storage
  const loadDocumentList = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const fs = await getTauriFs();
      const docsPath = await getDocsPath();

      if (fs && docsPath) {
        // Tauri: Read from filesystem
        try {
          // Ensure docs directory exists
          await fs.mkdir(docsPath, { recursive: true });

          // Read all .json files in the directory
          const entries = await fs.readDir(docsPath);
          const docs: DocumentMeta[] = [];

          for (const entry of entries) {
            if (entry.name?.endsWith(".json")) {
              try {
                const content = await fs.readTextFile(
                  `${docsPath}/${entry.name}`
                );
                const doc = JSON.parse(content) as Document;
                docs.push({
                  id: doc.id,
                  title: doc.title,
                  createdAt: doc.createdAt,
                  updatedAt: doc.updatedAt,
                  path: `${docsPath}/${entry.name}`,
                });
              } catch {
                // Skip invalid files
              }
            }
          }

          // Sort by updatedAt descending
          docs.sort(
            (left, right) =>
              new Date(right.updatedAt).getTime() -
              new Date(left.updatedAt).getTime()
          );

          setDocuments(docs);
        } catch (error) {
          console.error("Error reading documents from filesystem:", error);
          // Fallback to localStorage
          loadFromLocalStorage();
        }
      } else {
        // Browser: Use localStorage
        loadFromLocalStorage();
      }
    } catch (error) {
      console.error("Error loading documents:", error);
      loadFromLocalStorage();
    } finally {
      setIsLoading(false);
    }
  }, [loadFromLocalStorage]);

  // Initialize - load document list
  useEffect(() => {
    loadDocumentList();
  }, [loadDocumentList]);

  // Internal save function that doesn't depend on currentDocument
  const saveDocumentToStorage = useCallback(
    async (doc: Document): Promise<boolean> => {
      const updatedDoc = {
        ...doc,
        updatedAt: new Date().toISOString(),
      };

      try {
        const fs = await getTauriFs();
        const docsPath = await getDocsPath();

        if (fs && docsPath) {
          // Tauri: Write to filesystem
          await fs.mkdir(docsPath, { recursive: true });
          const filePath = `${docsPath}/${doc.id}.json`;
          await fs.writeTextFile(filePath, JSON.stringify(updatedDoc, null, 2));
        } else {
          // Browser: Use localStorage
          const stored = localStorage.getItem(STORAGE_KEY);
          const docs: Document[] = stored ? JSON.parse(stored) : [];
          const index = docs.findIndex(
            (existingDoc) => existingDoc.id === doc.id
          );

          if (index >= 0) {
            docs[index] = updatedDoc;
          } else {
            docs.push(updatedDoc);
          }

          localStorage.setItem(STORAGE_KEY, JSON.stringify(docs));
        }

        return true;
      } catch (error) {
        console.error("Error saving document:", error);
        return false;
      }
    },
    []
  );

  // Create a new document
  const createDocument = useCallback(
    async (title: string = "Untitled"): Promise<Document> => {
      const now = new Date().toISOString();
      const newDoc: Document = {
        id: generateId(),
        title,
        createdAt: now,
        updatedAt: now,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
            },
          ],
        },
      };

      // Save immediately using the internal save function
      await saveDocumentToStorage(newDoc);

      // Update list
      setDocuments((prev) => [
        {
          id: newDoc.id,
          title: newDoc.title,
          createdAt: newDoc.createdAt,
          updatedAt: newDoc.updatedAt,
        },
        ...prev,
      ]);

      setCurrentDocument(newDoc);
      return newDoc;
    },
    [saveDocumentToStorage]
  );

  // Load a specific document
  const loadDocument = useCallback(
    async (docId: string): Promise<Document | null> => {
      setIsLoading(true);
      setError(null);

      try {
        const fs = await getTauriFs();
        const docsPath = await getDocsPath();

        if (fs && docsPath) {
          // Tauri: Read from filesystem
          const filePath = `${docsPath}/${docId}.json`;
          const content = await fs.readTextFile(filePath);
          const doc = JSON.parse(content) as Document;
          setCurrentDocument(doc);
          return doc;
        } else {
          // Browser: Use localStorage
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            const docs = JSON.parse(stored) as Document[];
            const doc = docs.find((existingDoc) => existingDoc.id === docId);
            if (doc) {
              setCurrentDocument(doc);
              return doc;
            }
          }
        }

        setError("Document not found");
        return null;
      } catch (error) {
        console.error("Error loading document:", error);
        setError("Failed to load document");
        return null;
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Save a document (public API with UI state updates)
  const saveDocument = useCallback(
    async (doc: Document): Promise<boolean> => {
      setIsSaving(true);
      setError(null);

      const updatedDoc = {
        ...doc,
        updatedAt: new Date().toISOString(),
      };

      try {
        const success = await saveDocumentToStorage(doc);
        if (!success) {
          setError("Failed to save document");
          return false;
        }

        // Update the documents list
        setDocuments((prev) =>
          prev.map((existingDoc) =>
            existingDoc.id === doc.id
              ? {
                  ...existingDoc,
                  title: updatedDoc.title,
                  updatedAt: updatedDoc.updatedAt,
                }
              : existingDoc
          )
        );

        // Update current document if it's the same
        if (currentDocument?.id === doc.id) {
          setCurrentDocument(updatedDoc);
        }

        return true;
      } catch (error) {
        console.error("Error saving document:", error);
        setError("Failed to save document");
        return false;
      } finally {
        setIsSaving(false);
      }
    },
    [currentDocument, saveDocumentToStorage]
  );

  // Auto-save with debounce
  const autoSave = useDebouncedCallback((doc: Document) => {
    saveDocument(doc);
  }, DEBOUNCE_DELAYS.AUTOSAVE);

  // Delete a document
  const deleteDocument = useCallback(
    async (docId: string): Promise<boolean> => {
      try {
        const fs = await getTauriFs();
        const docsPath = await getDocsPath();

        if (fs && docsPath) {
          // Tauri: Delete from filesystem
          const filePath = `${docsPath}/${docId}.json`;
          await fs.remove(filePath);
        } else {
          // Browser: Remove from localStorage
          const stored = localStorage.getItem(STORAGE_KEY);
          if (stored) {
            const docs: Document[] = JSON.parse(stored);
            const filtered = docs.filter(
              (existingDoc) => existingDoc.id !== docId
            );
            localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
          }
        }

        // Update list
        setDocuments((prev) => prev.filter((doc) => doc.id !== docId));

        // Clear current if deleted
        if (currentDocument?.id === docId) {
          setCurrentDocument(null);
        }

        return true;
      } catch (error) {
        console.error("Error deleting document:", error);
        setError("Failed to delete document");
        return false;
      }
    },
    [currentDocument]
  );

  // Rename a document
  const renameDocument = useCallback(
    async (docId: string, newTitle: string): Promise<boolean> => {
      const doc = await loadDocument(docId);
      if (!doc) return false;

      doc.title = newTitle;
      return saveDocument(doc);
    },
    [loadDocument, saveDocument]
  );

  // Cleanup on unmount — cancel any pending auto-save
  useEffect(() => {
    return () => {
      autoSave.cancel();
    };
  }, [autoSave]);

  return {
    documents,
    currentDocument,
    isLoading,
    isSaving,
    error,
    createDocument,
    loadDocument,
    saveDocument,
    autoSave,
    deleteDocument,
    renameDocument,
    refreshDocuments: loadDocumentList,
  };
}
