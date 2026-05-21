import json
from datetime import datetime
from sqlalchemy import Column, BigInteger, String, Integer, Text, DateTime
from sqlalchemy.orm import Session
from backend.services.db_service import Base, engine

class ToolInvocation(Base):
    __tablename__ = "tool_invocations"

    id = Column(BigInteger, primary_key=True, autoincrement=True)
    session_id = Column(String(64), nullable=False, index=True)
    tool_type = Column(String(100), nullable=False)
    ui_path = Column(String(255), nullable=False)
    execution_path = Column(String(500), nullable=False)
    execution_time_ms = Column(Integer, nullable=False)
    parameters = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, index=True) # success, error, pending
    error_message = Column(Text, nullable=True)
    stack_trace = Column(Text, nullable=True) # Text maps to LONGTEXT or TEXT depending on DB
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

# Function to auto-create the table
def init_db_tables():
    Base.metadata.create_all(bind=engine)

def log_invocation(
    db: Session,
    session_id: str,
    tool_type: str,
    ui_path: str,
    execution_path: str,
    execution_time_ms: int,
    status: str,
    parameters: dict = None,
    error_message: str = None,
    stack_trace: str = None
) -> ToolInvocation:
    # Serialize parameters safely
    params_str = None
    if parameters is not None:
        try:
            params_str = json.dumps(parameters, ensure_ascii=False)
        except Exception:
            params_str = str(parameters)

    db_log = ToolInvocation(
        session_id=session_id,
        tool_type=tool_type,
        ui_path=ui_path,
        execution_path=execution_path,
        execution_time_ms=execution_time_ms,
        parameters=params_str,
        status=status,
        error_message=error_message,
        stack_trace=stack_trace
    )
    db.add(db_log)
    db.commit()
    db.refresh(db_log)
    return db_log

def get_logs(
    db: Session,
    session_id: str = None,
    tool_type: str = None,
    status: str = None,
    limit: int = 100,
    offset: int = 0
):
    query = db.query(ToolInvocation)
    if session_id:
        query = query.filter(ToolInvocation.session_id == session_id)
    if tool_type:
        query = query.filter(ToolInvocation.tool_type == tool_type)
    if status:
        query = query.filter(ToolInvocation.status == status)
    
    return query.order_by(ToolInvocation.created_at.desc()).limit(limit).offset(offset).all()
