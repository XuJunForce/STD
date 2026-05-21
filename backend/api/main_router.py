from fastapi import APIRouter
from backend.api.logs import router as logs_router
from backend.api.id_card import router as id_card_router

api_router = APIRouter()

# Aggregating all modular sub-routers
api_router.include_router(logs_router, prefix="/logs", tags=["Tool Invocation Logs"])
api_router.include_router(id_card_router, prefix="/id-card", tags=["ID Card Scanner"])


