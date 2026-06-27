/**
 * Modulo Email — Gestione invio report via email
 *
 * L'invio effettivo avviene lato server (app.py → /api/invia-report).
 * L'endpoint genera il PDF e invia email a:
 *   1. Richiedente (con report allegato)
 *   2. Admin (notifica con dati + report allegato)
 *
 * Per configurare invio reale: modificare EMAIL_CONFIG in app.py
 * oppure impostare variabili d'ambiente SMTP_HOST, SMTP_USER, etc.
 */

const EmailModule = (() => {

    /**
     * Richiede l'invio del report via email (al richiedente e all'admin)
     */
    async function inviaReport(risposte, datiRichiedente) {
        const res = await fetch('/api/invia-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                risposte: risposte,
                dati_richiedente: datiRichiedente
            })
        });

        const data = await res.json();

        if (!res.ok) {
            throw new Error(data.errore || data.errori?.join(', ') || 'Errore server');
        }

        return data;
    }

    /**
     * Mostra lo stato dell'invio email nella UI
     */
    function mostraStatoEmail(statusEl, result) {
        statusEl.style.display = 'block';

        // Caso mock (email disabilitata)
        if (result.email_richiedente?.mock || result.email_admin?.mock) {
            statusEl.className = 'email-status info';
            statusEl.innerHTML = `
                <strong>📧 Simulazione invio completata</strong><br>
                L'invio email è configurato in modalità simulata.
                Il PDF del report è stato generato correttamente.<br>
                <small>Per abilitare l'invio reale, configurare <code>EMAIL_CONFIG</code> in <code>app.py</code>.</small>
            `;
            // Scarica il PDF generato
            if (result.pdf_base64) {
                downloadBase64Pdf(result.pdf_base64, result.filename);
            }
            return;
        }

        // Caso successo reale
        const richOk = result.email_richiedente?.success;
        const adminOk = result.email_admin?.success;

        if (richOk && adminOk) {
            statusEl.className = 'email-status success';
            statusEl.innerHTML = `
                <strong>✓ Email inviate con successo</strong><br>
                Il report è stato inviato all'indirizzo indicato e all'amministratore.
            `;
        } else if (richOk || adminOk) {
            // Successo parziale
            statusEl.className = 'email-status info';
            let msg = '<strong>⚠ Invio parziale</strong><br>';
            if (richOk) msg += 'Email inviata al richiedente. ';
            else msg += `Email al richiedente fallita: ${result.email_richiedente?.messaggio || 'errore'}. `;
            if (adminOk) msg += 'Email inviata all\'amministratore.';
            else msg += `Email all'amministratore fallita: ${result.email_admin?.messaggio || 'errore'}.`;
            statusEl.innerHTML = msg;
        } else {
            // Tutto fallito
            statusEl.className = 'email-status error';
            const errMsg = result.email_richiedente?.messaggio
                || result.email_admin?.messaggio
                || 'Errore sconosciuto';
            statusEl.innerHTML = `
                <strong>✗ Errore nell'invio email</strong><br>
                ${errMsg}<br>
                <small>Verificare la configurazione SMTP in app.py.</small>
            `;
        }

        // Scarica comunque il PDF se disponibile
        if (result.pdf_base64) {
            downloadBase64Pdf(result.pdf_base64, result.filename);
        }
    }

    /**
     * Utility: scarica PDF da base64
     */
    function downloadBase64Pdf(base64, filename) {
        try {
            const byteChars = atob(base64);
            const byteNumbers = new Array(byteChars.length);
            for (let i = 0; i < byteChars.length; i++) {
                byteNumbers[i] = byteChars.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            const blob = new Blob([byteArray], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename || 'report_postura_NIS2.pdf';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (e) {
            console.error('Errore download PDF:', e);
        }
    }

    return {
        inviaReport,
        mostraStatoEmail
    };
})();
