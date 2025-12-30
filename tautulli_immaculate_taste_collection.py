#!/usr/bin/env python3
"""
Backward-compatible entry point for Tautulli automation.

This script is a wrapper that calls the main module from the new package structure.
It maintains compatibility with existing Tautulli configurations.

Each execution creates a timestamped log file in data/logs/ for tracking and debugging.
"""

import sys
import os
from pathlib import Path
from datetime import datetime

# Add src to path so we can import the package
project_root = Path(__file__).resolve().parent
sys.path.insert(0, str(project_root / "src"))

# Set up logging to file before importing main
# This ensures all output is captured
log_dir = project_root / "data" / "logs"
log_dir.mkdir(parents=True, exist_ok=True)

# Create timestamped log file
timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
log_file = log_dir / f"tautulli_main_{timestamp}.log"

# Open log file for writing
log_fp = open(log_file, 'w', encoding='utf-8')

# Function to strip ANSI color codes from text
def strip_colors(text):
    """Remove ANSI escape sequences from text."""
    import re
    # Remove ANSI escape sequences
    ansi_escape = re.compile(r'\x1b\[[0-9;]*m|\\033\[[0-9;]*m|\\x1b\[[0-9;]*m')
    return ansi_escape.sub('', text)

# Custom class to tee output to both stdout and log file
class TeeOutput:
    """Write to both stdout/stderr and log file, stripping colors from log."""
    def __init__(self, original_stream, log_file_handle):
        self.original_stream = original_stream
        self.log_file_handle = log_file_handle
        self.is_stderr = (original_stream == sys.stderr)
    
    def write(self, text):
        # Write to original stream (with colors if any)
        self.original_stream.write(text)
        self.original_stream.flush()
        
        # Write to log file (strip colors)
        if text:
            stripped = strip_colors(text)
            self.log_file_handle.write(stripped)
            self.log_file_handle.flush()
    
    def flush(self):
        self.original_stream.flush()
        self.log_file_handle.flush()
    
    def close(self):
        self.log_file_handle.close()

# Replace stdout and stderr with tee objects
original_stdout = sys.stdout
original_stderr = sys.stderr
sys.stdout = TeeOutput(sys.stdout, log_fp)
sys.stderr = TeeOutput(sys.stderr, log_fp)

# Write header to log file
log_fp.write("=" * 60 + "\n")
log_fp.write("TAUTULLI MAIN SCRIPT EXECUTION LOG\n")
log_fp.write("=" * 60 + "\n")
log_fp.write(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
log_fp.write(f"Log file: {log_file}\n")
log_fp.write(f"Arguments: {sys.argv}\n")
log_fp.write("=" * 60 + "\n\n")
log_fp.flush()

# Import and run the main function
from tautulli_curated.main import main

if __name__ == "__main__":
    try:
        exit_code = main()
        
        # Write footer to log file
        log_fp.write("\n" + "=" * 60 + "\n")
        log_fp.write(f"Script completed with exit code: {exit_code}\n")
        log_fp.write(f"End time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
        log_fp.write("=" * 60 + "\n")
        log_fp.flush()
        
        # Restore original streams before exit
        sys.stdout = original_stdout
        sys.stderr = original_stderr
        log_fp.close()
        
        raise SystemExit(exit_code)
    except SystemExit:
        # Re-raise SystemExit to preserve exit code
        # Restore streams first
        sys.stdout = original_stdout
        sys.stderr = original_stderr
        log_fp.close()
        raise
    except Exception as e:
        # Write error to log file
        import traceback
        log_fp.write("\n" + "=" * 60 + "\n")
        log_fp.write(f"FATAL ERROR: {type(e).__name__}: {e}\n")
        log_fp.write("Traceback:\n")
        log_fp.write(traceback.format_exc())
        log_fp.write("=" * 60 + "\n")
        log_fp.flush()
        
        # Restore original streams
        sys.stdout = original_stdout
        sys.stderr = original_stderr
        log_fp.close()
        
        # Re-raise the exception
        raise
