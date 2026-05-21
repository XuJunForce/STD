from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel, Field
from datetime import datetime

from backend.services.db_service import get_db
from backend.services.log_service import log_invocation, get_logs

router = APIRouter()

# Pydantic Schemas
class LogCreate(BaseModel):
    session_id: str = Field(..., description="Unique session ID to correlate user journey steps")
    tool_type: str = Field(..., description="Tool identifier like pdf-merge, base64-encode")
    ui_path: str = Field(..., description="Frontend UI path where triggered")
    execution_path: str = Field(..., description="Backend execution module/function path")
    execution_time_ms: int = Field(..., description="Execution time in milliseconds")
    status: str = Field(..., description="Execution status: success, error, pending")
    parameters: Optional[Dict[str, Any]] = Field(None, description="Parameters passed to the tool")
    error_message: Optional[str] = Field(None, description="Short exception message if failed")
    stack_trace: Optional[str] = Field(None, description="Detailed trace if failed")

class LogResponse(BaseModel):
    id: int
    session_id: str
    tool_type: str
    ui_path: str
    execution_path: str
    execution_time_ms: int
    status: str
    parameters: Optional[str] = None
    error_message: Optional[str] = None
    stack_trace: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True

@router.post("/", response_model=LogResponse)
def create_log_entry(log_in: LogCreate, db: Session = Depends(get_db)):
    try:
        db_log = log_invocation(
            db=db,
            session_id=log_in.session_id,
            tool_type=log_in.tool_type,
            ui_path=log_in.ui_path,
            execution_path=log_in.execution_path,
            execution_time_ms=log_in.execution_time_ms,
            status=log_in.status,
            parameters=log_in.parameters,
            error_message=log_in.error_message,
            stack_trace=log_in.stack_trace
        )
        return db_log
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database logging failed: {e}")

@router.get("/", response_model=List[LogResponse])
def read_log_entries(
    session_id: Optional[str] = Query(None, description="Filter logs by session ID"),
    tool_type: Optional[str] = Query(None, description="Filter logs by tool type name"),
    status: Optional[str] = Query(None, description="Filter logs by status (success, error, pending)"),
    limit: int = Query(50, ge=1, le=500, description="Max logs to retrieve"),
    offset: int = Query(0, ge=0, description="Number of logs to skip"),
    db: Session = Depends(get_db)
):
    try:
        logs = get_logs(
            db=db,
            session_id=session_id,
            tool_type=tool_type,
            status=status,
            limit=limit,
            offset=offset
        )
        return logs
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database query failed: {e}")
