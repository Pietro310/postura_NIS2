# Postura Cyber NIS2 — Assessment Tool

Applicazione web per il calcolo della postura di cybersecurity in ambito **Direttiva NIS2**.
Questionario strutturato su 10 macroaree, scoring pesato, report PDF professionale, invio email.

---

## Avvio rapido

```bash
# 1. Crea virtual environment
python3 -m venv venv
source venv/bin/activate

# 2. Installa dipendenze
pip install -r requirements.txt

# 3. Avvia il server
python app.py

# 4. Apri nel browser
# http://localhost:5005
```

**Zero dipendenze di sistema richieste.** `fpdf2` è puro Python.

---

## Correzioni applicate (v2)

| Problema | Causa | Soluzione |
|----------|-------|-----------|
| PDF non generato | WeasyPrint richiedeva GTK/Pango/GObject nativo | Sostituito con `fpdf2` (puro Python) |
| Email non inviata | `EMAIL_CONFIG['enabled']` era `False` | Abilitato, configurato SMTP Gmail |
| Nessuna validazione server email | Solo validazione client-side | Aggiunto endpoint `/api/valida-richiedente` |
| Click multipli duplicavano invii | Nessun lock | Aggiunto `isProcessing` + `disabled` |
| New Assessment ambiguo | Flusso non chiaro | Solo reset, non invia nulla |
| Errori non gestiti | Stacktrace raw al frontend | Error handling robusto + logging |

---

## Configurazione Email SMTP

**File:** `app.py`, blocco `EMAIL_CONFIG` (riga ~50)

```python
EMAIL_CONFIG = {
    'enabled': True,
    'smtp_host': 'smtp.gmail.com',
    'smtp_port': 587,
    'smtp_user': 'tuaemail@gmail.com',
    'smtp_password': 'la_tua_app_password',
    'destinatario_admin': 'admin@tuodominio.it',
    'nome_mittente': 'Globsit - Postura Cyber NIS2'
}
```

**Oppure via variabili d'ambiente:**
```bash
export SMTP_HOST=smtp.gmail.com
export SMTP_PORT=587
export SMTP_USER=tuaemail@gmail.com
export SMTP_PASSWORD=app_password
export ADMIN_EMAIL=admin@tuodominio.it
```

> **Gmail App Password:** vai su https://myaccount.google.com/apppasswords per generare una password app.

---

## Flusso applicativo

```
Hero → Dati Richiedente → Questionario (10 sezioni) → Calcolo Score → Risultati
                                                                        ├── Scarica PDF
                                                                        ├── Invia Report Email
                                                                        └── Nuovo Assessment
```

- **"Scarica Report PDF"**: genera e scarica il PDF (non invia email)
- **"Richiedi Report via Email"**: genera PDF + invia email al richiedente + notifica admin con allegato
- **"Nuovo Assessment"**: resetta tutto, ricarica la pagina (non invia nulla)

---

## Test Download PDF

1. Completa il questionario
2. Clicca "Scarica Report PDF"
3. Il file PDF si scarica automaticamente
4. Verifica nel terminale: `PDF generato con successo: XXXX bytes`

## Test Invio Email

1. Verifica che `EMAIL_CONFIG['enabled']` sia `True`
2. Completa il questionario
3. Clicca "Richiedi Report via Email"
4. Verifica nel terminale:
   - `Invio email a xxx@...`
   - `Email inviata con successo a xxx@...`
5. Verifica la ricezione nell'inbox

---

## Struttura progetto

```
postura_NIS2/
├── app.py                    # Backend Flask (scoring, PDF, email, validazione)
├── requirements.txt          # Dipendenze Python (flask, fpdf2)
├── data/
│   └── questionario.json     # Dati questionario (derivato da Excel)
├── templates/
│   └── index.html            # Template HTML principale
├── static/
│   ├── css/style.css         # Design system dark theme
│   ├── js/
│   │   ├── app.js            # Controller principale
│   │   ├── questionario.js   # Rendering questionario
│   │   ├── scoring.js        # Presentazione risultati
│   │   ├── pdf.js            # Download PDF
│   │   └── email.js          # Invio email
│   └── img/
│       ├── logo.png          # Logo header
│       └── favicon.jpeg      # Favicon
└── README.md
```

---

## Dove modificare

| Cosa | File | Posizione |
|------|------|-----------|
| Email destinataria admin | `app.py` | `EMAIL_CONFIG['destinatario_admin']` |
| Credenziali SMTP | `app.py` | `EMAIL_CONFIG` |
| Pesi macroaree | `app.py` | `PESI_MACROAREE` |
| Mappa risposte→score | `app.py` | `SCORE_MAP` |
| Domande aggiuntive (EPP, EDR, etc.) | `data/questionario.json` | Sezione `protezione`, ultime 4 |
| Soglie classificazione | `app.py` | Funzione `calcola_score()` |
| Porta server | `app.py` | `app.run(port=5005)` |

---

## Assunzioni

1. Le risposte sono mappate su scala 0-4 coerente con la formula IFS dell'Excel originale
2. La sezione ANAGRAFICA non incide sullo scoring
3. EPP/EDR pesano x2, Firewall/XM pesano x1.5 sulla media della macroarea
4. Il PDF usa font Helvetica built-in per massima compatibilità (no font custom)
5. Le credenziali SMTP attuali sono quelle inserite dall'utente nel codice
