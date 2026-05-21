import sys
import json
from pathlib import Path
from sqlalchemy import or_

from backend.services.db_service import SessionLocal
from backend.services.log_service import ToolInvocation

# XML helper functions
import xml.etree.ElementTree as ET
from xml.dom import minidom

def log_to_dict(log: ToolInvocation) -> dict:
    """Serialize a ToolInvocation model to a dict."""
    return {
        "id": log.id,
        "session_id": log.session_id,
        "tool_type": log.tool_type,
        "ui_path": log.ui_path,
        "execution_path": log.execution_path,
        "execution_time_ms": log.execution_time_ms,
        "status": log.status,
        "parameters": log.parameters if log.parameters is not None else "",
        "error_message": log.error_message if log.error_message is not None else "",
        "stack_trace": log.stack_trace if log.stack_trace is not None else "",
        "created_at": log.created_at.isoformat() if log.created_at else ""
    }

def logs_to_xml(logs_list: list) -> str:
    """Serialize a list of logs dicts to XML string."""
    root = ET.Element("logs")
    for log_dict in logs_list:
        log_elem = ET.SubElement(root, "log")
        for key, value in log_dict.items():
            child = ET.SubElement(log_elem, key)
            child.text = str(value) if value is not None else ""
    rough_string = ET.tostring(root, 'utf-8')
    reparsed = minidom.parseString(rough_string)
    return reparsed.toprettyxml(indent="  ")

def log_to_xml(log_dict: dict) -> str:
    """Serialize a single log dict to XML string."""
    root = ET.Element("log")
    for key, value in log_dict.items():
        child = ET.SubElement(root, key)
        child.text = str(value) if value is not None else ""
    rough_string = ET.tostring(root, 'utf-8')
    reparsed = minidom.parseString(rough_string)
    return reparsed.toprettyxml(indent="  ")

def print_logs_table(logs: list):
    """Print logs in a premium, clean table format."""
    if not logs:
        print("No execution logs found in the database.")
        return
    
    # Table headers
    headers = ["ID", "Session ID", "Tool Type", "Status", "Time (ms)", "Created At"]
    col_widths = [6, 36, 18, 10, 10, 20]
    
    # Format line
    header_str = "".join(f"{h:<{w}}" for h, w in zip(headers, col_widths))
    print(header_str)
    print("-" * sum(col_widths))
    
    for log in logs:
        created_str = log.created_at.strftime("%Y-%m-%d %H:%M:%S") if log.created_at else ""
        session_id = log.session_id
        if len(session_id) > 33:
            session_id = session_id[:30] + "..."
        tool_type = log.tool_type
        if len(tool_type) > 15:
            tool_type = tool_type[:12] + "..."
            
        row_values = [
            str(log.id),
            session_id,
            tool_type,
            log.status,
            f"{log.execution_time_ms}ms",
            created_str
        ]
        row_str = "".join(f"{val:<{w}}" for val, w in zip(row_values, col_widths))
        print(row_str)

def register(subparsers):
    """Register the logs subcommand parser."""
    logs_parser = subparsers.add_parser("logs", help="Manage and query execution trace logs")
    
    # Primary actions for logs subcommand
    group = logs_parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--all", action="store_true", help="List all execution trace logs")
    group.add_argument("--search", type=str, metavar="KEYWORD", help="Search logs by Session ID, tool type, or status")
    group.add_argument("--id", type=int, metavar="ID", help="Get a single log's detailed metadata by ID")
    group.add_argument("--clear", action="store_true", help="Clear all execution trace logs from the database")
    group.add_argument("--export", action="store_true", help="Export all execution trace logs")
    
    # Optional parameter for output format
    logs_parser.add_argument(
        "--format",
        choices=["json", "xml"],
        help="Output format for --id or --export. If omitted, --id defaults to plain text description."
    )
    
    # Optional output file path
    logs_parser.add_argument(
        "--output",
        type=str,
        metavar="FILE_PATH",
        help="Optional output file path when exporting logs. If omitted, writes to stdout."
    )

def handle(args):
    """Execute the logs subcommand."""
    db = SessionLocal()
    try:
        if args.all:
            logs = db.query(ToolInvocation).order_by(ToolInvocation.created_at.desc()).all()
            print_logs_table(logs)
            
        elif args.search:
            kw = f"%{args.search}%"
            logs = db.query(ToolInvocation).filter(
                or_(
                    ToolInvocation.session_id.like(kw),
                    ToolInvocation.tool_type.like(kw),
                    ToolInvocation.status.like(kw)
                )
            ).order_by(ToolInvocation.created_at.desc()).all()
            print_logs_table(logs)
            
        elif args.id is not None:
            log = db.query(ToolInvocation).filter(ToolInvocation.id == args.id).first()
            if not log:
                print(f"Error: Log entry with ID {args.id} not found.", file=sys.stderr)
                sys.exit(1)
            
            log_dict = log_to_dict(log)
            if args.format == "json":
                print(json.dumps(log_dict, indent=2, ensure_ascii=False))
            elif args.format == "xml":
                print(log_to_xml(log_dict))
            else:
                # Default text format
                print(f"ID: {log.id}")
                print(f"Session ID: {log.session_id}")
                print(f"Tool Type: {log.tool_type}")
                print(f"UI Path: {log.ui_path}")
                print(f"Execution Path: {log.execution_path}")
                print(f"Execution Time: {log.execution_time_ms} ms")
                print(f"Status: {log.status}")
                print(f"Parameters: {log.parameters}")
                print(f"Error Message: {log.error_message or 'None'}")
                print(f"Stack Trace: {log.stack_trace or 'None'}")
                print(f"Created At: {log.created_at.strftime('%Y-%m-%d %H:%M:%S') if log.created_at else ''}")
                
        elif args.clear:
            num_deleted = db.query(ToolInvocation).delete()
            db.commit()
            print(f"Successfully cleared all execution trace logs from the database ({num_deleted} records deleted).")
            
        elif args.export:
            if not args.format:
                print("Error: --format <json|xml> is required when exporting logs.", file=sys.stderr)
                sys.exit(1)
            
            logs = db.query(ToolInvocation).order_by(ToolInvocation.created_at.asc()).all()
            logs_list = [log_to_dict(log) for log in logs]
            
            if args.format == "json":
                output_data = json.dumps(logs_list, indent=2, ensure_ascii=False)
            elif args.format == "xml":
                output_data = logs_to_xml(logs_list)
            else:
                print(f"Error: Unsupported export format '{args.format}'.", file=sys.stderr)
                sys.exit(1)
                
            if args.output:
                out_path = Path(args.output).resolve()
                out_path.parent.mkdir(parents=True, exist_ok=True)
                out_path.write_text(output_data, encoding="utf-8")
                print(f"Successfully exported {len(logs)} logs to {out_path}")
            else:
                print(output_data)
                
    except Exception as e:
        print(f"Database operation failed: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        db.close()
