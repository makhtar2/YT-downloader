document.addEventListener('DOMContentLoaded', () => {
    const urlInput = document.getElementById('urlInput');
    const fetchBtn = document.getElementById('fetchBtn');
    const loadingInfo = document.getElementById('loadingInfo');
    const videoInfoCard = document.getElementById('videoInfoCard');
    const downloadBtn = document.getElementById('downloadBtn');
    const progressSection = document.getElementById('progressSection');
    const successMessage = document.getElementById('successMessage');
    const errorMessage = document.getElementById('errorMessage');
    
    const advancedToggleBtn = document.getElementById('advancedToggleBtn');
    const advancedContent = document.getElementById('advancedContent');
    const advancedChevron = document.getElementById('advancedChevron');
    const downloadPathInput = document.getElementById('downloadPathInput');

    const playlistSection = document.getElementById('playlistSection');
    const playlistItemsContainer = document.getElementById('playlistItems');
    const selectAllBtn = document.getElementById('selectAllBtn');
    const deselectAllBtn = document.getElementById('deselectAllBtn');

    // Video info elements
    const thumbImg = document.getElementById('thumbImg');
    const videoTitle = document.getElementById('videoTitle');
    const videoChannel = document.getElementById('videoChannel');
    const videoDuration = document.getElementById('videoDuration');
    
    // Progress elements
    const progressBar = document.getElementById('progressBar');
    const progressPercentage = document.getElementById('progressPercentage');
    const progressStatus = document.getElementById('progressStatus');
    const progressSpeed = document.getElementById('progressSpeed');
    const progressEta = document.getElementById('progressEta');
    const errorText = document.getElementById('errorText');
    const formatSelect = document.getElementById('formatSelect');
    const convertSelect = document.getElementById('convertSelect');

    let currentUrl = '';
    let eventSource = null;
    let isPlaylistInfo = false;

    // Toggle advanced options
    advancedToggleBtn.addEventListener('click', () => {
        advancedContent.classList.toggle('hidden');
        if (advancedContent.classList.contains('hidden')) {
            advancedChevron.classList.remove('fa-chevron-up');
            advancedChevron.classList.add('fa-chevron-down');
        } else {
            advancedChevron.classList.remove('fa-chevron-down');
            advancedChevron.classList.add('fa-chevron-up');
        }
    });

    // Select/Deselect all playlist items
    selectAllBtn.addEventListener('click', () => {
        const checkboxes = playlistItemsContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = true);
    });

    deselectAllBtn.addEventListener('click', () => {
        const checkboxes = playlistItemsContainer.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(cb => cb.checked = false);
    });

    function resetUI() {
        videoInfoCard.classList.add('hidden');
        progressSection.classList.add('hidden');
        successMessage.classList.add('hidden');
        errorMessage.classList.add('hidden');
        playlistSection.classList.add('hidden');
        playlistItemsContainer.innerHTML = '';
        progressBar.style.width = '0%';
        progressPercentage.innerText = '0%';
        progressStatus.innerText = 'Initialisation...';
        progressSpeed.innerText = '--';
        progressEta.innerText = '--';
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
    }

    function showError(msg) {
        errorText.innerText = msg;
        errorMessage.classList.remove('hidden');
        loadingInfo.classList.add('hidden');
    }

    fetchBtn.addEventListener('click', async () => {
        const url = urlInput.value.trim();
        if (!url) return;
        
        currentUrl = url;
        resetUI();
        loadingInfo.classList.remove('hidden');
        fetchBtn.disabled = true;

        try {
            const response = await fetch('/api/info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: currentUrl })
            });
            
            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.detail || "Impossible de récupérer les informations.");
            }

            // Populate info
            thumbImg.src = data.thumbnail || 'https://via.placeholder.com/300x169?text=Playlist';
            videoTitle.innerText = data.title;
            videoChannel.innerHTML = `<i class="fa-solid fa-user"></i> ${data.channel}`;
            videoDuration.innerHTML = data.duration ? `<i class="fa-regular fa-clock"></i> ${data.duration}` : '<i class="fa-regular fa-clock"></i> --:--';
            
            isPlaylistInfo = data.is_playlist;

            if (isPlaylistInfo && data.entries) {
                playlistSection.classList.remove('hidden');
                data.entries.forEach(entry => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'playlist-item';
                    
                    const label = document.createElement('label');
                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.value = entry.index;
                    checkbox.checked = true; // Checked by default
                    
                    const indexSpan = document.createElement('span');
                    indexSpan.className = 'item-index';
                    indexSpan.innerText = entry.index + '.';

                    const titleSpan = document.createElement('span');
                    titleSpan.className = 'item-title';
                    titleSpan.innerText = entry.title;
                    titleSpan.title = entry.title; // hover tooltip

                    label.appendChild(checkbox);
                    label.appendChild(indexSpan);
                    label.appendChild(titleSpan);
                    
                    itemDiv.appendChild(label);
                    playlistItemsContainer.appendChild(itemDiv);
                });
            }

            loadingInfo.classList.add('hidden');
            videoInfoCard.classList.remove('hidden');
            
        } catch (error) {
            showError(error.message);
        } finally {
            fetchBtn.disabled = false;
        }
    });

    downloadBtn.addEventListener('click', async () => {
        if (!currentUrl) return;
        
        // Gather selected items if it's a playlist
        let playlistItemsStr = null;
        if (isPlaylistInfo) {
            const checkboxes = playlistItemsContainer.querySelectorAll('input[type="checkbox"]:checked');
            const selectedIndexes = Array.from(checkboxes).map(cb => cb.value);
            if (selectedIndexes.length === 0) {
                showError("Veuillez sélectionner au moins une vidéo.");
                return;
            }
            playlistItemsStr = selectedIndexes.join(',');
        }

        downloadBtn.disabled = true;
        downloadBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Préparation...';
        errorMessage.classList.add('hidden');

        try {
            const formatValue = formatSelect ? formatSelect.value : 'best';
            const convertValue = convertSelect ? convertSelect.value : 'none';
            const downloadPath = downloadPathInput.value.trim();

            const payload = {
                url: currentUrl,
                format: formatValue,
                playlist_items: playlistItemsStr,
                download_path: downloadPath || null,
                convert_format: convertValue
            };

            const response = await fetch('/api/download', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.detail || "Erreur au lancement du téléchargement.");
            }

            const taskId = data.task_id;
            
            progressSection.classList.remove('hidden');
            downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i> Téléchargement en cours';
            
            eventSource = new EventSource(`/api/progress?task_id=${taskId}`);
            
            eventSource.onmessage = (event) => {
                const pData = JSON.parse(event.data);
                
                if (pData.status === 'downloading') {
                    // Si on télécharge plusieurs fichiers, montrer aussi le nom de fichier
                    let statusMsg = 'Téléchargement...';
                    if (pData.filename) {
                        const filePart = pData.filename.split('/').pop().split('\\').pop();
                        statusMsg = `En cours : ${filePart}`;
                    }
                    progressStatus.innerText = statusMsg;
                    progressPercentage.innerText = pData.percentage;
                    progressBar.style.width = pData.percentage;
                    progressSpeed.innerText = pData.speed;
                    progressEta.innerText = pData.eta;
                } 
                else if (pData.status === 'finished') {
                    progressStatus.innerText = pData.message;
                    progressBar.style.width = '100%';
                    progressBar.style.background = '#10b981';
                    progressSpeed.innerText = 'Terminé';
                    progressEta.innerText = '--';
                }
                else if (pData.status === 'completed') {
                    progressSection.classList.add('hidden');
                    successMessage.classList.remove('hidden');
                    downloadBtn.disabled = false;
                    downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i> Télécharger à nouveau';
                    eventSource.close();
                    
                    if (pData.download_url) {
                        const a = document.createElement('a');
                        a.style.display = 'none';
                        a.href = pData.download_url;
                        a.download = ''; 
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                    }
                }
                else if (pData.status === 'error') {
                    progressSection.classList.add('hidden');
                    showError("Erreur : " + pData.message);
                    downloadBtn.disabled = false;
                    downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i> Réessayer';
                    eventSource.close();
                }
            };
            
            eventSource.onerror = () => {
                console.error("SSE Error");
                eventSource.close();
            };

        } catch (error) {
            showError(error.message);
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = '<i class="fa-solid fa-download"></i> Télécharger';
        }
    });

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('/sw.js')
                .then(reg => console.log('Service Worker registered successfully! Scope:', reg.scope))
                .catch(err => console.log('Service Worker registration failed:', err));
        });
    }
});
