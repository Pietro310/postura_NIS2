/**
 * Modulo Questionario — Gestione rendering e logica del questionario
 * Genera dinamicamente i form a partire dal JSON del questionario.
 */

const QuestionarioModule = (() => {
    let questionarioData = null;
    let currentStep = 0;
    let totalSteps = 0;

    /**
     * Carica il questionario dal backend
     */
    async function caricaQuestionario() {
        const res = await fetch('/api/questionario');
        questionarioData = await res.json();
        return questionarioData;
    }

    /**
     * Restituisce i dati del questionario caricato
     */
    function getData() {
        return questionarioData;
    }

    /**
     * Costruisce lo step 0: dati richiedente (email, azienda, telefono)
     */
    function buildStepDatiRichiedente() {
        return `
        <div class="step-panel" data-step="0">
            <div class="step-header">
                <h2>Dati del Richiedente</h2>
                <p>Inserisci i tuoi dati di contatto. Tutti i campi sono obbligatori per procedere.</p>
            </div>
            <div class="contact-form">
                <div class="form-grid">
                    <div class="form-group">
                        <label class="form-label" for="req_email">
                            Email aziendale <span class="required">*</span>
                        </label>
                        <input type="email" id="req_email" class="form-input" 
                            placeholder="nome@azienda.it" required autocomplete="email">
                        <div class="form-error" id="err_req_email">Inserisci un indirizzo email valido</div>
                    </div>
                    <div class="form-group">
                        <label class="form-label" for="req_telefono">
                            Telefono <span class="required">*</span>
                        </label>
                        <input type="tel" id="req_telefono" class="form-input" 
                            placeholder="+39 ..." required autocomplete="tel">
                        <div class="form-error" id="err_req_telefono">Inserisci un numero di telefono valido</div>
                    </div>
                    <div class="form-group full-width">
                        <label class="form-label" for="req_azienda">
                            Nome Azienda <span class="required">*</span>
                        </label>
                        <input type="text" id="req_azienda" class="form-input" 
                            placeholder="Ragione sociale completa" required autocomplete="organization">
                        <div class="form-error" id="err_req_azienda">Inserisci il nome dell'azienda</div>
                    </div>
                    <div class="form-group full-width" style="margin-top: var(--space-2);">
                        <label class="checkbox-label" for="req_privacy" style="display: flex; align-items: flex-start; gap: var(--space-3); cursor: pointer; font-size: var(--font-size-sm); color: var(--color-text-secondary);">
                            <input type="checkbox" id="req_privacy" required style="margin-top: 4px; accent-color: var(--color-accent);">
                            <span>Acconsento al trattamento dei miei dati personali per ricevere comunicazioni commerciali, newsletter e materiale informativo.</span>
                        </label>
                        <div class="form-error" id="err_req_privacy" style="margin-top: var(--space-1);">È necessario accettare l'informativa sulla privacy per proseguire</div>
                    </div>
                </div>
            </div>
        </div>`;
    }

    /**
     * Genera l'HTML di un campo domanda
     */
    function renderDomanda(domanda, sezioneId) {
        const dId = String(domanda.id);
        const fieldName = `q_${dId}`;
        let html = '';

        const pesoLabel = domanda.peso_speciale
            ? '<span class="badge-weight">Alto impatto</span>' : '';
        const requiredMark = domanda.obbligatoria
            ? '<span class="required">*</span>' : '';

        // Wrapper con eventuale classe disabilitata
        const hasDep = domanda.dipendenza;
        const depClass = hasDep ? ' disabled' : '';
        const depDataAttr = hasDep
            ? ` data-depends-on="${domanda.dipendenza.domanda_id}" data-depends-value="${domanda.dipendenza.valore_richiesto}"`
            : '';

        html += `<div class="form-group${depClass}" id="group_${fieldName}"${depDataAttr}>`;
        html += `<label class="form-label">${domanda.testo} ${requiredMark} ${pesoLabel}</label>`;

        if (domanda.nota) {
            html += `<div class="form-hint">${domanda.nota}</div>`;
        }

        switch (domanda.tipo) {
            case 'text':
                html += `<input type="text" id="${fieldName}" name="${fieldName}" class="form-input" 
                    placeholder="Inserisci..." data-question-id="${dId}">`;
                break;

            case 'select':
                html += `<select id="${fieldName}" name="${fieldName}" class="form-select" data-question-id="${dId}">`;
                html += `<option value="">— Seleziona —</option>`;
                for (const opt of domanda.opzioni) {
                    html += `<option value="${opt}">${opt}</option>`;
                }
                html += `</select>`;
                break;

            case 'assessment':
                html += `<div class="radio-group">`;
                for (const opt of domanda.opzioni) {
                    const rId = `${fieldName}_${opt.replace(/[^a-zA-Z0-9]/g, '_')}`;
                    html += `
                    <div class="radio-option">
                        <input type="radio" id="${rId}" name="${fieldName}" value="${opt}" data-question-id="${dId}">
                        <label for="${rId}">${opt}</label>
                    </div>`;
                }
                html += `</div>`;
                break;

            case 'si_no':
                html += `<div class="radio-group">`;
                for (const val of ['Sì', 'No']) {
                    const rId = `${fieldName}_${val}`;
                    html += `
                    <div class="radio-option">
                        <input type="radio" id="${rId}" name="${fieldName}" value="${val}" 
                            data-question-id="${dId}" data-tipo="si_no">
                        <label for="${rId}">${val}</label>
                    </div>`;
                }
                html += `</div>`;
                break;

            case 'si_no_dettaglio':
                html += `<div class="radio-group">`;
                for (const val of ['Sì', 'No']) {
                    const rId = `${fieldName}_${val}`;
                    html += `
                    <div class="radio-option">
                        <input type="radio" id="${rId}" name="${fieldName}" value="${val}" 
                            data-question-id="${dId}" data-tipo="si_no_dettaglio"
                            data-detail-field="${fieldName}_detail">
                        <label for="${rId}">${val}</label>
                    </div>`;
                }
                html += `</div>`;
                // Campo dettaglio condizionale
                html += `
                <div class="conditional-field" id="${fieldName}_detail_wrap">
                    <label class="form-label">${domanda.campo_dettaglio} <span class="required">*</span></label>
                    <input type="text" id="${fieldName}_detail" name="${fieldName}_detail" 
                        class="form-input" placeholder="Es. CrowdStrike Falcon v6.x" 
                        data-question-id="${dId}_detail">
                </div>`;
                break;
        }

        // Messaggio dipendenza
        if (hasDep) {
            html += `
            <div class="dependency-notice">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
                <span>${domanda.dipendenza.messaggio_disabilitato}</span>
            </div>`;
        }

        html += `<div class="form-error" id="err_${fieldName}">Questo campo è obbligatorio</div>`;
        html += `</div>`;

        return html;
    }

    /**
     * Costruisce tutti gli step del questionario
     * Step 0 = dati richiedente, Step 1..N = sezioni del questionario
     */
    function buildAllSteps(container) {
        if (!questionarioData) return;

        let html = buildStepDatiRichiedente();

        questionarioData.sezioni.forEach((sezione, idx) => {
            const stepNum = idx + 1;
            html += `
            <div class="step-panel" data-step="${stepNum}">
                <div class="step-header">
                    <h2>${sezione.titolo}</h2>
                    ${sezione.scored
                    ? `<p>Peso macroarea: ${questionarioData.pesi_macroaree[sezione.categoria] || '—'}%</p>`
                    : '<p>Informazioni generali — non incide sullo scoring</p>'
                }
                </div>`;

            for (const domanda of sezione.domande) {
                html += renderDomanda(domanda, sezione.id);
            }

            html += `</div>`;
        });

        container.innerHTML = html;
        totalSteps = questionarioData.sezioni.length + 1; // +1 per dati richiedente

        // Aggiungi event listener per campi condizionali e dipendenze
        setupConditionalLogic();
    }

    /**
     * Configura la logica condizionale:
     * - Mostra/nascondi campi dettaglio per domande si_no_dettaglio
     * - Abilita/disabilita domande con dipendenze
     */
    function setupConditionalLogic() {
        // Campi dettaglio condizionali (EPP, EDR, Firewall)
        document.querySelectorAll('input[data-tipo="si_no_dettaglio"]').forEach(radio => {
            radio.addEventListener('change', () => {
                const detailFieldId = radio.dataset.detailField;
                const wrapEl = document.getElementById(detailFieldId + '_wrap');
                if (!wrapEl) return;

                if (radio.value === 'Sì') {
                    wrapEl.classList.add('visible');
                } else {
                    wrapEl.classList.remove('visible');
                    // Pulisci il campo dettaglio
                    const detailInput = document.getElementById(detailFieldId);
                    if (detailInput) {
                        detailInput.value = '';
                        detailInput.classList.remove('error');
                    }
                }
            });
        });

        // Gestione dipendenze (EDR dipende da EPP, o select dipendenti)
        document.querySelectorAll('[data-depends-on]').forEach(group => {
            const depId = group.dataset.dependsOn;
            const depValue = group.dataset.dependsValue;

            // Trova i radio o select della domanda da cui dipende
            const depElements = document.querySelectorAll(`input[data-question-id="${depId}"], select[data-question-id="${depId}"]`);
            depElements.forEach(el => {
                el.addEventListener('change', () => {
                    const value = el.type === 'radio' ? (el.checked ? el.value : '') : el.value;
                    if (el.type === 'radio' && !el.checked) return;

                    const isMatch = value.toLowerCase() === depValue.toLowerCase()
                        || (depValue.toLowerCase() === 'si' && value === 'Sì')
                        || (depValue.toLowerCase() === 'sì' && value.toLowerCase() === 'si');

                    if (isMatch) {
                        group.classList.remove('disabled');
                    } else {
                        group.classList.add('disabled');
                        // Reset della domanda dipendente (radio, select e text)
                        group.querySelectorAll('input[type="radio"]').forEach(r => r.checked = false);
                        group.querySelectorAll('select').forEach(s => s.value = '');
                        group.querySelectorAll('input[type="text"]').forEach(i => i.value = '');
                        const detailWrap = group.querySelector('.conditional-field');
                        if (detailWrap) detailWrap.classList.remove('visible');
                    }
                });
            });
        });
    }

    /**
     * Costruisce lo stepper in alto
     */
    function buildStepper(stepperEl) {
        if (!questionarioData) return;

        let html = `
        <div class="stepper-item active" data-stepper-step="0">
            <span class="stepper-num">0</span>
            <span class="stepper-label">Dati Contatto</span>
        </div>`;

        questionarioData.sezioni.forEach((sezione, idx) => {
            const label = sezione.titolo.replace(/^\d+\.\s*/, '');
            html += `
            <div class="stepper-item" data-stepper-step="${idx + 1}">
                <span class="stepper-num">${idx + 1}</span>
                <span class="stepper-label">${label}</span>
            </div>`;
        });

        stepperEl.innerHTML = html;
    }

    /**
     * Naviga allo step indicato
     */
    function goToStep(step) {
        currentStep = step;

        // Mostra/nascondi pannelli
        document.querySelectorAll('.step-panel').forEach(panel => {
            panel.classList.toggle('active', parseInt(panel.dataset.step) === step);
        });

        // Aggiorna stepper
        document.querySelectorAll('.stepper-item').forEach(item => {
            const s = parseInt(item.dataset.stepperStep);
            item.classList.toggle('active', s === step);
            item.classList.toggle('completed', s < step);
        });

        // Aggiorna progress bar
        const progress = ((step) / (totalSteps - 1)) * 100;
        const bar = document.getElementById('stepperProgressBar');
        if (bar) bar.style.width = progress + '%';

        // Scroll stepper item in vista
        const activeItem = document.querySelector(`.stepper-item[data-stepper-step="${step}"]`);
        if (activeItem) {
            activeItem.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }

        // Scroll top
        window.scrollTo({ top: 0, behavior: 'smooth' });

        return { currentStep, totalSteps };
    }

    /**
     * Valida lo step corrente
     */
    function validateCurrentStep() {
        let isValid = true;

        if (currentStep === 0) {
            // Validazione dati richiedente
            const email = document.getElementById('req_email');
            const tel = document.getElementById('req_telefono');
            const az = document.getElementById('req_azienda');
            const priv = document.getElementById('req_privacy');

            // Email
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!email.value.trim() || !emailRegex.test(email.value.trim())) {
                email.classList.add('error');
                document.getElementById('err_req_email').classList.add('visible');
                isValid = false;
            } else {
                email.classList.remove('error');
                document.getElementById('err_req_email').classList.remove('visible');
            }

            // Telefono
            if (!tel.value.trim() || tel.value.trim().length < 6) {
                tel.classList.add('error');
                document.getElementById('err_req_telefono').classList.add('visible');
                isValid = false;
            } else {
                tel.classList.remove('error');
                document.getElementById('err_req_telefono').classList.remove('visible');
            }

            // Azienda
            if (!az.value.trim()) {
                az.classList.add('error');
                document.getElementById('err_req_azienda').classList.add('visible');
                isValid = false;
            } else {
                az.classList.remove('error');
                document.getElementById('err_req_azienda').classList.remove('visible');
            }

            // Privacy Checkbox
            if (priv && !priv.checked) {
                document.getElementById('err_req_privacy').classList.add('visible');
                isValid = false;
            } else if (priv) {
                document.getElementById('err_req_privacy').classList.remove('visible');
            }
        } else {
            // Validazione domande della sezione corrente
            const panel = document.querySelector(`.step-panel[data-step="${currentStep}"]`);
            if (!panel) return true;

            const groups = panel.querySelectorAll('.form-group:not(.disabled)');
            groups.forEach(group => {
                const fieldName = group.querySelector('.form-input, .form-select, input[type="radio"]');
                if (!fieldName) return;

                let name;
                if (fieldName.type === 'radio') {
                    name = fieldName.name;
                } else {
                    name = fieldName.name || fieldName.id;
                }

                const errEl = group.querySelector('.form-error');
                let hasValue = false;

                if (fieldName.type === 'radio') {
                    const checked = group.querySelector(`input[name="${name}"]:checked`);
                    hasValue = !!checked;

                    // Se è un si_no_dettaglio e la risposta è Sì, valida il campo dettaglio
                    if (checked && checked.dataset.tipo === 'si_no_dettaglio' && checked.value === 'Sì') {
                        const detailField = document.getElementById(checked.dataset.detailField);
                        if (detailField && !detailField.value.trim()) {
                            detailField.classList.add('error');
                            isValid = false;
                            hasValue = false;
                        } else if (detailField) {
                            detailField.classList.remove('error');
                        }
                    }
                } else {
                    hasValue = fieldName.value.trim() !== '';
                    if (!hasValue) {
                        fieldName.classList.add('error');
                    } else {
                        fieldName.classList.remove('error');
                    }
                }

                if (!hasValue) {
                    if (errEl) errEl.classList.add('visible');
                    isValid = false;
                } else {
                    if (errEl) errEl.classList.remove('visible');
                }
            });
        }

        return isValid;
    }

    /**
     * Raccoglie tutte le risposte dal form
     */
    function raccogliRisposte() {
        const risposte = {};

        // Tutti i radio selezionati
        document.querySelectorAll('input[type="radio"]:checked').forEach(radio => {
            const qId = radio.dataset.questionId;
            if (qId) {
                risposte[qId] = radio.value;
            }
        });

        // Tutti i select
        document.querySelectorAll('.form-select[data-question-id]').forEach(sel => {
            const qId = sel.dataset.questionId;
            if (qId && sel.value) {
                risposte[qId] = sel.value;
            }
        });

        // Tutti i text input con question-id
        document.querySelectorAll('.form-input[data-question-id]').forEach(inp => {
            const qId = inp.dataset.questionId;
            if (qId && inp.value.trim()) {
                risposte[qId] = inp.value.trim();
            }
        });

        return risposte;
    }

    /**
     * Raccoglie i dati del richiedente
     */
    function raccogliDatiRichiedente() {
        return {
            email: (document.getElementById('req_email')?.value || '').trim(),
            nome_azienda: (document.getElementById('req_azienda')?.value || '').trim(),
            telefono: (document.getElementById('req_telefono')?.value || '').trim(),
            privacy_accettata: document.getElementById('req_privacy')?.checked || false
        };
    }

    function getCurrentStep() { return currentStep; }
    function getTotalSteps() { return totalSteps; }

    return {
        caricaQuestionario,
        getData,
        buildAllSteps,
        buildStepper,
        goToStep,
        validateCurrentStep,
        raccogliRisposte,
        raccogliDatiRichiedente,
        getCurrentStep,
        getTotalSteps
    };
})();
