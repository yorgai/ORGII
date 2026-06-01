# Embedding Models

This directory contains embedding models for semantic code search.

## Setup

Run the download script to get the required models:

```bash
cd src-tauri
python3 scripts/download_models.py
```

## Documentation

See [Documentation/Development/dev-embedding-models-setup.md](../../Documentation/Development/dev-embedding-models-setup.md) for full setup guide.

## Required Files

After running the download script, you should have:

```
model/
└── coderank_ggml/
    ├── coderankembed-q8_0.gguf  (~170 MB)
    └── tokenizer.json
```

> **Note**: Model files are not tracked in git due to their size.
> Each developer must run the download script.
