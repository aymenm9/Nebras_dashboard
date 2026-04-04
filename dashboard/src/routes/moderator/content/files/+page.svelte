<script>
	import { onMount } from 'svelte';
	import { listMyFiles, removeFile, updateFile, listMyMainSections, listMySubSections, listMySecondarySections } from '$lib/api/moderator.js';
	import { createFileUploader, createResumeUploader, formatFileSize, mimeToContentType } from '$lib/utils/fileUpload.js';
	import { t } from '$lib/i18n/store.svelte.js';

	// List state
	let items = $state([]);
	let totalCount = $state(0);
	let currentPage = $state(1);
	let searchQuery = $state('');
	let filterMainSection = $state('');
	let filterContentType = $state('');
	let filterIsListed = $state('');
	let isLoading = $state(true);
	let error = $state('');

	let mainSectionsList = $state([]);
	let subSectionsList = $state([]);
	let secondarySectionsList = $state([]);

	// Upload modal — batch multi-entry
	let showUploadModal = $state(false);
	let batchMainSection = $state('');
	let batchSubsection = $state('');
	let batchSecondarySubsection = $state('');
	let uploadSubOptions = $state([]);
	let uploadSecondaryOptions = $state([]);
	let batchUploadFormError = $state('');
	let batchUploadAllLoading = $state(false);

	function makeFileEntry() {
		return { id: crypto.randomUUID(), file: null, title: '', description: '', author: '', is_listed: true, thumbnail: null, thumbnailPreview: '', status: 'idle', progress: 0, error: '' };
	}
	let batchFileEntries = $state([makeFileEntry()]);

	let batchUploadIsAny = $derived(batchFileEntries.some(e => e.status === 'uploading'));
	let batchUploadAllDone = $derived(batchFileEntries.length > 0 && batchFileEntries.every(e => e.status === 'completed'));
	let batchUploadPendingCount = $derived(batchFileEntries.filter(e => e.status === 'idle' || e.status === 'failed').length);

	// Edit modal
	let showEditModal = $state(false);
	let editingItem = $state(null);
	let editForm = $state({ title: '', description: '', author: '', is_listed: true });
	let editFormError = $state('');
	let editFormLoading = $state(false);

	// Delete modal
	let showDeleteModal = $state(false);
	let deletingItem = $state(null);
	let deleteLoading = $state(false);

	// Detail modal
	let showDetailModal = $state(false);
	let detailItem = $state(null);

	// Resume modal
	let showResumeModal = $state(false);
	let resumeItem = $state(null);
	let resumeFile = $state(null);
	let resumeStatus = $state('');
	let resumeProgress = $state(0);
	let resumeError = $state('');
	let currentResumeUploader = $state(null);

	const PAGE_SIZE = 10;
	let totalPages = $derived(Math.ceil(totalCount / PAGE_SIZE));
	let searchTimeout;

	onMount(() => { fetchItems(); fetchMainOptions(); });

	async function fetchItems() {
		isLoading = true; error = '';
		try {
			const data = await listMyFiles({
				search: searchQuery,
				main_section: filterMainSection || undefined,
				content_type: filterContentType || undefined,
				metadata__is_listed: filterIsListed === '' ? undefined : filterIsListed === 'true',
				page: currentPage
			});
			items = data.results; totalCount = data.count;
		} catch (err) { error = err.message; }
		finally { isLoading = false; }
	}

	async function fetchMainOptions() {
		try { const d = await listMyMainSections({ page: 1 }); mainSectionsList = d.results; } catch {}
	}

	async function fetchSubOpts(mainId) {
		try { const d = await listMySubSections({ main_section: mainId || undefined, page: 1 }); uploadSubOptions = d.results; }
		catch { uploadSubOptions = []; }
	}

	async function fetchSecOpts(subId) {
		try { const d = await listMySecondarySections({ sub_section: subId || undefined, page: 1 }); uploadSecondaryOptions = d.results; }
		catch { uploadSecondaryOptions = []; }
	}

	function handleSearch() { clearTimeout(searchTimeout); searchTimeout = setTimeout(() => { currentPage = 1; fetchItems(); }, 400); }
	function handleFilterChange() { currentPage = 1; fetchItems(); }
	function goToPage(p) { if (p < 1 || p > totalPages) return; currentPage = p; fetchItems(); }

	// ─── Upload Modal ───────────────────────────────────
	function openUploadModal() {
		batchFileEntries = [makeFileEntry()];
		batchMainSection = '';
		batchSubsection = '';
		batchSecondarySubsection = '';
		uploadSubOptions = [];
		uploadSecondaryOptions = [];
		batchUploadFormError = '';
		showUploadModal = true;
		if (mainSectionsList.length === 0) fetchMainOptions();
	}

	function handleUploadMainChange() {
		batchSubsection = '';
		batchSecondarySubsection = '';
		uploadSecondaryOptions = [];
		if (batchMainSection) fetchSubOpts(batchMainSection);
		else uploadSubOptions = [];
	}

	function handleUploadSubChange() {
		batchSecondarySubsection = '';
		if (batchSubsection) fetchSecOpts(batchSubsection);
		else uploadSecondaryOptions = [];
	}

	function addFileEntry() {
		batchFileEntries = [...batchFileEntries, makeFileEntry()];
	}

	function removeFileEntry(id) {
		if (batchFileEntries.length === 1) return;
		batchFileEntries = batchFileEntries.filter(e => e.id !== id);
	}

	function handleBatchFileSelect(id, e) {
		const f = e.target.files?.[0];
		if (!f) return;
		batchFileEntries = batchFileEntries.map(entry =>
			entry.id === id ? { ...entry, file: f, title: entry.title || f.name.replace(/\.[^/.]+$/, '') } : entry
		);
	}

	function handleBatchFileThumbnail(id, e) {
		const f = e.target.files?.[0];
		if (!f) return;
		const r = new FileReader();
		r.onload = (ev) => {
			batchFileEntries = batchFileEntries.map(entry =>
				entry.id === id ? { ...entry, thumbnail: f, thumbnailPreview: ev.target.result } : entry
			);
		};
		r.readAsDataURL(f);
	}

	function clearBatchFileThumbnail(id) {
		batchFileEntries = batchFileEntries.map(e => e.id === id ? { ...e, thumbnail: null, thumbnailPreview: '' } : e);
	}

	async function uploadFileEntry(entry) {
		batchUploadFormError = '';
		if (!entry.file) { batchFileEntries = batchFileEntries.map(e => e.id === entry.id ? { ...e, error: 'Please select a file.' } : e); return false; }
		if (!batchSubsection) { batchUploadFormError = 'Please select a sub section first.'; return false; }
		if (!entry.title) { batchFileEntries = batchFileEntries.map(e => e.id === entry.id ? { ...e, error: 'Title is required.' } : e); return false; }

		batchFileEntries = batchFileEntries.map(e => e.id === entry.id ? { ...e, status: 'uploading', error: '', progress: 0 } : e);
		const contentType = mimeToContentType(entry.file.type);
		const metadata = {
			title: entry.title,
			description: entry.description || undefined,
			author: entry.author || undefined,
			subsection: Number(batchSubsection),
			content_type: contentType,
			is_listed: entry.is_listed
		};
		if (batchSecondarySubsection) metadata.secondary_subsection = Number(batchSecondarySubsection);

		const uploader = createFileUploader(entry.file, metadata, entry.thumbnail, {
			onProgress: (p) => { batchFileEntries = batchFileEntries.map(e => e.id === entry.id ? { ...e, progress: p } : e); },
			onStatus: (s) => { if (s === 'completed') batchFileEntries = batchFileEntries.map(e => e.id === entry.id ? { ...e, status: 'completed', progress: 100 } : e); },
			onError: (msg) => { batchFileEntries = batchFileEntries.map(e => e.id === entry.id ? { ...e, status: 'failed', error: msg } : e); }
		});

		try {
			await uploader.start();
			return true;
		} catch {
			return false;
		}
	}

	async function handleUploadSingleFile(id) {
		const entry = batchFileEntries.find(e => e.id === id);
		if (!entry || entry.status === 'uploading' || entry.status === 'completed') return;
		const ok = await uploadFileEntry(entry);
		if (ok) fetchItems();
	}

	async function handleUploadAllFiles() {
		if (!batchSubsection) { batchUploadFormError = 'Please select a sub section first.'; return; }
		batchUploadAllLoading = true;
		const pending = batchFileEntries.filter(e => e.status === 'idle' || e.status === 'failed');
		await Promise.all(pending.map(e => uploadFileEntry(e)));
		batchUploadAllLoading = false;
		fetchItems();
	}

	// ─── Edit ───────────────────────────────────────────
	function openEditModal(item) {
		editingItem = item;
		editForm = { title: item.metadata?.title || '', description: item.metadata?.description || '', author: item.metadata?.author || '', is_listed: item.metadata?.is_listed ?? true };
		editFormError = '';
		showEditModal = true;
	}
	async function handleEdit() {
		editFormError = ''; editFormLoading = true;
		try {
			await updateFile(editingItem.id, {
				metadata: { title: editForm.title, description: editForm.description || undefined, author: editForm.author || undefined, is_listed: editForm.is_listed }
			});
			showEditModal = false; fetchItems();
		} catch (err) { editFormError = err.message; }
		finally { editFormLoading = false; }
	}

	// ─── Delete ─────────────────────────────────────────
	function openDeleteModal(item) { deletingItem = item; showDeleteModal = true; }
	async function handleDelete() {
		deleteLoading = true;
		try { await removeFile(deletingItem.id); showDeleteModal = false; deletingItem = null; fetchItems(); }
		catch (err) { error = err.message; showDeleteModal = false; }
		finally { deleteLoading = false; }
	}

	function handleRowClick(item) {
		if (item.upload_status === 'pending') {
			openResumeModal(item);
		} else {
			openDetailModal(item);
		}
	}

	function openDetailModal(item) { detailItem = item; showDetailModal = true; }

	// ─── Resume ────────────────────────────────────────
	function openResumeModal(item) {
		resumeItem = item;
		resumeFile = null;
		resumeStatus = '';
		resumeProgress = 0;
		resumeError = '';
		currentResumeUploader = null;
		// Show initial progress for multipart
		if (item.multipart_uploader) {
			const { uploaded_parts, total_parts } = item.multipart_uploader;
			resumeProgress = Math.round((uploaded_parts / total_parts) * 100);
		}
		showResumeModal = true;
	}

	function handleResumeFileSelect(e) {
		const f = e.target.files?.[0];
		if (f) resumeFile = f;
	}

	async function startResume() {
		resumeError = '';
		if (!resumeFile) { resumeError = 'Please re-select the original file.'; return; }

		const uploader = createResumeUploader(resumeItem, resumeFile, {
			onProgress: (p) => { resumeProgress = p; },
			onStatus: (s) => { resumeStatus = s; },
			onError: (msg) => { resumeError = msg; }
		});
		currentResumeUploader = uploader;

		try {
			await uploader.start();
			setTimeout(() => { showResumeModal = false; fetchItems(); }, 800);
		} catch { /* handled via onError */ }
	}

	function cancelResume() {
		if (currentResumeUploader) currentResumeUploader.abort();
		showResumeModal = false;
		fetchItems();
	}
	function formatDate(d) { if (!d) return '—'; return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }

	function statusColor(s) {
		if (s === 'completed') return 'status-completed';
		if (s === 'failed') return 'status-failed';
		return 'status-pending';
	}

	function contentTypeIcon(ct) {
		if (ct === 'video') return '🎬';
		if (ct === 'audio') return '🎵';
		return '📄';
	}
</script>

<svelte:head><title>{t('content.title')} — Nebras</title></svelte:head>

<div class="page">
	<div class="page-header">
		<div><h1 class="page-title">{t('content.my_content')}</h1><p class="page-desc">{t('content.my_content_desc')}</p></div>
		<button class="btn btn-primary" onclick={openUploadModal}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M12 5v14m-7-7h14" /></svg>
			{t('content.upload_file')}
		</button>
	</div>

	<div class="tabs">
		<a href="/moderator/content/youtube" class="tab">{t('content.youtube_videos')}</a>
		<a href="/moderator/content/files" class="tab active">{t('content.file_uploads')}</a>
	</div>

	<div class="toolbar">
		<div class="search-box">
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="search-icon"><path d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
			<input type="text" placeholder={t('content.search_files')} bind:value={searchQuery} oninput={handleSearch} class="search-input" />
		</div>
		<select class="filter-select" bind:value={filterContentType} onchange={handleFilterChange}>
			<option value="">{t('content.all_types')}</option>
			<option value="video">{t('content.video')}</option>
			<option value="audio">{t('content.audio')}</option>
			<option value="document">{t('content.document')}</option>
		</select>
		<select class="filter-select" bind:value={filterMainSection} onchange={handleFilterChange}>
			<option value="">{t('content.all_sections')}</option>
			{#each mainSectionsList as ms}<option value={ms.id}>{ms.name}</option>{/each}
		</select>
		<select class="filter-select" bind:value={filterIsListed} onchange={handleFilterChange}>
			<option value="">{t('common.all')} ({t('common.is_listed')})</option>
			<option value="true">{t('common.listed')}</option>
			<option value="false">{t('common.unlisted')}</option>
		</select>
		<div class="count-badge">{totalCount} {t('common.total')}</div>
	</div>

	{#if error}<div class="alert alert-error">{error}</div>{/if}

	<div class="content-container">
		{#if isLoading}
			<div class="state-box"><div class="spinner"></div><span>{t('common.loading')}</span></div>
		{:else if items.length === 0}
			<div class="state-box empty-state">
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="empty-icon"><path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" stroke-linecap="round" stroke-linejoin="round" /></svg>
				<p>{t('content.no_files_uploaded')}</p>
				<button class="btn btn-primary btn-sm" onclick={openUploadModal}>{t('content.upload_first_file')}</button>
			</div>
		{:else}
			<div class="file-list">
				{#each items as item (item.id)}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="file-row" class:file-row-pending={item.upload_status === 'pending'} onclick={() => handleRowClick(item)}>
						<div class="file-icon">{contentTypeIcon(item.metadata?.content_type)}</div>
						<div class="file-info">
							<span class="file-name">{item.metadata?.title || item.filename || 'Untitled'}</span>
							<span class="file-meta" style="color: {item.metadata?.is_listed === false ? 'var(--color-danger-400)' : 'inherit'};">
								{item.metadata?.is_listed === false ? t('common.unlisted') : `${item.file_type} · ${formatFileSize(item.file_size)}`}
							</span>
						</div>
						<span class="file-status {statusColor(item.upload_status)}">{item.upload_status}</span>
						<span class="file-date">{formatDate(item.metadata?.created_at)}</span>
						<div class="file-actions" role="presentation" onclick={(e) => e.stopPropagation()}>
							<button class="action-btn edit" title="Edit" onclick={() => openEditModal(item)}>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
							</button>
							<button class="action-btn delete" title="Delete" onclick={() => openDeleteModal(item)}>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
							</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	{#if totalPages > 1}
		<div class="pagination">
			<button class="page-btn" disabled={currentPage === 1} onclick={() => goToPage(currentPage - 1)}>← {t('common.previous')}</button>
			<div class="page-numbers">
				{#each Array.from({ length: totalPages }, (_, i) => i + 1) as p}
					{#if p === 1 || p === totalPages || (p >= currentPage - 1 && p <= currentPage + 1)}
						<button class="page-num" class:active={p === currentPage} onclick={() => goToPage(p)}>{p}</button>
					{:else if p === currentPage - 2 || p === currentPage + 2}
						<span class="page-ellipsis">...</span>
					{/if}
				{/each}
			</div>
			<button class="page-btn" disabled={currentPage === totalPages} onclick={() => goToPage(currentPage + 1)}>{t('common.next')} →</button>
		</div>
	{/if}
</div>

<!-- ═══════════════ Upload Modal (Batch) ═══════════════ -->
{#if showUploadModal}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="modal-overlay" role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && !batchUploadIsAny && (showUploadModal = false)} onclick={(e) => { if (e.target === e.currentTarget && !batchUploadIsAny) showUploadModal = false; }}>
		<div class="modal modal-batch animate-fade-in">
			<div class="modal-header">
				<h2 class="modal-title">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:18px;height:18px;display:inline;vertical-align:-3px;margin-right:6px;"><path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" stroke-linecap="round" stroke-linejoin="round"/></svg>
					{t('content.upload_file')} <span class="batch-count-pill">{batchFileEntries.length}</span>
				</h2>
				{#if !batchUploadIsAny}
					<button class="modal-close" aria-label="Close" onclick={() => (showUploadModal = false)}>
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" /></svg>
					</button>
				{/if}
			</div>

			<!-- Shared section selectors -->
			<div class="batch-sections">
				<div class="batch-sections-title">{t('content.shared_section')}</div>
				<div class="batch-sections-row">
					<select class="form-input" bind:value={batchMainSection} onchange={handleUploadMainChange}>
						<option value="">{t('sections.main_section')}</option>
						{#each mainSectionsList as ms}<option value={ms.id}>{ms.name}</option>{/each}
					</select>
					{#if batchMainSection}
						<select class="form-input" bind:value={batchSubsection} onchange={handleUploadSubChange}>
							<option value="">{t('sections.sub_section')}</option>
							{#each uploadSubOptions as ss}<option value={ss.id}>{ss.name}</option>{/each}
						</select>
					{/if}
					{#if batchSubsection && uploadSecondaryOptions.length > 0}
						<select class="form-input" bind:value={batchSecondarySubsection}>
							<option value="">{t('sections.secondary')} ({t('common.none')})</option>
							{#each uploadSecondaryOptions as sec}<option value={sec.id}>{sec.name}</option>{/each}
						</select>
					{/if}
				</div>
				{#if batchUploadFormError}<div class="alert alert-error" style="margin-top:0.5rem;">{batchUploadFormError}</div>{/if}
			</div>

			<!-- Entries list -->
			<div class="batch-entries">
				{#each batchFileEntries as entry (entry.id)}
					<div class="batch-entry" class:entry-success={entry.status === 'completed'} class:entry-error={entry.status === 'failed'}>
						<!-- Entry header -->
						<div class="batch-entry-header">
							<div class="entry-status-badge"
								class:status-idle={entry.status==='idle'}
								class:status-uploading={entry.status==='uploading'}
								class:status-success={entry.status==='completed'}
								class:status-error={entry.status==='failed'}>
								{#if entry.status === 'uploading'}<span class="spinner-sm"></span>{/if}
								{entry.status === 'idle' ? t('content.status_pending') : entry.status === 'uploading' ? t('content.status_uploading') : entry.status === 'completed' ? t('content.status_uploaded') : t('content.status_failed')}
							</div>
							<div class="entry-header-actions">
								{#if entry.status !== 'completed'}
									<button type="button" class="btn btn-primary btn-sm" disabled={entry.status==='uploading' || batchUploadIsAny} onclick={() => handleUploadSingleFile(entry.id)}>
										{#if entry.status==='uploading'}<span class="spinner-sm"></span>{/if}
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:13px;height:13px"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" stroke-linecap="round" stroke-linejoin="round"/></svg>
										{t('common.upload')}
									</button>
								{/if}
								{#if batchFileEntries.length > 1 && entry.status !== 'uploading'}
									<button type="button" class="action-btn delete" title="Remove" onclick={() => removeFileEntry(entry.id)}>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"/></svg>
									</button>
								{/if}
							</div>
						</div>

						{#if entry.status === 'uploading'}
							<!-- Progress bar -->
							<div class="entry-progress">
								<div class="progress-bar-track"><div class="progress-bar-fill" style="width:{entry.progress}%"></div></div>
								<span class="progress-pct">{entry.progress}%</span>
							</div>
						{/if}

						{#if entry.error}
							<div class="alert alert-error" style="font-size:0.75rem;padding:0.5rem 0.75rem;">{entry.error}</div>
						{/if}

						<fieldset class="entry-fields" disabled={entry.status === 'completed' || entry.status === 'uploading'}>
							<!-- File picker -->
							<div class="form-group">
								<label class="form-label">{t('content.file')} *</label>
								{#if entry.file}
									<div class="selected-file">
										<span class="selected-file-name">{entry.file.name}</span>
										<span class="selected-file-size">{formatFileSize(entry.file.size)}</span>
										<button type="button" class="selected-file-remove" onclick={() => { batchFileEntries = batchFileEntries.map(e => e.id === entry.id ? { ...e, file: null } : e); }}>×</button>
									</div>
								{:else}
									<label class="upload-zone entry-upload-zone" for="file-{entry.id}">
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="upload-icon"><path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" stroke-linecap="round" stroke-linejoin="round" /></svg>
										<span style="font-size:0.7rem">{t('content.click_select')}</span>
										<span class="upload-hint">{t('content.upload_hint')}</span>
									</label>
									<input type="file" id="file-{entry.id}" class="file-input-hidden" onchange={(e) => handleBatchFileSelect(entry.id, e)} />
								{/if}
							</div>
							<div class="entry-two-col">
								<div class="form-group">
									<label class="form-label">{t('common.title')} *</label>
									<input type="text" class="form-input" bind:value={entry.title} placeholder={t('common.title')} />
								</div>
								<div class="form-group">
									<label class="form-label">{t('content.author')}</label>
									<input type="text" class="form-input" bind:value={entry.author} placeholder="e.g. John Doe" />
								</div>
							</div>
							<div class="form-group">
								<label class="form-label">{t('content.description')}</label>
								<textarea class="form-input form-textarea" rows="2" bind:value={entry.description} placeholder={t('common.optional')}></textarea>
							</div>
							<div class="entry-bottom-row">
								<div class="entry-thumb-col">
									{#if entry.thumbnailPreview}
										<div class="upload-preview entry-preview">
											<img src={entry.thumbnailPreview} alt="thumb" class="preview-img" />
											<button type="button" class="preview-remove" onclick={() => clearBatchFileThumbnail(entry.id)}>
												<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" /></svg>
											</button>
										</div>
									{:else}
										<label class="upload-zone entry-upload-zone" for="fthumb-{entry.id}">
											<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="upload-icon"><path d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" stroke-linecap="round" stroke-linejoin="round" /></svg>
											<span style="font-size:0.7rem">{t('content.add_thumb')}</span>
										</label>
										<input type="file" id="fthumb-{entry.id}" accept="image/*" class="file-input-hidden" onchange={(e) => handleBatchFileThumbnail(entry.id, e)} />
									{/if}
								</div>
								<label class="toggle-switch">
									<input type="checkbox" bind:checked={entry.is_listed} class="toggle-input" />
									<span class="toggle-slider"></span>
									<span class="toggle-label">{t('common.is_listed')}</span>
								</label>
							</div>
						</fieldset>
					</div>
				{/each}
			</div>

			<!-- Footer -->
			<div class="batch-footer">
				<button type="button" class="btn btn-secondary" onclick={addFileEntry} disabled={batchUploadIsAny}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon"><path d="M12 5v14m-7-7h14" /></svg>
					{t('content.add_another')}
				</button>
				<div style="display:flex;gap:0.5rem;align-items:center;">
					<button type="button" class="btn btn-secondary" onclick={() => (showUploadModal = false)} disabled={batchUploadIsAny}>{t('common.cancel')}</button>
					{#if !batchUploadAllDone}
						<button type="button" class="btn btn-primary" disabled={batchUploadAllLoading || batchUploadIsAny || batchUploadPendingCount === 0} onclick={handleUploadAllFiles}>
							{#if batchUploadAllLoading || batchUploadIsAny}<span class="spinner-sm"></span>{/if}
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="btn-icon"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" stroke-linecap="round" stroke-linejoin="round"/></svg>
							{t('content.upload_all')} ({batchUploadPendingCount})
						</button>
					{:else}
						<button type="button" class="btn btn-primary" onclick={() => (showUploadModal = false)}>
							{t('content.all_uploaded_close')}
						</button>
					{/if}
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Detail Modal -->
{#if showDetailModal && detailItem}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="modal-overlay" role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showDetailModal = false)} onclick={(e) => { if (e.target === e.currentTarget) showDetailModal = false; }}>
		<div class="modal animate-fade-in">
			<div class="modal-header"><h2 class="modal-title">{t('content.file_details')}</h2><button class="modal-close" aria-label="Close" onclick={() => (showDetailModal = false)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" /></svg></button></div>
			<div class="detail-content">
				{#if detailItem.metadata?.thumbnail}
					<img src={detailItem.metadata.thumbnail} alt="" class="detail-thumb" />
				{/if}
				<div class="detail-fields">
					<div class="detail-row"><span class="detail-label">{t('common.title')}</span><span class="detail-value">{detailItem.metadata?.title}</span></div>
					{#if detailItem.metadata?.author}
						<div class="detail-row">
							<span class="detail-label">{t('content.author')}</span>
							<span class="detail-value">{detailItem.metadata.author}</span>
						</div>
					{/if}
					{#if detailItem.metadata?.description}<div class="detail-row"><span class="detail-label">{t('content.description')}</span><span class="detail-value">{detailItem.metadata.description}</span></div>{/if}
					<div class="detail-row"><span class="detail-label">{t('content.file')}</span><span class="detail-value">{detailItem.filename}</span></div>
					<div class="detail-row"><span class="detail-label">{t('common.type')}</span><span class="detail-value">{detailItem.file_type}</span></div>
					<div class="detail-row"><span class="detail-label">{t('content.size')}</span><span class="detail-value">{formatFileSize(detailItem.file_size)}</span></div>
					<div class="detail-row"><span class="detail-label">{t('common.is_listed')}</span><span class="detail-value" style="color: {detailItem.metadata?.is_listed !== false ? 'var(--color-primary-400)' : 'var(--color-danger-400)'};">{detailItem.metadata?.is_listed !== false ? t('common.listed') : t('common.unlisted')}</span></div>
					<div class="detail-row"><span class="detail-label">{t('content.upload')}</span><span class="detail-value">{detailItem.upload_type} — {detailItem.upload_status}</span></div>
					{#if detailItem.file_url}<div class="detail-row"><span class="detail-label">{t('content.url')}</span><span class="detail-value"><a href={detailItem.file_url} target="_blank" rel="noopener" class="link">{t('content.open_file')}</a></span></div>{/if}
					<div class="detail-row"><span class="detail-label">{t('content.created')}</span><span class="detail-value">{formatDate(detailItem.metadata?.created_at)}</span></div>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Delete Modal -->
{#if showDeleteModal && deletingItem}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="modal-overlay" role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showDeleteModal = false)} onclick={(e) => { if (e.target === e.currentTarget) showDeleteModal = false; }}>
		<div class="modal modal-sm animate-fade-in">
			<div class="modal-header"><h2 class="modal-title">{t('content.delete_file')}</h2><button class="modal-close" aria-label="Close" onclick={() => (showDeleteModal = false)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" /></svg></button></div>
			<p class="delete-message">{t('content.delete_confirm')} <strong>"{deletingItem.metadata?.title || deletingItem.filename}"</strong>?</p>
			<div class="modal-actions pad-actions">
				<button class="btn btn-secondary" onclick={() => (showDeleteModal = false)}>{t('common.cancel')}</button>
				<button class="btn btn-danger" onclick={handleDelete} disabled={deleteLoading}>{#if deleteLoading}<span class="spinner-sm"></span>{/if}{t('common.delete')}</button>
			</div>
		</div>
	</div>
{/if}

<!-- ═══════════════ Resume Modal ═══════════════ -->
{#if showResumeModal && resumeItem}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="modal-overlay" role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (!resumeStatus && (showResumeModal = false))} onclick={(e) => { if (e.target === e.currentTarget && !resumeStatus) showResumeModal = false; }}>
		<div class="modal animate-fade-in">
			<div class="modal-header">
				<h2 class="modal-title">{t('content.resume_upload')}</h2>
				{#if !resumeStatus}<button class="modal-close" aria-label="Close" onclick={() => (showResumeModal = false)}>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" /></svg>
				</button>{/if}
			</div>

			{#if resumeStatus}
				<div class="upload-progress-pane">
					<div class="progress-file-name">{resumeFile?.name || resumeItem.filename}</div>
					<div class="progress-bar-track"><div class="progress-bar-fill" style="width:{resumeProgress}%"></div></div>
					<div class="progress-info">
						<span class="progress-pct">{resumeProgress}%</span>
						<span class="progress-status">{resumeStatus === 'uploading' ? t('content.uploading') : resumeStatus === 'completing' ? t('content.finalizing') : resumeStatus === 'completed' ? t('content.complete') : t('content.failed')}</span>
					</div>
					{#if resumeError}<div class="alert alert-error" style="margin-top:0.75rem">{resumeError}</div>{/if}
					{#if resumeStatus === 'completed'}
						<button class="btn btn-primary" style="margin-top:1rem;align-self:center" onclick={() => { showResumeModal = false; fetchItems(); }}>{t('common.done')}</button>
					{:else if resumeStatus === 'failed'}
						<div class="modal-actions" style="margin-top:1rem">
							<button class="btn btn-secondary" onclick={cancelResume}>{t('common.close')}</button>
							<button class="btn btn-primary" onclick={() => { resumeStatus = ''; resumeError = ''; }}>{t('common.retry')}</button>
						</div>
					{:else}
						<button class="btn btn-secondary" style="margin-top:1rem;align-self:center" onclick={cancelResume}>{t('common.cancel')}</button>
					{/if}
				</div>
			{:else}
				<div class="modal-form">
					<div class="resume-info">
						<div class="resume-detail"><span class="resume-label">{t('content.file')}:</span> <strong>{resumeItem.filename}</strong></div>
						<div class="resume-detail"><span class="resume-label">{t('content.size')}:</span> {formatFileSize(resumeItem.file_size)}</div>
						<div class="resume-detail"><span class="resume-label">{t('common.type')}:</span> {resumeItem.upload_type}</div>
						{#if resumeItem.multipart_uploader}
							<div class="resume-detail"><span class="resume-label">{t('content.progress')}:</span> {resumeItem.multipart_uploader.uploaded_parts} / {resumeItem.multipart_uploader.total_parts} {t('content.parts_uploaded')}</div>
							<div class="progress-bar-track" style="margin-top:0.25rem"><div class="progress-bar-fill" style="width:{resumeProgress}%"></div></div>
						{/if}
					</div>

					<div class="form-group">
						<span class="form-label">{t('content.reselect_file')} *</span>
						{#if resumeFile}
							<div class="selected-file">
								<span class="selected-file-name">{resumeFile.name}</span>
								<span class="selected-file-size">{formatFileSize(resumeFile.size)}</span>
								<button type="button" class="selected-file-remove" onclick={() => { resumeFile = null; }}>×</button>
							</div>
						{:else}
							<label class="upload-zone" for="resume-file">
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="upload-icon"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" stroke-linecap="round" stroke-linejoin="round" /></svg>
								<span>{t('content.select_to_continue')}</span>
							</label>
							<input type="file" id="resume-file" class="file-input-hidden" onchange={handleResumeFileSelect} />
						{/if}
					</div>

					{#if resumeError}<div class="alert alert-error">{resumeError}</div>{/if}

					<div class="modal-actions">
						<button class="btn btn-secondary" onclick={() => (showResumeModal = false)}>{t('common.cancel')}</button>
						<button class="btn btn-primary" onclick={startResume} disabled={!resumeFile}>
							<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="btn-icon"><path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
							{t('content.resume')}
						</button>
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}

<!-- Edit Modal -->
{#if showEditModal && editingItem}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div class="modal-overlay" role="dialog" tabindex="-1" onkeydown={(e) => e.key === 'Escape' && (showEditModal = false)} onclick={(e) => { if (e.target === e.currentTarget) showEditModal = false; }}>
		<div class="modal animate-fade-in">
			<div class="modal-header"><h2 class="modal-title">{t('content.edit_file')}</h2><button class="modal-close" aria-label="Close" onclick={() => (showEditModal = false)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round" /></svg></button></div>
			{#if editFormError}<div class="alert alert-error modal-alert">{editFormError}</div>{/if}
			<form onsubmit={(e) => { e.preventDefault(); handleEdit(); }} class="modal-form">
				<div class="form-group"><label for="edit-title" class="form-label">{t('common.title')}</label><input type="text" id="edit-title" bind:value={editForm.title} class="form-input" required /></div>
				<div class="form-group"><label for="edit-desc" class="form-label">{t('content.description')}</label><textarea id="edit-desc" bind:value={editForm.description} class="form-input form-textarea" rows="3"></textarea></div>
				<div class="form-group">
					<label for="edit-author" class="form-label">{t('content.author')}</label>
					<input type="text" id="edit-author" bind:value={editForm.author} class="form-input" placeholder="e.g. John Doe..." />
				</div>
				<div class="form-group" style="margin-top: 1.5rem; margin-bottom: 0.5rem;">
					<label class="toggle-switch">
						<input type="checkbox" id="edit-listed" bind:checked={editForm.is_listed} class="toggle-input" />
						<span class="toggle-slider"></span>
						<span class="toggle-label">{t('common.is_listed')}</span>
					</label>
				</div>
				<div class="modal-actions">
					<button type="button" class="btn btn-secondary" onclick={() => (showEditModal = false)}>{t('common.cancel')}</button>
					<button type="submit" class="btn btn-primary" disabled={editFormLoading}>{#if editFormLoading}<span class="spinner-sm"></span>{/if}{t('common.save_changes')}</button>
				</div>
			</form>
		</div>
	</div>
{/if}

<style>
	.page { display: flex; flex-direction: column; gap: 1.25rem; }
	.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
	.page-title { font-size: 1.5rem; font-weight: 700; color: var(--color-surface-100); letter-spacing: -0.02em; }
	.page-desc { font-size: 0.8125rem; color: var(--color-surface-400); margin-top: 0.25rem; }
	.tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--color-surface-700); }
	.tab { padding: 0.625rem 1rem; font-size: 0.8125rem; font-weight: 500; color: var(--color-surface-400); text-decoration: none; border-bottom: 2px solid transparent; transition: all 0.15s; }
	.tab:hover { color: var(--color-surface-200); }
	.tab.active { color: var(--color-primary-400); border-bottom-color: var(--color-primary-500); }
	.toolbar { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
	.search-box { display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0.75rem; background: var(--color-surface-800); border: 1px solid var(--color-surface-700); border-radius: 10px; flex: 1; max-width: 280px; }
	.search-box:focus-within { border-color: var(--color-primary-600); }
	.search-icon { width: 16px; height: 16px; color: var(--color-surface-500); flex-shrink: 0; }
	.search-input { flex: 1; background: none; border: none; outline: none; color: var(--color-surface-100); font-size: 0.8125rem; font-family: inherit; }
	.search-input::placeholder { color: var(--color-surface-500); }
	.filter-select { padding: 0.5rem 0.75rem; background: var(--color-surface-800); border: 1px solid var(--color-surface-700); border-radius: 10px; color: var(--color-surface-300); font-size: 0.8125rem; font-family: inherit; outline: none; cursor: pointer; }
	.filter-select option { background: var(--color-surface-800); color: var(--color-surface-100); }
	.count-badge { padding: 0.375rem 0.75rem; background: var(--color-surface-800); border: 1px solid var(--color-surface-700); border-radius: 100px; font-size: 0.75rem; color: var(--color-surface-400); font-weight: 500; margin-left: auto; }
	.alert { padding: 0.75rem 1rem; border-radius: 10px; font-size: 0.8125rem; }
	.alert-error { background: rgba(244,63,94,0.1); border: 1px solid rgba(244,63,94,0.2); color: var(--color-danger-400); }
	.content-container { min-height: 200px; }
	.state-box { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 3rem; gap: 0.75rem; color: var(--color-surface-500); font-size: 0.875rem; }
	.empty-state { padding: 4rem 2rem; }
	.empty-icon { width: 48px; height: 48px; color: var(--color-surface-600); }
	.spinner { width: 24px; height: 24px; border: 3px solid var(--color-surface-700); border-top-color: var(--color-primary-500); border-radius: 50%; animation: spin 0.6s linear infinite; }

	/* File list */
	.file-list { display: flex; flex-direction: column; gap: 0.5rem; }
	.file-row { display: flex; align-items: center; gap: 1rem; padding: 0.875rem 1rem; background: var(--color-surface-800); border: 1px solid var(--color-surface-700); border-radius: 12px; cursor: pointer; transition: all 0.15s; }
	.file-row:hover { border-color: var(--color-surface-600); background: var(--color-surface-750, var(--color-surface-800)); }
	.file-icon { font-size: 1.25rem; flex-shrink: 0; }
	.file-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.15rem; }
	.file-name { font-size: 0.875rem; font-weight: 600; color: var(--color-surface-100); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.file-meta { font-size: 0.6875rem; color: var(--color-surface-500); }
	.file-status { font-size: 0.6875rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 6px; text-transform: capitalize; flex-shrink: 0; }
	.status-completed { background: rgba(5,150,105,0.15); color: var(--color-primary-400); }
	.status-pending { background: rgba(234,179,8,0.15); color: #eab308; }
	.status-failed { background: rgba(244,63,94,0.15); color: var(--color-danger-400); }
	.file-date { font-size: 0.6875rem; color: var(--color-surface-500); flex-shrink: 0; }
	.file-actions { display: flex; gap: 0.375rem; flex-shrink: 0; }
	.action-btn { width: 30px; height: 30px; display: flex; align-items: center; justify-content: center; border-radius: 8px; border: 1px solid var(--color-surface-600); background: transparent; color: var(--color-surface-400); cursor: pointer; transition: all 0.15s; }
	.action-btn svg { width: 14px; height: 14px; }
	.action-btn.delete:hover { background: rgba(244,63,94,0.1); border-color: var(--color-danger-600); color: var(--color-danger-400); }
	.action-btn.edit:hover { background: rgba(5,150,105,0.1); border-color: var(--color-primary-700); color: var(--color-primary-400); }
	.file-row-pending { border-left: 3px solid #eab308; }
	.file-row-pending:hover { border-color: #eab308; }

	/* Resume info */
	.resume-info { padding: 0.75rem 1rem; background: var(--color-surface-900); border: 1px solid var(--color-surface-600); border-radius: 10px; display: flex; flex-direction: column; gap: 0.375rem; }
	.resume-detail { font-size: 0.8125rem; color: var(--color-surface-300); }
	.resume-detail strong { color: var(--color-surface-100); }
	.resume-label { color: var(--color-surface-500); }

	/* Pagination */
	.pagination { display: flex; align-items: center; justify-content: center; gap: 0.5rem; }
	.page-btn { padding: 0.5rem 1rem; background: var(--color-surface-800); border: 1px solid var(--color-surface-700); border-radius: 8px; color: var(--color-surface-300); font-size: 0.8125rem; font-family: inherit; cursor: pointer; }
	.page-btn:hover:not(:disabled) { background: var(--color-surface-700); }
	.page-btn:disabled { opacity: 0.4; cursor: not-allowed; }
	.page-numbers { display: flex; align-items: center; gap: 0.25rem; }
	.page-num { width: 34px; height: 34px; display: flex; align-items: center; justify-content: center; border-radius: 8px; border: none; background: transparent; color: var(--color-surface-400); font-size: 0.8125rem; font-family: inherit; cursor: pointer; }
	.page-num:hover { background: var(--color-surface-700); }
	.page-num.active { background: var(--color-primary-700); color: white; font-weight: 600; }
	.page-ellipsis { color: var(--color-surface-500); }

	/* Buttons */
	.btn { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.625rem 1.125rem; border-radius: 10px; font-size: 0.8125rem; font-weight: 600; font-family: inherit; cursor: pointer; border: none; transition: all 0.15s; }
	.btn-sm { padding: 0.5rem 0.875rem; font-size: 0.75rem; }
	.btn-icon { width: 16px; height: 16px; }
	.btn-primary { background: linear-gradient(135deg, var(--color-primary-700), var(--color-primary-600)); color: white; }
	.btn-primary:hover { box-shadow: 0 4px 12px rgba(5,150,105,0.25); }
	.btn-primary:disabled { opacity: 0.6; cursor: not-allowed; }
	.btn-secondary { background: var(--color-surface-700); color: var(--color-surface-300); border: 1px solid var(--color-surface-600); }
	.btn-secondary:hover { background: var(--color-surface-600); }
	.btn-danger { background: linear-gradient(135deg, var(--color-danger-600), var(--color-danger-500)); color: white; }
	.btn-danger:disabled { opacity: 0.6; cursor: not-allowed; }

	/* Modal */
	.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(4px); display: flex; align-items: center; justify-content: center; z-index: 100; padding: 1rem; }
	.modal { width: 100%; max-width: 520px; background: var(--color-surface-800); border: 1px solid var(--color-surface-700); border-radius: 16px; box-shadow: var(--shadow-elevated); max-height: 90vh; overflow-y: auto; }
	.modal-sm { max-width: 400px; }
	.modal-batch { max-width: 680px; display: flex; flex-direction: column; }

	/* Batch modal sections area */
	.batch-sections { padding: 1rem 1.5rem; background: var(--color-surface-900); border-bottom: 1px solid var(--color-surface-700); }
	.batch-sections-title { font-size: 0.6875rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--color-surface-500); margin-bottom: 0.5rem; }
	.batch-sections-row { display: flex; gap: 0.75rem; flex-wrap: wrap; }
	.batch-sections-row .form-input { flex: 1; min-width: 160px; }

	/* Entries list */
	.batch-entries { padding: 1rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; overflow-y: auto; max-height: 55vh; }

	/* Single entry card */
	.batch-entry { border: 1px solid var(--color-surface-700); border-radius: 12px; padding: 1rem; background: var(--color-surface-900); display: flex; flex-direction: column; gap: 0.75rem; transition: border-color 0.2s; }
	.entry-success { border-color: var(--color-primary-700); background: rgba(5,150,105,0.06); }
	.entry-error { border-color: var(--color-danger-700); background: rgba(244,63,94,0.05); }
	.batch-entry-header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; }
	.entry-header-actions { display: flex; gap: 0.5rem; align-items: center; }
	.entry-status-badge { display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.25rem 0.625rem; border-radius: 100px; font-size: 0.6875rem; font-weight: 600; }
	.status-idle { background: var(--color-surface-700); color: var(--color-surface-400); }
	.status-uploading { background: rgba(99,102,241,0.15); color: #818cf8; }
	.status-success { background: rgba(5,150,105,0.15); color: var(--color-primary-400); }
	.status-error { background: rgba(244,63,94,0.15); color: var(--color-danger-400); }
	.batch-count-pill { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; background: var(--color-primary-700); color: white; border-radius: 50%; font-size: 0.6875rem; font-weight: 700; vertical-align: middle; }
	.entry-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; }
	.entry-bottom-row { display: flex; flex-direction: column; gap: 0.75rem; margin-top: 0.25rem; }
	.entry-thumb-col { width: 100%; }
	.entry-preview { max-height: 80px; }
	.entry-upload-zone { padding: 0.6rem 0.75rem; }
	.entry-fields { display: flex; flex-direction: column; gap: 0.875rem; border: none; padding: 0; margin: 0.5rem 0 0; }
	.entry-progress { display: flex; align-items: center; gap: 0.75rem; }
	.entry-progress .progress-bar-track { flex: 1; }
	.batch-footer { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding: 1rem 1.5rem; border-top: 1px solid var(--color-surface-700); flex-wrap: wrap; }
	.modal-header { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 1.5rem; border-bottom: 1px solid var(--color-surface-700); }
	.modal-title { font-size: 1.125rem; font-weight: 700; color: var(--color-surface-100); }
	.modal-close { width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 8px; border: none; background: transparent; color: var(--color-surface-500); cursor: pointer; }
	.modal-close:hover { background: var(--color-surface-700); color: var(--color-surface-300); }
	.modal-close svg { width: 18px; height: 18px; }
	.modal-alert { margin: 1rem 1.5rem 0; }
	.modal-form { padding: 1.25rem 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
	.modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; padding-top: 0.5rem; }
	.pad-actions { padding: 0 1.5rem 1.25rem; }
	.delete-message { padding: 1.25rem 1.5rem; font-size: 0.875rem; color: var(--color-surface-300); line-height: 1.5; }
	.delete-message strong { color: var(--color-surface-100); }
	.form-group { display: flex; flex-direction: column; gap: 0.375rem; }
	.form-label { font-size: 0.8125rem; font-weight: 500; color: var(--color-surface-300); }
	.form-input { padding: 0.625rem 0.75rem; background: var(--color-surface-900); border: 1px solid var(--color-surface-600); border-radius: 8px; color: var(--color-surface-100); font-size: 0.8125rem; font-family: inherit; outline: none; }
	.form-input:focus { border-color: var(--color-primary-600); }
	.form-textarea { resize: vertical; min-height: 50px; }

	/* Upload zone */
	.upload-zone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.5rem; padding: 1.5rem; border: 2px dashed var(--color-surface-600); border-radius: 12px; background: var(--color-surface-900); cursor: pointer; transition: all 0.2s ease; color: var(--color-surface-400); font-size: 0.8125rem; }
	.upload-zone:hover { border-color: var(--color-primary-600); background: rgba(5,150,105,0.05); color: var(--color-primary-400); }
	.small-zone { padding: 0.75rem; }
	.upload-icon { width: 28px; height: 28px; }
	.upload-hint { font-size: 0.6875rem; color: var(--color-surface-500); }
	.file-input-hidden { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
	.upload-preview { position: relative; border-radius: 10px; overflow: hidden; border: 1px solid var(--color-surface-600); }
	.preview-img { width: 100%; max-height: 120px; object-fit: cover; display: block; }
	.preview-remove { position: absolute; top: 0.5rem; right: 0.5rem; width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; border-radius: 50%; background: rgba(0,0,0,0.6); border: none; color: white; cursor: pointer; }
	.preview-remove:hover { background: rgba(244,63,94,0.8); }
	.preview-remove svg { width: 14px; height: 14px; }

	/* Selected file chip */
	.selected-file { display: flex; align-items: center; gap: 0.5rem; padding: 0.75rem 1rem; background: var(--color-surface-900); border: 1px solid var(--color-primary-700); border-radius: 10px; }
	.selected-file-name { flex: 1; font-size: 0.8125rem; color: var(--color-surface-100); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.selected-file-size { font-size: 0.6875rem; color: var(--color-surface-400); flex-shrink: 0; }
	.selected-file-remove { background: none; border: none; color: var(--color-surface-400); cursor: pointer; font-size: 1.25rem; padding: 0 0.25rem; }
	.selected-file-remove:hover { color: var(--color-danger-400); }

	/* Progress pane */
	.upload-progress-pane { padding: 2rem 1.5rem; display: flex; flex-direction: column; align-items: stretch; gap: 0.75rem; }
	.progress-file-name { font-size: 0.8125rem; font-weight: 600; color: var(--color-surface-100); text-align: center; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.progress-bar-track { width: 100%; height: 8px; background: var(--color-surface-700); border-radius: 100px; overflow: hidden; }
	.progress-bar-fill { height: 100%; background: linear-gradient(90deg, var(--color-primary-600), var(--color-primary-400)); border-radius: 100px; transition: width 0.3s ease; }
	.progress-info { display: flex; justify-content: space-between; }
	.progress-pct { font-size: 0.875rem; font-weight: 700; color: var(--color-primary-400); }
	.progress-status { font-size: 0.8125rem; color: var(--color-surface-400); }

	/* Detail */
	.detail-content { padding: 1.5rem; }
	.detail-thumb { width: 100%; max-height: 180px; object-fit: cover; border-radius: 10px; margin-bottom: 1rem; }
	.detail-fields { display: flex; flex-direction: column; gap: 0.75rem; }
	.detail-row { display: flex; align-items: flex-start; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--color-surface-700); gap: 1rem; }
	.detail-row:last-child { border-bottom: none; }
	.detail-label { font-size: 0.8125rem; color: var(--color-surface-400); font-weight: 500; flex-shrink: 0; }
	.detail-value { font-size: 0.8125rem; color: var(--color-surface-100); font-weight: 600; text-align: right; }
	.link { color: var(--color-primary-400); text-decoration: none; }
	.link:hover { text-decoration: underline; }

	.spinner-sm { width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.3); border-top-color: white; border-radius: 50%; animation: spin 0.6s linear infinite; }
	@keyframes spin { to { transform: rotate(360deg); } }
	:global(.animate-fade-in) { animation: fadeIn 0.15s ease-out; }
	@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

	@media (max-width: 640px) {
		.toolbar { flex-direction: column; align-items: stretch; }
		.search-box, .filter-select { max-width: 100%; width: 100%; }
		.count-badge { margin-left: 0; align-self: flex-start; }
		
		.file-row { flex-wrap: wrap; gap: 0.5rem; }
		.file-info { min-width: 100%; order: -1; }
		.file-name { white-space: normal; word-break: break-all; }
		.file-actions { margin-left: auto; justify-content: flex-end; width: 100%; }

		.detail-row { flex-direction: column; gap: 0.25rem; }
		.detail-value { text-align: left; word-break: break-all; }
	}
</style>
