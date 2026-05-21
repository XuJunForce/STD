import sys
from pathlib import Path

# Add project root to path
sys.path.append(str(Path(__file__).resolve().parent.parent))

from backend.services.db_service import SessionLocal
from backend.services.log_service import init_db_tables, log_invocation, get_logs

def test_database_logging():
    print("Initializing database tables...")
    try:
        init_db_tables()
        print("Tables initialized successfully.")
    except Exception as e:
        print(f"Failed to initialize tables: {e}")
        sys.exit(1)

    print("Creating a database session...")
    db = SessionLocal()
    try:
        print("Inserting a test invocation log...")
        test_log = log_invocation(
            db=db,
            session_id="test-session-12345",
            tool_type="db-test-tool",
            ui_path="/tools/db-test",
            execution_path="backend/test_db.py:test_database_logging",
            execution_time_ms=42,
            status="success",
            parameters={"arg1": "hello", "arg2": "world"}
        )
        print(f"Log inserted successfully! ID: {test_log.id}")

        print("Querying the logs back...")
        logs = get_logs(db=db, session_id="test-session-12345")
        if logs and logs[0].tool_type == "db-test-tool":
            print(f"Successfully retrieved log! Tool type: {logs[0].tool_type}, Status: {logs[0].status}")
            print("Database and logging test passed completely.")
        else:
            print("Failed to retrieve log or content mismatch.")
            sys.exit(1)
    except Exception as e:
        print(f"Error during test: {e}")
        sys.exit(1)
    finally:
        db.close()

if __name__ == "__main__":
    test_database_logging()
