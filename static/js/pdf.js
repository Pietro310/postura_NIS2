/**
 * Modulo PDF — Gestione download report PDF
 */

const PdfModule = (() => {

    /**
     * Richiede la generazione del PDF al server e avvia il download
     */
    async function scaricaPdf(risposte, datiRichiedente) {
        const res = await fetch('/api/genera-pdf', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                risposte: risposte,
                dati_richiedente: datiRichiedente
            })
        });

        const data = await res.json();

        if (!res.ok || !data.success) {
            throw new Error(data.errore || data.errori?.join(', ') || 'Errore generazione PDF');
        }

        if (data.pdf_base64) {
            downloadBase64Pdf(data.pdf_base64, data.filename);
            return true;
        }

        throw new Error('PDF non generato');
    }

    /**
     * Converte base64 in blob e avvia il download
     */
    function downloadBase64Pdf(base64, filename) {
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
    }

    return {
        scaricaPdf
    };
})();
