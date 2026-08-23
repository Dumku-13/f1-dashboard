from fastapi import APIRouter, HTTPException
from data.teams import TEAMS, TEAM_NAME_MAP
from utils import cache_get, cache_set

router = APIRouter()


@router.get("")  # match with and without trailing slash (proxy strips it)
@router.get("/")
async def get_teams():
    return list(TEAMS.values())


@router.get("/{team_id}")
async def get_team(team_id: str):
    team = TEAMS.get(team_id)
    if not team:
        # Try fuzzy match via name map
        for name, tid in TEAM_NAME_MAP.items():
            if tid == team_id:
                team = TEAMS.get(tid)
                break
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return team
