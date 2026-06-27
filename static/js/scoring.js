/**
 * Modulo Scoring — Gestione calcolo punteggio lato client
 * Il calcolo effettivo avviene lato server, ma questo modulo gestisce
 * la presentazione dei risultati nella UI.
 */

const ScoringModule = (() => {

    /**
     * Invia le risposte al server e ottiene il calcolo
     */
    async function calcolaScore(risposte, datiRichiedente) {
        const res = await fetch('/api/calcola', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                risposte: risposte,
                dati_richiedente: datiRichiedente
            })
        });

        if (!res.ok) {
            throw new Error('Errore nel calcolo del punteggio');
        }

        return await res.json();
    }

    /**
     * Renderizza i risultati nella pagina
     */
    function renderRisultati(data) {
        const risultati = data.risultati;

        // Anima score ring
        animateScoreRing(risultati.score_totale, risultati.colore_classe);

        // Badge classe
        const badge = document.getElementById('scoreClassBadge');
        badge.textContent = risultati.classe;
        badge.style.background = risultati.colore_classe + '20';
        badge.style.color = risultati.colore_classe;
        badge.style.border = `1px solid ${risultati.colore_classe}40`;

        // Descrizione
        document.getElementById('scoreDescription').textContent = risultati.descrizione_classe;

        // Macroaree
        const areasList = document.getElementById('areasList');
        areasList.innerHTML = '';
        const orderedAreas = Object.entries(risultati.dettaglio_macroaree)
            .sort(([a], [b]) => a.localeCompare(b));

        for (const [cat, data] of orderedAreas) {
            const barColor = data.percentuale >= 75 ? 'var(--color-success)'
                : data.percentuale >= 50 ? 'var(--color-info)'
                : data.percentuale >= 25 ? 'var(--color-warning)'
                : 'var(--color-danger)';

            const row = document.createElement('div');
            row.className = 'area-row';
            row.innerHTML = `
                <div class="area-name">${cat}</div>
                <div class="area-bar-wrap">
                    <div class="area-bar" style="width:0%; background:${barColor};" data-target="${data.percentuale}"></div>
                </div>
                <div class="area-score" style="color:${barColor}">${data.percentuale}%</div>
            `;
            areasList.appendChild(row);
        }

        // Anima barre dopo un breve ritardo
        setTimeout(() => {
            document.querySelectorAll('.area-bar[data-target]').forEach(bar => {
                bar.style.width = bar.dataset.target + '%';
            });
        }, 300);

        // Punti di forza
        const strengthsList = document.getElementById('strengthsList');
        strengthsList.innerHTML = '';
        if (risultati.punti_forza.length > 0) {
            for (const pf of risultati.punti_forza) {
                const li = document.createElement('li');
                li.textContent = `✓ ${pf.area} — ${pf.percentuale}%`;
                strengthsList.appendChild(li);
            }
        } else {
            strengthsList.innerHTML = '<li>Nessun punto di forza significativo rilevato</li>';
        }

        // Gap
        const gapsList = document.getElementById('gapsList');
        gapsList.innerHTML = '';
        if (risultati.gap.length > 0) {
            for (const g of risultati.gap) {
                const li = document.createElement('li');
                li.textContent = `✗ ${g.area} — ${g.percentuale}%`;
                gapsList.appendChild(li);
            }
        } else {
            gapsList.innerHTML = '<li>Nessun gap critico rilevato</li>';
        }
    }

    /**
     * Anima il cerchio dello score con contatore
     */
    function animateScoreRing(targetScore, color) {
        const ring = document.getElementById('scoreRingFill');
        const valueEl = document.getElementById('scoreValue');
        const circumference = 2 * Math.PI * 85; // r=85

        // Imposta colore
        ring.style.stroke = color;

        // Anima dashoffset
        const targetOffset = circumference - (circumference * targetScore / 100);
        
        // Contatore numerico
        let current = 0;
        const duration = 1500;
        const startTime = performance.now();

        function animate(time) {
            const elapsed = time - startTime;
            const progress = Math.min(elapsed / duration, 1);
            // Easing
            const eased = 1 - Math.pow(1 - progress, 3);

            current = Math.round(eased * targetScore);
            valueEl.textContent = current;

            const currentOffset = circumference - (circumference * (eased * targetScore) / 100);
            ring.style.strokeDashoffset = currentOffset;

            if (progress < 1) {
                requestAnimationFrame(animate);
            }
        }

        requestAnimationFrame(animate);
    }

    return {
        calcolaScore,
        renderRisultati
    };
})();
