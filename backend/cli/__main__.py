import sys
import argparse
from pathlib import Path

# Ensure backend directory and its parent are in sys.path
project_root = Path(__file__).resolve().parent.parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from backend.cli import logs

def main():
    parser = argparse.ArgumentParser(
        prog="mini-tool",
        description="mini-tool CLI: Self-documenting modular command line interface."
    )
    
    subparsers = parser.add_subparsers(dest="subcommand", required=True, help="Subcommand to execute")
    
    # Register command modules here
    logs.register(subparsers)
    
    args = parser.parse_args()
    
    # Dispatch handler based on subcommand
    if args.subcommand == "logs":
        logs.handle(args)
    else:
        parser.print_help()
        sys.exit(1)

if __name__ == "__main__":
    main()
