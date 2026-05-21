from fastapi import APIRouter
from backend.api.system import router as system_router
from backend.api.logs import router as logs_router

api_router = APIRouter()

# Aggregating all modular sub-routers
api_router.include_router(system_router, prefix="/system", tags=["System Status"])
api_router.include_router(logs_router, prefix="/logs", tags=["Tool Invocation Logs"])
