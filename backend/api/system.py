import os
import platform
import time
from fastapi import APIRouter

router = APIRouter()

START_TIME = time.time()

@router.get("/health")
def health_check():
    return {
        "status": "ok",
        "message": "Backend system is healthy",
        "timestamp": time.time()
    }

@router.get("/status")
def system_status():
    uptime = time.time() - START_TIME
    return {
        "status": "active",
        "uptime_seconds": int(uptime),
        "platform": platform.system(),
        "platform_release": platform.release(),
        "python_version": platform.python_version(),
        "environment": os.getenv("APP_ENV", "development")
    }
