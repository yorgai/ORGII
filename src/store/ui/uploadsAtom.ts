import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";

// Used by QuickUploadModal for global storage of uploaded files
export interface UploadedFile {
  id: string;
  fileName: string;
  content?: string | File;
  size?: number;
  type: "text" | "image";
  filePath?: string;
}

export const uploadFilesAtom = atomWithStorage<UploadedFile[]>(
  "uploadFiles",
  []
);
uploadFilesAtom.debugLabel = "uploadFilesAtom";

// Stores filePaths for all uploaded files
export const uploadFilePathsAtom = atom<string[]>([]);
uploadFilePathsAtom.debugLabel = "uploadFilePathsAtom";
