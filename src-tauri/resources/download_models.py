#!/usr/bin/env python3
"""
Download embedding models for semantic code search.

Downloads the CodeRankEmbed GGUF model for Metal GPU acceleration on Apple Silicon.
"""

import os
import sys
import urllib.request
from pathlib import Path


def download_file(url: str, dest_path: Path, description: str):
    """Download a file with progress indicator."""
    print(f"\n📥 Downloading {description}...")
    print(f"   URL: {url}")
    print(f"   To: {dest_path}")
    
    def report_progress(block_num, block_size, total_size):
        if total_size > 0:
            downloaded = block_num * block_size
            percent = min(100, (downloaded * 100) // total_size)
            mb_downloaded = downloaded / (1024 * 1024)
            mb_total = total_size / (1024 * 1024)
            print(f"\r   Progress: {percent}% ({mb_downloaded:.1f} MB / {mb_total:.1f} MB)", end="", flush=True)
    
    try:
        urllib.request.urlretrieve(url, dest_path, report_progress)
        print(f"\n   ✅ Downloaded successfully")
        return True
    except Exception as e:
        print(f"\n   ❌ Failed: {e}")
        return False


def download_coderank_gguf(model_dir: Path):
    """Download CodeRankEmbed GGUF model for Metal GPU."""
    print("\n" + "="*60)
    print("📦 CodeRankEmbed GGUF (Metal GPU)")
    print("="*60)
    
    ggml_dir = model_dir / "coderank_ggml"
    ggml_dir.mkdir(parents=True, exist_ok=True)
    
    # GGUF model from HuggingFace (pre-converted Q8_0 quantization)
    gguf_url = "https://huggingface.co/awhiteside/CodeRankEmbed-Q8_0-GGUF/resolve/main/coderankembed-q8_0.gguf"
    gguf_dest = ggml_dir / "coderankembed-q8_0.gguf"
    
    # Tokenizer from original model
    tokenizer_url = "https://huggingface.co/nomic-ai/CodeRankEmbed/resolve/main/tokenizer.json"
    tokenizer_dest = ggml_dir / "tokenizer.json"
    
    success = True
    
    if gguf_dest.exists():
        size_mb = gguf_dest.stat().st_size / (1024 * 1024)
        print(f"⏭️  coderankembed-q8_0.gguf already exists ({size_mb:.1f} MB)")
    else:
        if not download_file(gguf_url, gguf_dest, "GGUF model (~170 MB)"):
            success = False
    
    if tokenizer_dest.exists():
        print(f"⏭️  tokenizer.json already exists")
    else:
        if not download_file(tokenizer_url, tokenizer_dest, "tokenizer.json"):
            success = False
    
    return success


def verify_models(model_dir: Path) -> bool:
    """Verify that required models are present."""
    ggml_dir = model_dir / "coderank_ggml"
    
    required_files = [
        ggml_dir / "coderankembed-q8_0.gguf",
        ggml_dir / "tokenizer.json",
    ]
    
    missing = [f for f in required_files if not f.exists()]
    
    if missing:
        print("\n❌ Missing required files:")
        for f in missing:
            print(f"   - {f}")
        return False
    
    print("\n✅ All required model files present:")
    for f in required_files:
        size_mb = f.stat().st_size / (1024 * 1024)
        print(f"   - {f.name} ({size_mb:.1f} MB)")
    
    return True


def main():
    """Main download function."""
    # Get model directory (src-tauri/model)
    script_dir = Path(__file__).parent
    model_dir = script_dir.parent / "model"
    
    print("\n" + "="*60)
    print("🚀 Semantic Search Model Setup")
    print("="*60)
    print(f"\nModel directory: {model_dir}")
    print("\nThis will download:")
    print("  • CodeRankEmbed GGUF (~170 MB)")
    print("    - Optimized for Apple Silicon (Metal GPU)")
    print("    - Q8_0 quantization for best quality/speed balance")
    print("\n")
    
    # Check if already installed
    if verify_models(model_dir):
        print("\n🎉 Models already installed! You're ready to go.")
        response = input("\nRe-download anyway? [y/N]: ").strip().lower()
        if response != 'y':
            return 0
    else:
        response = input("Download now? [Y/n]: ").strip().lower()
        if response == 'n':
            print("❌ Cancelled")
            return 1
    
    try:
        # Download GGUF model
        if not download_coderank_gguf(model_dir):
            raise Exception("Failed to download some files")
        
        # Verify installation
        print("\n" + "="*60)
        print("🔍 Verifying installation...")
        print("="*60)
        
        if not verify_models(model_dir):
            raise Exception("Model verification failed")
        
        print("\n" + "="*60)
        print("✅ Setup Complete!")
        print("="*60)
        print("\n📝 Next steps:")
        print("   1. Start Qdrant: The app will start it automatically")
        print("   2. Run: npm run tauri:dev")
        print("   3. Go to Config > Codebase Indexing")
        print("   4. Select a repository and click 'Embed'")
        print("\n🎉 You're ready to use semantic code search!\n")
        return 0
        
    except Exception as e:
        print("\n" + "="*60)
        print(f"❌ Setup failed: {e}")
        print("="*60)
        print("\n🔧 Troubleshooting:")
        print("   - Check your internet connection")
        print("   - Make sure you have enough disk space (~200 MB)")
        print("   - Try running the script again")
        print("\n📖 Manual download:")
        print("   1. Download from: https://huggingface.co/awhiteside/CodeRankEmbed-Q8_0-GGUF")
        print("   2. Place coderankembed-q8_0.gguf in src-tauri/model/coderank_ggml/")
        print("   3. Download tokenizer.json from nomic-ai/CodeRankEmbed")
        return 1


if __name__ == "__main__":
    sys.exit(main())
