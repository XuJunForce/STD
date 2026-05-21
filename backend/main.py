from fastapi import FastAPI

app = FastAPI(title="Toolbox Core API")

@app.get("/health")
def health_check():
    return {"status": "ok", "message": "Backend scaffold active"}
