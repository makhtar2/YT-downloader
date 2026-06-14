# YT-Downloader

Une application web puissante et gratuite pour télécharger des vidéos et playlists YouTube en différentes qualités (MP4, AVI, MKV) ou extraire l'audio.

## Lancement Local
Assurez-vous d'avoir Python 3.10+ et FFmpeg installés.
```bash
pip install -r requirements.txt
python main.py
```

## Déploiement Cloud (Hugging Face / Render)
L'application contient un `Dockerfile` optimisé pour fonctionner sur Hugging Face Spaces. Elle sert les fichiers directement dans le navigateur et se nettoie automatiquement pour préserver l'espace disque.
