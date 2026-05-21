from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.api.main_router import api_router
from backend.services.log_service import init_db_tables

app = FastAPI(
    title="Toolbox Core API",
    description="Unified API gateway for developers and AI agents calling platform tools",
    version="1.0.0"
)

# Set up CORS middleware to support high-fidelity frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify frontend host domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Automatically initialize database tables on startup
@app.on_event("startup")
def on_startup():
    print("Startup: Verifying database and initializing tables...")
    try:
        init_db_tables()
        print("Startup: Database initialization complete.")
    except Exception as e:
        print(f"Startup: Error initializing database tables: {e}")

# Register the aggregated main router
app.include_router(api_router, prefix="/api/v1")

# Legacy/Scaffold health endpoint for high-level check
@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Backend gateway is fully active"}
