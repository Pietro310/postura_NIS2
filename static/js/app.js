/**
 * App.js — Controller principale dell'applicazione
 * Gestisce il flusso: Hero → Dati Richiedente → Questionario → Risultati
 *
 * Flusso finale corretto:
 * 1. "Calcola Postura" → calcola score, mostra risultati
 * 2. "Scarica Report PDF" → genera e scarica PDF
 * 3. "Richiedi Report via Email" → genera PDF + invia email a richiedente e admin
 * 4. "Nuovo Assessment" → resetta il questionario (NON invia nulla)
 */

(async function () {
    'use strict';

    // ── Elementi DOM ──
    const heroSection = document.getElementById('heroSection');
    const questionnaireSection = document.getElementById('questionnaireSection');
    const resultsSection = document.getElementById('resultsSection');
    const stepsContainer = document.getElementById('stepsContainer');
    const stepperEl = document.getElementById('stepper');
    const btnStart = document.getElementById('btnStartAssessment');
    const btnPrev = document.getElementById('btnPrev');
    const btnNext = document.getElementById('btnNext');
    const btnSubmit = document.getElementById('btnSubmit');
    const loadingOverlay = document.getElementById('loadingOverlay');
    const loadingText = document.getElementById('loadingText');

    // Stato globale
    let risposteCache = {};
    let datiRichiedenteCache = {};
    let isProcessing = false; // Previene click multipli
    let isEmailVerified = false;
    let otpTargetEmail = '';

    // ── Caricamento questionario ──
    showLoading('Caricamento questionario...');
    await QuestionarioModule.caricaQuestionario();
    hideLoading();

    // ── Event: Inizia Assessment ──
    btnStart.addEventListener('click', () => {
        heroSection.style.display = 'none';
        questionnaireSection.style.display = 'block';

        QuestionarioModule.buildAllSteps(stepsContainer);
        QuestionarioModule.buildStepper(stepperEl);
        QuestionarioModule.goToStep(0);
        updateNavButtons();

        document.getElementById('headerNav').innerHTML = `
            <span class="nav-step">Step <span id="navStepNum">1</span> di ${QuestionarioModule.getTotalSteps()}</span>
        `;
    });

    // ── Navigazione ──
    btnPrev.addEventListener('click', () => {
        const curr = QuestionarioModule.getCurrentStep();
        if (curr > 0) {
            QuestionarioModule.goToStep(curr - 1);
            updateNavButtons();
        }
    });

    btnNext.addEventListener('click', async () => {
        if (!QuestionarioModule.validateCurrentStep()) {
            scrollToFirstError();
            return;
        }

        // Step 0 → validazione server-side dei dati richiedente e verifica OTP
        if (QuestionarioModule.getCurrentStep() === 0) {
            const dati = QuestionarioModule.raccogliDatiRichiedente();
            const serverValid = await validaDatiRichiedenteServer(dati);
            if (!serverValid) return;

            if (!isEmailVerified) {
                showLoading('Invio codice di verifica in corso...');
                try {
                    const res = await fetch('/api/richiedi-codice-verifica', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ dati_richiedente: dati })
                    });
                    const data = await res.json();
                    hideLoading();

                    if (!res.ok || !data.success) {
                        alert(data.errori?.join(', ') || data.errore || 'Errore invio codice');
                        return;
                    }

                    otpTargetEmail = dati.email;
                    document.getElementById('otpUserEmail').textContent = dati.email;
                    const errEl = document.getElementById('otpError');
                    if (errEl) errEl.classList.remove('visible');
                    const inputEl = document.getElementById('otpCodeInput');
                    if (inputEl) {
                        inputEl.value = '';
                        inputEl.classList.remove('error');
                    }
                    document.getElementById('otpModal').style.display = 'flex';
                    if (inputEl) inputEl.focus();
                    return; // Sospendi il passaggio allo step 1 finché non si verifica l'OTP
                } catch (e) {
                    hideLoading();
                    alert('Impossibile contattare il server per la verifica email.');
                    return;
                }
            }
        }

        const curr = QuestionarioModule.getCurrentStep();
        const total = QuestionarioModule.getTotalSteps();
        if (curr < total - 1) {
            QuestionarioModule.goToStep(curr + 1);
            updateNavButtons();
        }
    });

    // ── Calcola postura ──
    btnSubmit.addEventListener('click', async () => {
        if (isProcessing) return;
        if (!QuestionarioModule.validateCurrentStep()) {
            scrollToFirstError();
            return;
        }

        isProcessing = true;
        btnSubmit.disabled = true;
        risposteCache = QuestionarioModule.raccogliRisposte();
        datiRichiedenteCache = QuestionarioModule.raccogliDatiRichiedente();

        showLoading('Calcolo postura cyber in corso...');

        try {
            const data = await ScoringModule.calcolaScore(risposteCache, datiRichiedenteCache);

            if (!data.success) {
                throw new Error(data.errore || data.errori?.join(', ') || 'Errore nel calcolo');
            }

            questionnaireSection.style.display = 'none';
            resultsSection.style.display = 'block';

            document.getElementById('headerNav').innerHTML = `
                <span class="nav-step" style="background: var(--color-accent-subtle); color: var(--color-accent);">
                    ✓ Valutazione postura cyber completata
                </span>
            `;

            ScoringModule.renderRisultati(data);

            hideLoading();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            hideLoading();
            showInlineError('Errore nel calcolo: ' + err.message);
        } finally {
            isProcessing = false;
            btnSubmit.disabled = false;
        }
    });

    // ── Download PDF ──
    document.getElementById('btnDownloadPdf').addEventListener('click', async () => {
        if (isProcessing) return;
        isProcessing = true;

        const btn = document.getElementById('btnDownloadPdf');
        btn.disabled = true;
        showLoading('Generazione report PDF...');

        try {
            await PdfModule.scaricaPdf(risposteCache, datiRichiedenteCache);
            hideLoading();
        } catch (err) {
            hideLoading();
            showEmailStatus('error', 'Errore nella generazione del PDF: ' + err.message);
        } finally {
            isProcessing = false;
            btn.disabled = false;
        }
    });

    // ── Invio Email: genera PDF + invia a richiedente e admin ──
    document.getElementById('btnSendEmail').addEventListener('click', async () => {
        if (isProcessing) return;
        isProcessing = true;

        const btn = document.getElementById('btnSendEmail');
        btn.disabled = true;
        showLoading('Invio report via email...');

        try {
            const result = await EmailModule.inviaReport(risposteCache, datiRichiedenteCache);
            hideLoading();
            EmailModule.mostraStatoEmail(document.getElementById('emailStatus'), result);
        } catch (err) {
            hideLoading();
            showEmailStatus('error', 'Errore nell\'invio: ' + err.message);
        } finally {
            isProcessing = false;
            btn.disabled = false;
        }
    });

    // ── Nuovo Assessment: solo reset, NON invia nulla ──
    document.getElementById('btnNewAssessment').addEventListener('click', () => {
        if (isProcessing) {
            showEmailStatus('info', 'Attendere il completamento delle operazioni in corso.');
            return;
        }
        if (confirm('Vuoi iniziare un nuovo assessment? I dati correnti verranno persi.')) {
            location.reload();
        }
    });

    // ── Gestione Modal OTP ──
    const otpModal = document.getElementById('otpModal');
    const btnOtpCancel = document.getElementById('btnOtpCancel');
    const btnOtpConfirm = document.getElementById('btnOtpConfirm');
    const btnOtpResend = document.getElementById('btnOtpResend');
    const otpCodeInput = document.getElementById('otpCodeInput');
    const otpError = document.getElementById('otpError');

    if (btnOtpCancel) {
        btnOtpCancel.addEventListener('click', () => {
            otpModal.style.display = 'none';
        });
    }

    if (otpCodeInput) {
        otpCodeInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                btnOtpConfirm.click();
            }
        });
        otpCodeInput.addEventListener('input', () => {
            otpCodeInput.classList.remove('error');
            if (otpError) otpError.classList.remove('visible');
        });
    }

    if (btnOtpConfirm) {
        btnOtpConfirm.addEventListener('click', async () => {
            const code = otpCodeInput.value.trim();
            if (!code || code.length !== 6) {
                otpCodeInput.classList.add('error');
                if (otpError) {
                    otpError.textContent = 'Inserisci un codice a 6 cifre';
                    otpError.classList.add('visible');
                }
                return;
            }

            btnOtpConfirm.disabled = true;
            showLoading('Verifica codice in corso...');
            try {
                const res = await fetch('/api/verifica-codice', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: otpTargetEmail,
                        codice: code,
                        dati_richiedente: QuestionarioModule.raccogliDatiRichiedente()
                    })
                });
                const data = await res.json();
                hideLoading();
                btnOtpConfirm.disabled = false;

                if (!res.ok || !data.success) {
                    otpCodeInput.classList.add('error');
                    if (otpError) {
                        otpError.textContent = data.errore || 'Codice errato';
                        otpError.classList.add('visible');
                    }
                    return;
                }

                // Codice verificato con successo!
                isEmailVerified = true;
                otpModal.style.display = 'none';

                // Procedi allo step 1
                const curr = QuestionarioModule.getCurrentStep();
                const total = QuestionarioModule.getTotalSteps();
                if (curr < total - 1) {
                    QuestionarioModule.goToStep(curr + 1);
                    updateNavButtons();
                }
            } catch (e) {
                hideLoading();
                btnOtpConfirm.disabled = false;
                alert('Errore di connessione durante la verifica del codice.');
            }
        });
    }

    if (btnOtpResend) {
        btnOtpResend.addEventListener('click', async () => {
            btnOtpResend.disabled = true;
            showLoading('Reinvio codice in corso...');
            const dati = QuestionarioModule.raccogliDatiRichiedente();
            try {
                const res = await fetch('/api/richiedi-codice-verifica', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ dati_richiedente: dati })
                });
                const data = await res.json();
                hideLoading();
                btnOtpResend.disabled = false;

                if (!res.ok || !data.success) {
                    alert(data.errori?.join(', ') || data.errore || 'Errore invio codice');
                } else {
                    alert('Nuovo codice inviato con successo alla tua email.');
                    if (otpCodeInput) {
                        otpCodeInput.value = '';
                        otpCodeInput.focus();
                    }
                }
            } catch (e) {
                hideLoading();
                btnOtpResend.disabled = false;
                alert('Errore di connessione durante il reinvio.');
            }
        });
    }

    // ── Stepper click ──
    stepperEl.addEventListener('click', (e) => {
        const item = e.target.closest('.stepper-item');
        if (!item) return;
        const targetStep = parseInt(item.dataset.stepperStep);
        const curr = QuestionarioModule.getCurrentStep();

        if (targetStep < curr) {
            QuestionarioModule.goToStep(targetStep);
            updateNavButtons();
        }
    });

    // ── Input focus: rimuovi errori inline ──
    document.addEventListener('input', (e) => {
        if (e.target.classList.contains('error')) {
            e.target.classList.remove('error');
        }
        const group = e.target.closest('.form-group');
        if (group) {
            const errEl = group.querySelector('.form-error.visible');
            if (errEl) errEl.classList.remove('visible');
        }
    });

    document.addEventListener('change', (e) => {
        if (e.target.type === 'radio' || e.target.type === 'checkbox') {
            const group = e.target.closest('.form-group');
            if (group) {
                const errEl = group.querySelector('.form-error.visible');
                if (errEl) errEl.classList.remove('visible');
            }
        }
    });

    // ── Utility ──
    function updateNavButtons() {
        const curr = QuestionarioModule.getCurrentStep();
        const total = QuestionarioModule.getTotalSteps();

        btnPrev.style.display = curr > 0 ? 'inline-flex' : 'none';
        btnNext.style.display = curr < total - 1 ? 'inline-flex' : 'none';
        btnSubmit.style.display = curr === total - 1 ? 'inline-flex' : 'none';

        const navNum = document.getElementById('navStepNum');
        if (navNum) navNum.textContent = curr + 1;
    }

    function scrollToFirstError() {
        const firstError = document.querySelector('.form-error.visible');
        if (firstError) {
            firstError.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }

    async function validaDatiRichiedenteServer(dati) {
        /**
         * Validazione server-side dei dati richiedente.
         * Se fallisce, mostra errori inline.
         */
        try {
            const res = await fetch('/api/valida-richiedente', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dati_richiedente: dati })
            });

            const data = await res.json();

            if (!data.success) {
                // Mostra errori
                const errori = data.errori || [];
                for (const err of errori) {
                    if (err.toLowerCase().includes('email')) {
                        const el = document.getElementById('req_email');
                        if (el) el.classList.add('error');
                        const errEl = document.getElementById('err_req_email');
                        if (errEl) {
                            errEl.textContent = err;
                            errEl.classList.add('visible');
                        }
                    }
                    if (err.toLowerCase().includes('azienda')) {
                        const el = document.getElementById('req_azienda');
                        if (el) el.classList.add('error');
                        const errEl = document.getElementById('err_req_azienda');
                        if (errEl) {
                            errEl.textContent = err;
                            errEl.classList.add('visible');
                        }
                    }
                    if (err.toLowerCase().includes('telefono')) {
                        const el = document.getElementById('req_telefono');
                        if (el) el.classList.add('error');
                        const errEl = document.getElementById('err_req_telefono');
                        if (errEl) {
                            errEl.textContent = err;
                            errEl.classList.add('visible');
                        }
                    }
                }
                scrollToFirstError();
                return false;
            }

            return true;
        } catch (e) {
            console.error('Errore validazione server:', e);
            // Se il server non risponde, procedi comunque (la validazione client c'è già)
            return true;
        }
    }

    function showLoading(text) {
        loadingText.textContent = text || 'Caricamento...';
        loadingOverlay.style.display = 'flex';
    }

    function hideLoading() {
        loadingOverlay.style.display = 'none';
    }

    function showInlineError(message) {
        const statusEl = document.getElementById('emailStatus');
        if (statusEl) {
            showEmailStatus('error', message);
        } else {
            alert(message);
        }
    }

    function showEmailStatus(type, message) {
        const statusEl = document.getElementById('emailStatus');
        if (!statusEl) return;
        statusEl.style.display = 'block';
        statusEl.className = `email-status ${type}`;
        statusEl.innerHTML = message;
    }
})();
