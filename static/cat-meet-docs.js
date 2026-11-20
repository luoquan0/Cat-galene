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
    let pdfDocument = null;
    let pdfPageNumber = 1;
    let pdfRenderTask = null;
    let documentZoom = 1;
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

    function clearLocalDocument(message, expectedId) {
        if(expectedId && sharedDocument && sharedDocument.id !== expectedId)
            return false;
        if(pdfRenderTask) {
            try { pdfRenderTask.cancel(); } catch(e) {}
            pdfRenderTask = null;
        }
        pdfDocument = null;
        pdfPageNumber = 1;
        sharedDocument = null;
        sharedDocumentFile = null;
        activeOperation = null;
        undoStack = [];
        redoStack = [];
        operationCache.clear();
        if(sharedDocumentBlobUrl) {
            URL.revokeObjectURL(sharedDocumentBlobUrl);
            sharedDocumentBlobUrl = null;
        }
        const content = byId('cm-doc-content');
        if(content) {
            content.replaceChildren();
            content.classList.remove('cm-doc-pdf');
            content.style.zoom = '';
        }
        documentZoom = 1;
        updateDocumentZoomLabel();
        const download = byId('cm-doc-download');
        if(download) {
            download.removeAttribute('href');
            download.removeAttribute('download');
        }
        const pdfNav = byId('cm-doc-pdf-nav');
        if(pdfNav) pdfNav.hidden = true;
        const input = byId('cm-doc-file');
        if(input) input.value = '';
        showDocStage(false);
        setDocStatus(message || '当前没有共享文档。');
        return true;
    }

    function endDocumentShare(message) {
        if(!sharedDocument) {
            clearLocalDocument(message);
            return;
        }
        const docId = sharedDocument.id;
        if(currentDocOwner()) {
            try {
                docAction({action:'end', docId});
            } catch(e) {
                console.warn('Could not notify the meeting that document sharing ended', e);
            }
        }
        clearLocalDocument(message || '文档共享已结束。', docId);
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
        for(const id of ['cm-doc-grant','cm-doc-block','cm-doc-allow','cm-doc-end','cm-doc-restore-end']) {
            const button = byId(id);
            if(button) button.style.display = owner ? 'inline-flex' : 'none';
        }
        const clearButton = byId('cm-doc-clear');
        if(clearButton) clearButton.style.display = editor ? 'inline-flex' : 'none';
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
        const fileName = safeText(file && file.name) || safeText(sharedDocument && sharedDocument.name);
        const ext = (fileName.split('.').pop() || '').toLowerCase();
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
            if(!currentDocOwner()) {
                displayError('当前文档由其他参会者主持，请让文档上传者先结束共享。');
                return;
            }
            if(!window.confirm('当前文档仍在共享。结束旧文档并改为共享新文件吗？'))
                return;
            endDocumentShare('正在替换共享文档…');
        }
        if(typeof closeNav === 'function')
            closeNav();
        const id = (crypto.randomUUID ? crypto.randomUUID() :
            'doc-' + Date.now() + '-' + Math.random().toString(36).slice(2));
        sharedDocumentFile = file;
        sharedDocument = {
            id, owner: serverConnection.id, name: file.name, mime: file.type || '',
            size: file.size, editors: [], blocked: [], operations: [],
        };
        try {
            docAction({
                action: 'start', id, name: file.name, mime: file.type || '',
                size: file.size,
            });
            await renderDocument(file);
            setDocStatus('文档已共享，参会者可以接收原文件并实时批注。');
        } catch(error) {
            try { docAction({action:'end', docId:id}); } catch(e) {}
            clearLocalDocument('文档预览失败，已取消本次共享；可以重新选择文件。', id);
            throw error;
        }
    }

    function showDocStage(show) {
        const stage = byId('cm-doc-stage');
        const video = byId('expand-video');
        const container = byId('video-container');
        if(!stage || !video || !container)
            return;
        const hasSharedDocument = !!sharedDocument;
        const restoreBar = byId('cm-doc-restore-bar');
        const restoreTitle = byId('cm-doc-restore-title');
        if(restoreTitle)
            restoreTitle.textContent = safeText(sharedDocument && sharedDocument.name) || '共享文档';
        if(restoreBar)
            restoreBar.hidden = !!show || !hasSharedDocument;

        stage.hidden = !show;
        video.style.display = show ? 'none' : '';
        const empty = container.querySelector('.cm-empty-stage');
        if(empty)
            empty.style.display = show ? 'none' : '';
        if(show || hasSharedDocument) {
            // Keep the stage container visible while a document is shared,
            // even when the preview is hidden and no media stream is active.
            if(typeof setVisibility === 'function')
                setVisibility('video-container', true);
            else
                container.classList.remove('invisible');
            container.classList.add('cm-document-active');
            container.style.display = 'flex';
            if(show)
                resizeCanvas();
        } else {
            container.classList.remove('cm-document-active');
            container.style.display = '';
            if(typeof showVideo === 'function')
                showVideo();
            else if(typeof setVisibility === 'function')
                setVisibility('video-container',
                    byId('peers') && byId('peers').childElementCount > 0);
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

    async function renderPdfPage() {
        if(!pdfDocument)
            return;
        const canvas = byId('cm-doc-pdf-render');
        const pageContainer = byId('cm-doc-page');
        if(!canvas || !pageContainer)
            return;
        if(pdfRenderTask) {
            try { pdfRenderTask.cancel(); } catch(e) {}
            pdfRenderTask = null;
        }
        const pdfPage = await pdfDocument.getPage(pdfPageNumber);
        const baseViewport = pdfPage.getViewport({scale:1});
        const availableWidth = Math.max(240, pageContainer.clientWidth - 56);
        const availableHeight = Math.max(240, pageContainer.clientHeight - 56);
        const scale = Math.min(availableWidth / baseViewport.width,
            availableHeight / baseViewport.height, 2);
        const viewport = pdfPage.getViewport({scale});
        const outputScale = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
        canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
        canvas.style.width = Math.floor(viewport.width) + 'px';
        canvas.style.height = Math.floor(viewport.height) + 'px';
        const context = canvas.getContext('2d', {alpha:false});
        const renderViewport = pdfPage.getViewport({scale:scale * outputScale});
        pdfRenderTask = pdfPage.render({
            canvasContext: context,
            viewport: renderViewport,
            background: '#ffffff',
        });
        await pdfRenderTask.promise;
        pdfRenderTask = null;
        const counter = byId('cm-doc-pdf-page');
        const previous = byId('cm-doc-pdf-prev');
        const next = byId('cm-doc-pdf-next');
        if(counter) counter.textContent = pdfPageNumber + ' / ' + pdfDocument.numPages;
        if(previous) previous.disabled = pdfPageNumber <= 1;
        if(next) next.disabled = pdfPageNumber >= pdfDocument.numPages;
        resizeCanvas();
        redrawAnnotations();
    }

    async function changePdfPage(delta) {
        if(!pdfDocument)
            return;
        const target = Math.max(1, Math.min(pdfDocument.numPages, pdfPageNumber + delta));
        if(target === pdfPageNumber)
            return;
        pdfPageNumber = target;
        await renderPdfPage();
    }

    function updateDocumentZoomLabel() {
        const label = byId('cm-doc-zoom-value');
        if(label)
            label.textContent = Math.round(documentZoom * 100) + '%';
        const out = byId('cm-doc-zoom-out');
        const input = byId('cm-doc-zoom-in');
        if(out) out.disabled = documentZoom <= 0.5;
        if(input) input.disabled = documentZoom >= 3;
    }

    function applyDocumentZoom() {
        const content = byId('cm-doc-content');
        if(content)
            content.style.zoom = String(documentZoom);
        updateDocumentZoomLabel();
        resizeCanvas();
    }

    function changeDocumentZoom(delta) {
        documentZoom = Math.round(Math.max(0.5, Math.min(3, documentZoom + delta)) * 100) / 100;
        applyDocumentZoom();
    }

    async function renderDocument(file) {
        const content = byId('cm-doc-content');
        const title = byId('cm-doc-title');
        if(!content || !file)
            return;
        if(pdfRenderTask) {
            try { pdfRenderTask.cancel(); } catch(e) {}
            pdfRenderTask = null;
        }
        pdfDocument = null;
        pdfPageNumber = 1;
        const fileName = safeText(file.name) || safeText(sharedDocument && sharedDocument.name) || '共享文档';
        content.replaceChildren();
        documentZoom = 1;
        content.style.zoom = '1';
        updateDocumentZoomLabel();
        content.classList.remove('cm-doc-pdf');
        title.textContent = fileName;
        if(sharedDocumentBlobUrl)
            URL.revokeObjectURL(sharedDocumentBlobUrl);
        sharedDocumentBlobUrl = URL.createObjectURL(file);
        const download = byId('cm-doc-download');
        if(download) {
            download.href = sharedDocumentBlobUrl;
            download.download = fileName;
        }
        const pdfNav = byId('cm-doc-pdf-nav');
        if(pdfNav) pdfNav.hidden = true;
        const type = docFileType(file);
        if(type === 'image') {
            const image = document.createElement('img');
            image.src = sharedDocumentBlobUrl;
            image.alt = fileName;
            content.appendChild(image);
        } else if(type === 'pdf') {
            if(!window.pdfjsLib)
                throw new Error('PDF 阅读组件尚未加载，请刷新页面后重试。');
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.js?v=1.2.2-cat.15-dev';
            const bytes = new Uint8Array(await file.arrayBuffer());
            const loadingTask = window.pdfjsLib.getDocument({
                data: bytes,
                isEvalSupported: false,
                useWorkerFetch: false,
            });
            pdfDocument = await loadingTask.promise;
            pdfPageNumber = 1;
            content.classList.add('cm-doc-pdf');
            const canvas = document.createElement('canvas');
            canvas.id = 'cm-doc-pdf-render';
            canvas.className = 'cm-doc-pdf-render';
            canvas.setAttribute('aria-label', 'PDF 页面预览');
            content.appendChild(canvas);
            if(pdfNav) pdfNav.hidden = pdfDocument.numPages <= 1;
            showDocStage(true);
            await renderPdfPage();
            setDocStatus('PDF 已加载：使用上一页 / 下一页浏览，画笔工具可在当前页实时批注。');
        } else if(type === 'docx') {
            const text = await extractDocxText(file);
            const article = document.createElement('article');
            article.className = 'cm-docx-text';
            article.textContent = text;
            content.appendChild(article);
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
        const pdfCanvas = byId('cm-doc-pdf-render');
        const content = byId('cm-doc-content');
        const target = pdfCanvas || content;
        const pageRect = page.getBoundingClientRect();
        const targetRect = target && target.getBoundingClientRect();
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = targetRect && targetRect.width > 0 ?
            targetRect.width : Math.max(1, page.clientWidth - 28);
        const height = targetRect && targetRect.height > 0 ?
            targetRect.height : Math.max(1, page.clientHeight - 28);
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        if(targetRect && targetRect.width > 0) {
            canvas.style.top = (targetRect.top - pageRect.top + page.scrollTop) + 'px';
            canvas.style.left = (targetRect.left - pageRect.left + page.scrollLeft) + 'px';
            canvas.style.transform = 'none';
        } else {
            canvas.style.top = '14px';
            canvas.style.left = '50%';
            canvas.style.transform = 'translateX(-50%)';
        }
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
        if(pdfDocument && op.page && op.page !== pdfPageNumber)
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
                    width: Number(byId('cm-doc-width').value), points:[point],
                    page: pdfDocument ? pdfPageNumber : 1, text,
                };
                drawOperation(canvasContext,activeOperation,canvas.clientWidth,canvas.clientHeight);
                sendOperation(activeOperation);
                undoStack.push(activeOperation.id); redoStack = []; activeOperation = null;
                return;
            }
            activeOperation = {
                id: crypto.randomUUID(), tool, color: byId('cm-doc-color').value,
                width: Number(byId('cm-doc-width').value), points:[point],
                page: pdfDocument ? pdfPageNumber : 1,
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
            clearLocalDocument('文档共享已结束。', message.docId);
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
                const current = sharedDocument;
                const received = data instanceof Blob ? data :
                    new Blob([data],{type:current.mime || f.mimetype || 'application/octet-stream'});
                renderDocument(received)
                    .catch(e => {
                        console.error(e);
                        setDocStatus('文档预览失败：' + e.message + '。可以下载原文件，或请上传者重新共享。');
                        displayError('文档打开失败：' + e.message);
                    });
            } else if(state === 'cancelled') {
                setDocStatus('文档接收失败：' + (data || '传输已取消') + '。可以重新请求文档。');
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
            const heading = document.createElement('span');
            heading.className = 'cm-user-volume-label';
            heading.textContent = '音量';
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
            panel.append(heading,slider,value);
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
                    console.error(e);
                    displayError('文档打开失败：' + e.message);
                }).finally(() => { file.value = ''; });
                else
                    file.value = '';
            });
            file.addEventListener('cancel', () => { file.value = ''; });
        }
        byId('cm-doc-close')?.addEventListener('click', () => showDocStage(false));
        byId('cm-doc-restore')?.addEventListener('click', () => {
            if(sharedDocument)
                showDocStage(true);
        });
        byId('cm-doc-zoom-out')?.addEventListener('click', () => changeDocumentZoom(-0.25));
        byId('cm-doc-zoom-in')?.addEventListener('click', () => changeDocumentZoom(0.25));
        byId('cm-doc-zoom-reset')?.addEventListener('click', () => {
            documentZoom = 1;
            applyDocumentZoom();
        });
        const stopDocumentShare = () => {
            if(currentDocOwner() && window.confirm('确定结束文档共享吗？所有参会者将同时关闭文档。'))
                endDocumentShare('文档共享已取消，可以重新上传文件。');
        };
        byId('cm-doc-end')?.addEventListener('click', stopDocumentShare);
        byId('cm-doc-restore-end')?.addEventListener('click', stopDocumentShare);
        byId('cm-doc-pdf-prev')?.addEventListener('click', () => {
            changePdfPage(-1).catch(e => { console.error(e); setDocStatus('PDF 页面切换失败：' + e.message); });
        });
        byId('cm-doc-pdf-next')?.addEventListener('click', () => {
            changePdfPage(1).catch(e => { console.error(e); setDocStatus('PDF 页面切换失败：' + e.message); });
        });
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
        window.addEventListener('resize', () => {
            if(pdfDocument)
                renderPdfPage().catch(e => console.warn('PDF resize failed',e));
            else
                resizeCanvas();
        });
        byId('cm-doc-page')?.addEventListener('scroll', resizeCanvas);
        byId('cm-doc-content')?.addEventListener('scroll', resizeCanvas);
        window.addEventListener('cat-meet-session-closed', () => {
            clearLocalDocument('会议已断开，文档预览已关闭。');
            setCatMeetingDuration(null);
        });
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
