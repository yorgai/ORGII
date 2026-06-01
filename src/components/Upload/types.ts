export interface UploadFile {
  /** File unique id */
  uid: string;
  /** File name */
  name: string;
  /** File size */
  size?: number;
  /** File type */
  type?: string;
  /** Upload status */
  status?: "ready" | "uploading" | "done" | "error";
  /** Upload progress (0-100) */
  percent?: number;
  /** Response from server */
  response?: unknown;
  /** Error message */
  error?: string;
  /** Original File object */
  originFile?: File;
  /** Preview URL (for images) */
  url?: string;
}

export interface CustomRequestOptions {
  file: File;
  onProgress: (percent: number) => void;
  onSuccess: (response: unknown) => void;
  onError: (error: Error) => void;
}
