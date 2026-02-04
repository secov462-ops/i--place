from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import json
import csv
import os
from datetime import datetime

app = FastAPI()

# --- AYARLAR ---
BOARD_SIZE = 50
DATA_FILE = "board.json"
LOG_FILE = "history.csv"

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- VERİ YÖNETİMİ ---
if os.path.exists(DATA_FILE):
    with open(DATA_FILE, "r") as f:
        board = json.load(f)
else:
    board = [["#FFFFFF" for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)]

if not os.path.exists(LOG_FILE):
    with open(LOG_FILE, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["timestamp", "user_dept", "x", "y", "color"])

# --- WEBSOCKET ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []
    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)
    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            await connection.send_json(message)

manager = ConnectionManager()

# --- MODELLER ---
class EmailRequest(BaseModel):
    email: str
    bolum: str
class VerifyRequest(BaseModel):
    email: str
    code: str

# --- API ---
@app.post("/api/send-code")
async def send_code(request: EmailRequest):
    print(f"📧 KOD GÖNDERİLDİ: {request.email} -> 123456")
    return {"message": "Kod gönderildi"}

@app.post("/api/verify")
async def verify_code(request: VerifyRequest):
    if request.code == "123456":
        return {"message": "Başarılı"}
    raise HTTPException(status_code=400, detail="Hatalı kod")

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    await websocket.send_json({"type": "init", "board": board})
    try:
        while True:
            data = await websocket.receive_json()
            if data["type"] == "pixel_update":
                x, y, color = data["x"], data["y"], data["color"]
                if 0 <= x < BOARD_SIZE and 0 <= y < BOARD_SIZE:
                    board[y][x] = color
                    with open(DATA_FILE, "w") as f: json.dump(board, f)
                    with open(LOG_FILE, "a", newline="", encoding="utf-8") as f:
                        csv.writer(f).writerow([datetime.now().isoformat(), "Anonim", x, y, color])
                    await manager.broadcast({"type": "update", "x": x, "y": y, "color": color})
    except WebSocketDisconnect:
        manager.disconnect(websocket)

app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")