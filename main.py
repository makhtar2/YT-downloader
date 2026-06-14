import yt_dlp
import uuid
import threading
import queue
import asyncio
from fastapi import FastAPI, HTTPException, Request, BackgroundTasks
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
import os
import json

app = FastAPI()

# Mount static files
app.mount("/static", StaticFiles(directory="static"), name="static")

DOWNLOAD_DIR = "downloads"
os.makedirs(DOWNLOAD_DIR, exist_ok=True)

class InfoRequest(BaseModel):
    url: str

class DownloadRequest(BaseModel):
    url: str
    format: str = "best"
    playlist_items: str | None = None
    download_path: str | None = None
    convert_format: str | None = None

# In-memory storage for progress queues
download_tasks = {}

def download_worker(task_id: str, req: DownloadRequest):
    q = download_tasks[task_id]
    
    # In cloud mode, we ignore req.download_path and always use a temp dir per task
    target_dir = os.path.join(DOWNLOAD_DIR, task_id)
    os.makedirs(target_dir, exist_ok=True)
    
    def progress_hook(d):
        if d['status'] == 'downloading':
            percentage = d.get('_percent_str', '0.0%').strip()
            import re
            ansi_escape = re.compile(r'\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])')
            percentage = ansi_escape.sub('', percentage)
            
            speed = d.get('_speed_str', 'N/A').strip()
            speed = ansi_escape.sub('', speed)
            
            eta = d.get('_eta_str', 'N/A').strip()
            eta = ansi_escape.sub('', eta)
            
            filename = d.get('filename', '')
            
            q.put({"status": "downloading", "percentage": percentage, "speed": speed, "eta": eta, "filename": filename})
        elif d['status'] == 'finished':
            q.put({"status": "finished", "message": "Fichier téléchargé, finalisation en cours..."})

    ydl_opts = {
        'outtmpl': f'{target_dir}/%(title)s.%(ext)s',
        'progress_hooks': [progress_hook],
        'nocheckcertificate': True,
    }
    
    if req.playlist_items:
        ydl_opts['playlist_items'] = req.playlist_items

    if req.format == "audio":
        ydl_opts['format'] = 'bestaudio/best'
        ydl_opts['postprocessors'] = [{
            'key': 'FFmpegExtractAudio',
            'preferredcodec': 'mp3',
            'preferredquality': '192',
        }]
    else:
        ydl_opts['merge_output_format'] = 'mkv' if req.convert_format == 'mkv' else 'mp4'
        if req.format == "best":
            ydl_opts['format'] = 'bestvideo+bestaudio/best'
        elif req.format in ["2160", "1080", "720", "480"]:
            ydl_opts['format'] = f'bestvideo[height<={req.format}]+bestaudio/best'
        else:
            ydl_opts['format'] = 'bestvideo+bestaudio/best'
            
        if req.convert_format and req.convert_format != 'none':
            if 'postprocessors' not in ydl_opts:
                ydl_opts['postprocessors'] = []
            ydl_opts['postprocessors'].append({
                'key': 'FFmpegVideoConvertor',
                'preferedformat': req.convert_format,
            })

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([req.url])
            
            # Check what was downloaded
            files = os.listdir(target_dir)
            if not files:
                q.put({"status": "error", "message": "Aucun fichier téléchargé."})
                return
                
            if len(files) == 1:
                filename = files[0]
                q.put({"status": "completed", "message": "Succès !", "download_url": f"/api/file/{task_id}/{filename}"})
            else:
                import shutil
                # Zip the directory
                zip_base = os.path.join(DOWNLOAD_DIR, task_id)
                shutil.make_archive(zip_base, 'zip', target_dir)
                q.put({"status": "completed", "message": "Succès ! Archive créée.", "download_url": f"/api/file/{task_id}/{task_id}.zip"})
                
    except Exception as e:
        q.put({"status": "error", "message": str(e)})

@app.get("/")
def read_root():
    return FileResponse("static/index.html")

@app.get("/sw.js")
def get_sw():
    return FileResponse("static/sw.js", media_type="application/javascript")

@app.get("/manifest.json")
def get_manifest():
    return FileResponse("static/manifest.json", media_type="application/json")

@app.post("/api/info")
def get_video_info(request: InfoRequest):
    ydl_opts = {'nocheckcertificate': True, 'quiet': True, 'extract_flat': True}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info_dict = ydl.extract_info(request.url, download=False)
            
            if info_dict.get('_type') == 'playlist':
                entries = []
                for idx, entry in enumerate(info_dict.get('entries', [])):
                    if entry:
                        entries.append({
                            "index": idx + 1,
                            "title": entry.get('title', 'Vidéo inconnue'),
                            "duration": entry.get('duration_string', ''),
                            "id": entry.get('id', '')
                        })
                return {
                    "is_playlist": True,
                    "title": info_dict.get('title', 'Playlist inconnue'),
                    "channel": info_dict.get('uploader', 'Inconnu'),
                    "entries": entries,
                    "thumbnail": ''
                }
            else:
                return {
                    "is_playlist": False,
                    "title": info_dict.get('title', 'Vidéo inconnue'),
                    "thumbnail": info_dict.get('thumbnail', ''),
                    "duration": info_dict.get('duration_string', ''),
                    "channel": info_dict.get('uploader', 'Inconnu')
                }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/download")
def start_download(request: DownloadRequest):
    task_id = str(uuid.uuid4())
    download_tasks[task_id] = queue.Queue()
    
    t = threading.Thread(target=download_worker, args=(task_id, request))
    t.start()
    
    return {"task_id": task_id}

@app.get("/api/progress")
async def download_progress(request: Request, task_id: str):
    if task_id not in download_tasks:
        raise HTTPException(status_code=404, detail="Task not found")
        
    q = download_tasks[task_id]
    
    async def event_generator():
        while True:
            if await request.is_disconnected():
                break
                
            try:
                data = q.get_nowait()
                yield {"data": json.dumps(data)}
                
                if data["status"] in ["completed", "error"]:
                    break
            except queue.Empty:
                await asyncio.sleep(0.1)
                
    return EventSourceResponse(event_generator())

@app.get("/api/file/{task_id}/{filename}")
def download_file(task_id: str, filename: str, background_tasks: BackgroundTasks):
    if filename.endswith(".zip"):
        file_path = os.path.join(DOWNLOAD_DIR, filename)
        dir_path = os.path.join(DOWNLOAD_DIR, task_id)
    else:
        file_path = os.path.join(DOWNLOAD_DIR, task_id, filename)
        dir_path = os.path.join(DOWNLOAD_DIR, task_id)
        
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Fichier introuvable ou expiré.")
        
    def cleanup():
        import shutil
        try:
            if os.path.exists(file_path) and os.path.isfile(file_path):
                os.remove(file_path)
            if os.path.exists(dir_path) and os.path.isdir(dir_path):
                shutil.rmtree(dir_path)
        except Exception as e:
            print(f"Cleanup error: {e}")
            
    background_tasks.add_task(cleanup)
    return FileResponse(path=file_path, filename=filename, media_type="application/octet-stream")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
