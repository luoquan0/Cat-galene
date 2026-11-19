/* Cat-Meet shared documents, collaborative annotations and local participant volume. */
'use strict';
(() => {
    const MAX_DOC_SIZE = 25 * 1024 * 1024;
    const volumePrefix = 'cat-meet:local-volume:';
    let meetingTimer = null;
    let meetingStartedAt = null;
    let sharedDocument = null;
    let sharedDocumentFile = null;
    let sharedDocumentBlobUrl = null;
    let activeOperation = null;
    let undoStack = [];
    let redoStack = [];
    const operationCache = new Map();
    let canvasContext = null;
    let resizeObserver = null;

    function byId(id) { return document.getElementById(id); }
    function safeText(value) { return typeof value === 'string' ? value : ''; }

    function formatMeetingDuration(ms) {
        const seconds = Math.max(0, Math.floor(ms / 1000));
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainder = seconds % 60;
        return [hours, minutes, remainder].map(n => String(n).padStart(2, '0')).join(':');
    }

    function setCatMeetingDuration(startedAt) {
        const label = byId('cm-meeting-duration');
        if(!label)
            return;
        const timestamp = Date.parse(startedAt || '');
        if(!Number.isFinite(timestamp)) {
            label.textContent = '00:00:00';
            if(meetingTimer) clearInterval(meetingTimer);
            meetingTimer = null;
            meetingStartedAt = null;
            return;
        }
        meetingStartedAt = timestamp;
        const update = () => {
            if(label.isConnected)
                label.textContent = formatMeetingDuration(Date.now() - meetingStartedAt);
        };
        update();
        if(meetingTimer) clearInterval(meetingTimer);
        meetingTimer = setInterval(update, 1000);
    }
    window.setCatMeetingDuration = setCatMeetingDuration;

    function currentDocOwner() {
        return sharedDocument && sharedDocument.owner === serverConnection?.id;
    }
    function currentDocEditor() {
        return currentDocOwner() ||
            (sharedDocument && Array.isArray(sharedDocument.editors) &&
             sharedDocument.editors.includes(serverConnection?.id));
    }
    function isDocBlocked() {
        return sharedDocument && Array.isArray(sharedDocument.blocked) &&
            sharedDocument.blocked.includes(serverConnection?.id);
    }

    function docAction(value) {
        if(!serverConnection || !serverConnection.socket)
            return;
        serverConnection.documentAction(Object.assign({
            docId: sharedDocument && sharedDocument.id,
        }, value));
    }

    function setDocStatus(message) {
        const status = byId('cm-doc-status');
        if(status) status.textContent = message || '';
    }

    function updateDocControls() {
        const owner = currentDocOwner();
        const editor = currentDocEditor();
        const blocked = isDocBlocked();
        const stage = byId('cm-doc-stage');
        if(!stage || !sharedDocument)
            return;
        stage.dataset.readonly = blocked ? 'true' : 'false';
        for(const id of ['cm-doc-grant','cm-doc-block','cm-doc-allow','cm-doc-end']) {
            const button = byId(id);
            if(button) button.style.display = owner ? '' : 'none';
        }
        const clearButton = byId('cm-doc-clear');
        if(clearButton) clearButton.style.display = editor ? '' : 'none';
        const target = byId('cm-doc-member');
        if(target) target.style.display = owner ? '' : 'none';
        const tool = byId('cm-doc-tool');
        if(tool) tool.disabled = blocked;
        if(blocked)
            setDocStatus('主持人已暂时禁止你批注；你仍可查看文档。');
        else if(owner)
            setDocStatus('你是文档主持人：可管理协同编辑权限。');
        else if(editor)
            setDocStatus('你是协同编辑者：可以管理批注。');
        else
            setDocStatus('你可以实时批注；主持人可调整你的权限。');
        populateDocMembers();
    }

    function populateDocMembers() {
        const select = byId('cm-doc-member');
        if(!select || !serverConnection)
            return;
        const old = select.value;
        select.replaceChildren();
        for(const id of Object.keys(serverConnection.users || {})) {
            if(id === serverConnection.id)
                continue;
            const user = serverConnection.users[id];
            const option = document.createElement('option');
            option.value = id;
            option.textContent = user.username || '参会者';
            select.appendChild(option);
        }
        if([...select.options].some(option => option.value === old))
            select.value = old;
    }

    function docFileType(file) {
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        if(['png','jpg','jpeg','webp','gif'].includes(ext)) return 'image';
        if(ext === 'pdf') return 'pdf';
        if(ext === 'docx') return 'docx';
        if(ext === 'txt') return 'txt';
        return '';
    }

    async function startDocumentShare(file) {
        if(!file || !serverConnection || !serverConnection.socket)
            return;
        const type = docFileType(file);
        if(!type) {
            displayError('仅支持 DOCX、PDF、TXT、PNG、JPG、WebP 和 GIF 文件。');
            return;
        }
        if(file.size <= 0 || file.size > MAX_DOC_SIZE) {
            displayError('共享文档最大支持 25 MiB。');
            return;
        }
        if(sharedDocument) {
            displayError('当前会议已有共享文档，请先结束当前共享。');
            return;
        }
        const id = (crypto.randomUUID ? crypto.randomUUID() :
            'doc-' + Date.now() + '-' + Math.random().toString(36).slice(2));
        sharedDocumentFile = file;
        docAction({
            action: 'start', id, name: file.name, mime: file.type || '',
            size: file.size,
        });
        // The server echoes the start event to the owner as well. Rendering
        // immediately keeps the presenter from waiting on the websocket echo.
        sharedDocument = {
            id, owner: serverConnection.id, name: file.name, mime: file.type || '',
            size: file.size, editors: [], blocked: [], operations: [],
        };
        await renderDocument(file);
        for(const peerId of Object.keys(serverConnection.users || {})) {
            if(peerId === serverConnection.id)
                continue;
            try { serverConnection.sendFile(peerId, file); }
            catch(e) { console.error('Document transfer failed', e); }
        }
        setDocStatus('文档已共享，正在向参会者发送原文件。');
    }

    function showDocStage(show) {
        const stage = byId('cm-doc-stage');
        const video = byId('expand-video');
        if(!stage || !video)
            return;
        stage.hidden = !show;
        video.style.display = show ? 'none' : '';
        if(show) {
            byId('video-container').classList.add('cm-document-active');
            resizeCanvas();
        } else {
            byId('video-container').classList.remove('cm-document-active');
        }
    }

    async function extractDocxText(file) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let eocd = -1;
        for(let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
            if(bytes[i] === 0x50 && bytes[i+1] === 0x4b &&
               bytes[i+2] === 0x05 && bytes[i+3] === 0x06) {
                eocd = i; break;
            }
        }
        if(eocd < 0) throw new Error('DOCX ZIP directory not found');
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const entries = view.getUint16(eocd + 10, true);
        let offset = view.getUint32(eocd + 16, true);
        let xml = null;
        for(let i=0;i<entries;i++) {
            if(view.getUint32(offset, true) !== 0x02014b50) break;
            const method = view.getUint16(offset + 10, true);
            const compressedSize = view.getUint32(offset + 20, true);
            const nameLength = view.getUint16(offset + 28, true);
            const extraLength = view.getUint16(offset + 30, true);
            const commentLength = view.getUint16(offset + 32, true);
            const localOffset = view.getUint32(offset + 42, true);
            const name = new TextDecoder().decode(bytes.slice(offset + 46, offset + 46 + nameLength));
            if(name === 'word/document.xml') {
                const localName = view.getUint16(localOffset + 26, true);
                const localExtra = view.getUint16(localOffset + 28, true);
                const start = localOffset + 30 + localName + localExtra;
                const data = bytes.slice(start, start + compressedSize);
                if(method === 0) xml = data;
                else if(method === 8) {
                    if(typeof DecompressionStream === 'undefined')
                        throw new Error('This browser cannot extract DOCX files');
                    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
                    xml = new Uint8Array(await new Response(stream).arrayBuffer());
                } else throw new Error('Unsupported DOCX compression');
                break;
            }
            offset += 46 + nameLength + extraLength + commentLength;
        }
        if(!xml) throw new Error('DOCX document.xml is missing');
        const doc = new DOMParser().parseFromString(new TextDecoder().decode(xml), 'application/xml');
        const paragraphs = [...doc.getElementsByTagNameNS('*','p')];
        return paragraphs.map(p => {
            let text = '';
            for(const node of p.getElementsByTagNameNS('*','t'))
                text += node.textContent || '';
            for(const br of p.getElementsByTagNameNS('*','br'))
                text += '\n';
            return text;
        }).join('\n');
    }

    async function renderDocument(file) {
        const content = byId('cm-doc-content');
        const title = byId('cm-doc-title');
        if(!content || !file)
            return;
        content.replaceChildren();
        title.textContent = file.name;
        if(sharedDocumentBlobUrl)
            URL.revokeObjectURL(sharedDocumentBlobUrl);
        sharedDocumentBlobUrl = URL.createObjectURL(file);
        const download = byId('cm-doc-download');
        if(download) {
            download.href = sharedDocumentBlobUrl;
            download.download = file.name;
        }
        const type = docFileType(file);
        if(type === 'image') {
            const image = document.createElement('img');
            image.src = sharedDocumentBlobUrl;
            image.alt = file.name;
            content.appendChild(image);
        } else if(type === 'pdf') {
            const frame = document.createElement('iframe');
            frame.title = file.name;
            frame.src = sharedDocumentBlobUrl + '#toolbar=0&navpanes=0';
            frame.setAttribute('loading','lazy');
            content.appendChild(frame);
            setDocStatus('PDF 使用浏览器内置阅读器；切换“浏览 / 翻页”可滚动页面，选择批注工具可在当前视图上标注。');
        } else if(type === 'docx') {
            const text = await extractDocxText(file);
            const article = document.createElement('article');
            article.className = 'cm-docx-text';
            article.textContent = text;
            content.appendChild(article);
            setDocStatus('Word 文档已提取正文供协作批注；原始 DOCX 文件可下载。复杂排版和嵌入对象不在网页预览中重排。');
        } else {
            const pre = document.createElement('pre');
            pre.textContent = await file.text();
            content.appendChild(pre);
        }
        showDocStage(true);
        updateDocControls();
        resizeCanvas();
        redrawAnnotations();
    }

    function resizeCanvas() {
        const canvas = byId('cm-doc-canvas');
        const page = byId('cm-doc-page');
        if(!canvas || !page)
            return;
        const width = Math.max(1, page.clientWidth - 28);
        const height = Math.max(1, page.clientHeight - 28);
        const ratio = window.devicePixelRatio || 1;
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        canvas.style.top = '14px';
        canvas.style.left = '50%';
        canvas.style.transform = 'translateX(-50%)';
        canvasContext = canvas.getContext('2d');
        canvasContext.setTransform(ratio,0,0,ratio,0,0);
        redrawAnnotations();
    }

    function pointFromEvent(event) {
        const rect = byId('cm-doc-canvas').getBoundingClientRect();
        return {
            x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
            y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
        };
    }

    function drawOperation(ctx, op, width, height) {
        if(!op || !Array.isArray(op.points) || !op.points.length)
            return;
        const points = op.points.map(p => ({x:p.x*width,y:p.y*height}));
        const tool = op.tool;
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = Math.max(1, Number(op.width) || 3);
        ctx.strokeStyle = safeText(op.color) || '#ef477d';
        ctx.fillStyle = ctx.strokeStyle;
        if(tool === 'highlighter') {
            ctx.globalAlpha = .28;
            ctx.lineWidth = Math.max(8, Number(op.width) || 10);
        }
        if(tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.lineWidth = Math.max(12, Number(op.width) || 18);
        }
        const first = points[0], last = points[points.length-1];
        if(tool === 'text') {
            ctx.globalCompositeOperation = 'source-over';
            ctx.font = '16px sans-serif';
            ctx.fillText(safeText(op.text), first.x, first.y);
        } else if(tool === 'rect' || tool === 'ellipse') {
            const x = Math.min(first.x,last.x), y = Math.min(first.y,last.y);
            const w = Math.abs(last.x-first.x), h = Math.abs(last.y-first.y);
            if(tool === 'rect') ctx.strokeRect(x,y,w,h);
            else { ctx.beginPath(); ctx.ellipse(x+w/2,y+h/2,w/2,h/2,0,0,Math.PI*2); ctx.stroke(); }
        } else if(tool === 'arrow') {
            const angle = Math.atan2(last.y-first.y,last.x-first.x);
            ctx.beginPath(); ctx.moveTo(first.x,first.y); ctx.lineTo(last.x,last.y);
            ctx.lineTo(last.x-12*Math.cos(angle-.45),last.y-12*Math.sin(angle-.45));
            ctx.moveTo(last.x,last.y);
            ctx.lineTo(last.x-12*Math.cos(angle+.45),last.y-12*Math.sin(angle+.45));
            ctx.stroke();
        } else {
            ctx.beginPath(); ctx.moveTo(first.x,first.y);
            for(let i=1;i<points.length;i++) ctx.lineTo(points[i].x,points[i].y);
            ctx.stroke();
        }
        ctx.restore();
    }

    function redrawAnnotations() {
        const canvas = byId('cm-doc-canvas');
        if(!canvas || !canvasContext)
            return;
        const rect = canvas.getBoundingClientRect();
        const width = rect.width, height = rect.height;
        canvasContext.clearRect(0,0,width,height);
        for(const op of (sharedDocument && sharedDocument.operations || []))
            drawOperation(canvasContext,op,width,height);
        if(activeOperation)
            drawOperation(canvasContext,activeOperation,width,height);
    }

    function sendOperation(op) {
        if(!sharedDocument || isDocBlocked())
            return;
        operationCache.set(op.id, JSON.parse(JSON.stringify(op)));
        docAction({action:'annotate', operation:op});
    }

    function setupCanvas() {
        const canvas = byId('cm-doc-canvas');
        if(!canvas) return;
        canvas.addEventListener('pointerdown', event => {
            if(!sharedDocument || isDocBlocked()) return;
            const tool = byId('cm-doc-tool').value;
            if(tool === 'pan') return;
            const point = pointFromEvent(event);
            if(tool === 'text') {
                const text = window.prompt('输入批注文字');
                if(!text) return;
                activeOperation = {
                    id: crypto.randomUUID(), tool, color: byId('cm-doc-color').value,
                    width: Number(byId('cm-doc-width').value), points:[point], text,
                };
                drawOperation(canvasContext,activeOperation,canvas.clientWidth,canvas.clientHeight);
                sendOperation(activeOperation);
                undoStack.push(activeOperation.id); redoStack = []; activeOperation = null;
                return;
            }
            activeOperation = {
                id: crypto.randomUUID(), tool, color: byId('cm-doc-color').value,
                width: Number(byId('cm-doc-width').value), points:[point],
            };
            canvas.setPointerCapture(event.pointerId);
            redrawAnnotations();
        });
        canvas.addEventListener('pointermove', event => {
            if(!activeOperation) return;
            activeOperation.points.push(pointFromEvent(event));
            redrawAnnotations();
            const now = Date.now();
            if(!activeOperation.lastSent || now-activeOperation.lastSent > 65) {
                activeOperation.lastSent = now;
                sendOperation(activeOperation);
            }
        });
        const finish = () => {
            if(!activeOperation) return;
            sendOperation(activeOperation);
            undoStack.push(activeOperation.id);
            redoStack = [];
            activeOperation = null;
            redrawAnnotations();
        };
        canvas.addEventListener('pointerup', finish);
        canvas.addEventListener('pointercancel', finish);
    }

    function handleCatDocumentMessage(sourceId, username, message) {
        if(!message || typeof message !== 'object')
            return;
        switch(message.action) {
        case 'start': {
            sharedDocument = message.document;
            sharedDocument.operations = message.operations || [];
            if(sourceId === serverConnection.id) {
                // Owner already has the File object selected locally.
                updateDocControls();
            } else {
                updateDocControls();
                docAction({action:'request-file'});
            }
            break;
        }
        case 'snapshot': {
            sharedDocument = message.document;
            sharedDocument.operations = message.operations || [];
            updateDocControls();
            if(sourceId !== serverConnection.id)
                docAction({action:'request-file'});
            break;
        }
        case 'file-request':
            if(currentDocOwner() && sharedDocumentFile && sourceId) {
                try { serverConnection.sendFile(sourceId, sharedDocumentFile); }
                catch(e) { console.error('Could not resend shared document',e); }
            }
            break;
        case 'operation': {
            if(!sharedDocument) return;
            const op = message.operation;
            const index = sharedDocument.operations.findIndex(old => old.id === op.id);
            operationCache.set(op.id, JSON.parse(JSON.stringify(op)));
            if(index >= 0) sharedDocument.operations[index] = op;
            else sharedDocument.operations.push(op);
            redrawAnnotations();
            break;
        }
        case 'undo':
            if(sharedDocument) {
                sharedDocument.operations = sharedDocument.operations.filter(op => op.id !== message.opId);
                redrawAnnotations();
            }
            break;
        case 'clear':
            if(sharedDocument) {
                sharedDocument.operations = [];
                redrawAnnotations();
            }
            break;
        case 'permissions': {
            if(!sharedDocument) return;
            const editors = new Set(sharedDocument.editors || []);
            const blocked = new Set(sharedDocument.blocked || []);
            if(message.editors) editors.add(message.target); else editors.delete(message.target);
            if(message.blocked) blocked.add(message.target); else blocked.delete(message.target);
            sharedDocument.editors = [...editors];
            sharedDocument.blocked = [...blocked];
            updateDocControls();
            break;
        }
        case 'end':
            sharedDocument = null;
            sharedDocumentFile = null;
            if(sharedDocumentBlobUrl) URL.revokeObjectURL(sharedDocumentBlobUrl);
            sharedDocumentBlobUrl = null;
            operationCache.clear();
            showDocStage(false);
            setDocStatus('文档共享已结束。');
            break;
        default:
            break;
        }
    }
    window.handleCatDocumentMessage = handleCatDocumentMessage;

    function handleCatDocumentFileTransfer(f) {
        if(!sharedDocument || !f || f.name !== sharedDocument.name)
            return false;
        if(f.up) {
            f.onevent = (state) => {
                if(state === 'cancelled')
                    setDocStatus('向某位参会者发送文档失败。');
            };
            return true;
        }
        if(f.userid !== sharedDocument.owner)
            return false;
        f.onevent = function(state,data) {
            if(state === 'done') {
                renderDocument(data instanceof Blob ? data : new Blob([data],{type:sharedDocument.mime}))
                    .catch(e => { console.error(e); displayError('文档打开失败：' + e.message); });
            } else if(state === 'cancelled') {
                setDocStatus('文档接收失败：' + (data || '传输已取消'));
            }
        };
        f.receive().catch(e => {
            console.error(e);
            f.cancel(e);
        });
        return true;
    }
    window.handleCatDocumentFileTransfer = handleCatDocumentFileTransfer;

    function getVolume(username) {
        try {
            const raw = localStorage.getItem(volumePrefix + encodeURIComponent(username || 'unknown'));
            const value = raw === null ? 100 : Number(raw);
            return Number.isFinite(value) ? Math.max(0,Math.min(100,value)) : 100;
        } catch(e) { return 100; }
    }

    function applyCatMeetUserVolume(userId, username, value) {
        const volume = Math.max(0,Math.min(100,Number(value)));
        try {
            localStorage.setItem(volumePrefix + encodeURIComponent(username || userId), String(volume));
        } catch(e) {}
        for(const c of Object.values(serverConnection?.down || {})) {
            if(c.source !== userId && c.username !== username)
                continue;
            const media = byId('media-' + c.localId);
            if(media) {
                try { media.volume = volume / 100; }
                catch(e) { console.warn('This browser controls media volume at system level',e); }
            }
        }
    }
    window.applyCatMeetUserVolume = applyCatMeetUserVolume;

    function applyCatMeetRemoteVolume(c, media) {
        if(!c || !media || c.up)
            return;
        const user = serverConnection?.users?.[c.source];
        const username = c.username || (user && user.username) || c.source;
        const volume = getVolume(username);
        try { media.volume = volume / 100; }
        catch(e) {}
    }
    window.applyCatMeetRemoteVolume = applyCatMeetRemoteVolume;

    function installVolumeControls() {
        const users = byId('users');
        if(!users || !serverConnection)
            return;
        for(const row of users.querySelectorAll('.user-p')) {
            const id = row.id.slice('user-'.length);
            if(!id || id === serverConnection.id || row.querySelector('.cm-user-volume'))
                continue;
            const user = serverConnection.users[id];
            const username = user && user.username || id;
            const details = document.createElement('details');
            details.className = 'cm-user-volume';
            details.addEventListener('click', e => e.stopPropagation());
            const summary = document.createElement('summary');
            summary.textContent = '🔊';
            summary.title = '调整你听到的该成员音量';
            summary.setAttribute('aria-label','调整该成员音量');
            const panel = document.createElement('div');
            panel.className = 'cm-user-volume-panel';
            const slider = document.createElement('input');
            slider.type = 'range';
            slider.min = '0'; slider.max = '100'; slider.step = '1';
            slider.value = String(getVolume(username));
            slider.setAttribute('aria-label','成员音量');
            const value = document.createElement('span');
            value.className = 'cm-user-volume-value';
            value.textContent = slider.value + '%';
            slider.addEventListener('input', e => {
                e.stopPropagation();
                value.textContent = slider.value + '%';
                applyCatMeetUserVolume(id,username,slider.value);
            });
            slider.addEventListener('click', e => e.stopPropagation());
            panel.append(slider,value);
            details.append(summary,panel);
            row.appendChild(details);
        }
    }

    function init() {
        const upload = byId('cm-doc-upload');
        const file = byId('cm-doc-file');
        if(upload && file) {
            upload.addEventListener('click', () => file.click());
            file.addEventListener('change', () => {
                const selected = file.files && file.files[0];
                if(selected) startDocumentShare(selected).catch(e => {
                    console.error(e); displayError('文档打开失败：' + e.message);
                });
                file.value = '';
            });
        }
        byId('cm-doc-close')?.addEventListener('click', () => showDocStage(false));
        byId('cm-doc-undo')?.addEventListener('click', () => {
            if(!sharedDocument) return;
            let opId = undoStack.pop();
            if(!opId && currentDocEditor() && sharedDocument.operations.length)
                opId = sharedDocument.operations[sharedDocument.operations.length - 1].id;
            if(!opId) return;
            const op = sharedDocument.operations.find(item => item.id === opId) ||
                operationCache.get(opId);
            if(op) {
                operationCache.set(opId, JSON.parse(JSON.stringify(op)));
                redoStack.push(opId);
            }
            docAction({action:'undo',opId});
        });
        byId('cm-doc-redo')?.addEventListener('click', () => {
            const opId = redoStack.pop();
            const op = opId && operationCache.get(opId);
            if(op && sharedDocument) {
                docAction({action:'annotate',operation:op});
                undoStack.push(opId);
            }
        });
        byId('cm-doc-clear')?.addEventListener('click', () => {
            if(currentDocOwner() || currentDocEditor())
                docAction({action:'clear'});
        });
        byId('cm-doc-end')?.addEventListener('click', () => {
            if(currentDocOwner() && window.confirm('确定结束文档共享吗？'))
                docAction({action:'end'});
        });
        byId('cm-doc-grant')?.addEventListener('click', () => {
            const target = byId('cm-doc-member').value;
            if(target) docAction({action:'grant-editor',target});
        });
        byId('cm-doc-block')?.addEventListener('click', () => {
            const target = byId('cm-doc-member').value;
            if(target) docAction({action:'block-annotations',target});
        });
        byId('cm-doc-allow')?.addEventListener('click', () => {
            const target = byId('cm-doc-member').value;
            if(target) docAction({action:'allow-annotations',target});
        });
        byId('cm-doc-tool')?.addEventListener('change', event => {
            byId('cm-doc-stage').dataset.tool = event.target.value;
            const content = byId('cm-doc-content');
            const frame = content && content.querySelector('iframe');
            if(frame)
                frame.style.pointerEvents = event.target.value === 'pan' ? 'auto' : 'none';
        });
        setupCanvas();
        window.addEventListener('resize', resizeCanvas);
        const users = byId('users');
        if(users) {
            const observer = new MutationObserver(installVolumeControls);
            observer.observe(users,{childList:true,subtree:true});
        }
        installVolumeControls();
    }

    if(document.readyState === 'loading')
        document.addEventListener('DOMContentLoaded',init,{once:true});
    else
        init();
})();
