import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()

OPENF1_BASE = "https://api.openf1.org/v1"


@router.get("/{path:path}")
async def proxy_openf1(path: str, request: Request):
    params = dict(request.query_params)
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(f"{OPENF1_BASE}/{path}", params=params)
            return JSONResponse(content=resp.json(), status_code=resp.status_code)
    except httpx.TimeoutException:
        return JSONResponse(content={"error": "OpenF1 API timeout"}, status_code=504)
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)
