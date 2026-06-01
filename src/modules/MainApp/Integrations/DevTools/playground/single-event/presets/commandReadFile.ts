import type { StatusPreset } from "../../types";

export const commandReadFilePresets: Record<string, StatusPreset[]> = {
  read_text: [
    {
      key: "completed",
      label: "Completed",
      status: "completed",
    },
    {
      key: "running",
      label: "Reading",
      status: "running",
      resultPatch: { success: undefined, content: undefined },
    },
    {
      key: "failed",
      label: "Failed",
      status: "failed",
      resultPatch: {
        content: undefined,
        success: false,
      },
      argsPatch: {
        path: "src/missing/NotFound.tsx",
      },
    },
    {
      key: "large-file",
      label: "Large file (truncated)",
      status: "completed",
      argsPatch: {
        path: "src/generated/schema.graphql",
        offset: 1,
        limit: 200,
      },
      resultPatch: {
        success: true,
        content:
          "type Query {\n  user(id: ID!): User\n  users(filter: UserFilter, limit: Int = 50): UserConnection!\n  session(id: ID!): Session\n  sessions(status: SessionStatus): [Session!]!\n}\n\ntype User {\n  id: ID!\n  email: String!\n  name: String!\n  avatar: String\n  role: UserRole!\n  createdAt: DateTime!\n  sessions: [Session!]!\n}\n\nenum UserRole {\n  ADMIN\n  MEMBER\n  VIEWER\n}\n\n[Showing lines 1-200 of 4821 total (186.2 KB). Use offset and limit to read other sections.]",
        file_path: "src/generated/schema.graphql",
      },
    },
  ],
  read_image: [
    {
      key: "completed",
      label: "Completed",
      status: "completed",
      argsPatch: {
        path: "docs/screenshots/dashboard.png",
      },
      resultPatch: {
        success: true,
        content:
          "Image: docs/screenshots/dashboard.png (image/png, 142.3 KB)\n\n[image:image/png:iVBOR...]",
        file_path: "docs/screenshots/dashboard.png",
      },
    },
    {
      key: "running",
      label: "Reading",
      status: "running",
      argsPatch: {
        path: "docs/screenshots/dashboard.png",
      },
      resultPatch: { success: undefined, content: undefined },
    },
    {
      key: "failed",
      label: "Failed (too large)",
      status: "failed",
      argsPatch: {
        path: "assets/hero-banner.png",
      },
      resultPatch: {
        content: undefined,
        success: false,
      },
    },
    {
      key: "jpeg",
      label: "JPEG photo",
      status: "completed",
      argsPatch: {
        path: "tests/fixtures/sample-photo.jpg",
      },
      resultPatch: {
        success: true,
        content:
          "Image: tests/fixtures/sample-photo.jpg (image/jpeg, 89.7 KB)\n\n[image:image/jpeg:data...]",
        file_path: "tests/fixtures/sample-photo.jpg",
      },
    },
  ],
  read_pdf: [
    {
      key: "completed",
      label: "Completed",
      status: "completed",
      argsPatch: {
        path: "docs/architecture/design-spec.pdf",
      },
      resultPatch: {
        success: true,
        content:
          "Design Specification v2.1\n\n1. Introduction\nThis document describes the high-level architecture of the distributed event processing pipeline.\n\n2. System Overview\nThe system consists of three primary layers:\n  - Ingestion layer (Kafka consumers)\n  - Processing layer (Flink jobs)\n  - Storage layer (TimescaleDB + S3)\n\n3. Data Flow\nEvents are produced by client SDKs and routed through the API gateway...\n\n[Showing lines 1-50 of 312 total (48.6 KB)]",
        file_path: "docs/architecture/design-spec.pdf",
      },
    },
    {
      key: "running",
      label: "Extracting",
      status: "running",
      argsPatch: {
        path: "docs/architecture/design-spec.pdf",
      },
      resultPatch: { success: undefined, content: undefined },
    },
    {
      key: "failed",
      label: "Failed (scanned PDF)",
      status: "failed",
      argsPatch: {
        path: "docs/scanned/invoice-2024.pdf",
      },
      resultPatch: {
        content: undefined,
        success: false,
      },
    },
  ],
};
